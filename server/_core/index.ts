import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerAsaasBillingWebhook } from "../billing/asaas-billing-webhook";
import { registerPDFExportRoute } from "../calculos/export-pdf-route";
import { registerAgenteChatPDFRoute } from "../integracoes/agente-chat-pdf-route";
import { registerCalcomWebhook } from "../integracoes/calcom-webhook";
import { registerJuditWebhook } from "../integracoes/judit-webhook";
import { registerAsaasWebhook } from "../integracoes/asaas-webhook";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { iniciarJobs } from "./cron-jobs";
import { registrarSSE } from "./sse-notifications";
import { rateLimit, globalApiRateLimit } from "./rate-limit";
import { createLogger } from "./logger";
import { runMigrations } from "./auto-migrate";
import { initSentry, captureError } from "./sentry";

// Sentry tem que inicializar ANTES de qualquer outro código rodar — caso
// contrário erros lançados durante o boot (ex: migrations) escapam.
initSentry();

const log = createLogger("server");

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  // Roda migrations ANTES de tudo — garante que o schema está atualizado
  // antes do servidor aceitar qualquer request.
  await runMigrations();

  // Aviso quando o storage de uploads não está num volume persistente.
  // Em produção (Railway), uploads em ./uploads vão pro disco da instância
  // — que é efêmero a cada redeploy. Solução: anexar um volume Railway
  // montado em /app/uploads. Esse warn ajuda a flagrar a configuração
  // ausente nos logs do boot.
  if (process.env.NODE_ENV === "production") {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const uploadsDir = path.resolve(process.cwd(), "uploads");
    try {
      const stat = fs.statSync(uploadsDir);
      if (!stat.isDirectory()) {
        log.error({ uploadsDir }, "uploads/ existe mas não é diretório");
      } else if (!process.env.RAILWAY_VOLUME_MOUNT_PATH && !process.env.UPLOADS_PERSISTENT) {
        log.warn({ uploadsDir }, "uploads/ presente mas sem volume persistente declarado. Defina UPLOADS_PERSISTENT=1 quando montar volume Railway.");
      } else {
        log.info({ uploadsDir }, "uploads/ ok");
      }
    } catch {
      log.warn({ uploadsDir }, "uploads/ não existe ainda — será criado no primeiro upload, mas confirme que há volume persistente em produção");
    }
  }

  const app = express();
  const server = createServer(app);

  // Confia no proxy reverso (Railway, Vercel, Nginx, etc.) — necessário pra
  // que req.protocol detecte HTTPS via X-Forwarded-Proto. Sem isso, os cookies
  // saem com `secure: false` mesmo em HTTPS, e o navegador rejeita
  // (sameSite=none exige secure=true).
  app.set("trust proxy", 1);

  // Headers de segurança via Helmet. Defaults cobrem X-Frame-Options,
  // X-Content-Type-Options, Referrer-Policy, HSTS, X-DNS-Prefetch-Control,
  // X-Download-Options, X-Permitted-Cross-Domain-Policies e remove o header
  // X-Powered-By.
  //
  // Desabilitamos:
  //   - contentSecurityPolicy: exige curadoria caso a caso (Sentry, Vite,
  //     fontes externas). Habilitar sem testar quebra a app inteira. Fica
  //     pra um PR dedicado pós-lançamento.
  //   - crossOriginOpenerPolicy / crossOriginEmbedderPolicy: configuradas
  //     manualmente abaixo pra permitir Google Sign-In via popup.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity: {
        maxAge: 31536000, // 1 ano
        includeSubDomains: true,
        preload: false,
      },
    }),
  );

  // Cross-Origin-Opener-Policy permite popups (Google Sign-In, Facebook Login)
  // se comunicarem de volta via postMessage com a janela pai. Sem isso, o
  // popup do Google Sign-In falha ao retornar o token. Por isso desabilitamos
  // o COOP/COEP no helmet acima e definimos manualmente aqui.
  app.use((_req, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
    next();
  });

  // Body parser. Limite maior que o padrão (100KB) pra acomodar uploads em
  // base64 — 10MB de arquivo binário viram ~13.5MB de string base64.
  // 15MB cobre com folga; mais que isso é payload grande demais e pode ser
  // tentativa de DoS por exaustão de memória.
  app.use(express.json({ limit: "15mb" }));
  app.use(express.urlencoded({ limit: "15mb", extended: true }));
  // Serve uploaded files statically
  app.use("/uploads", express.static("./uploads"));
  // Rate limiting — aplicar globalmente ao tRPC e limites específicos para públicas
  app.use("/api/trpc", globalApiRateLimit);
  app.use(
    "/api/trpc/assinaturas.visualizarPorToken",
    rateLimit({ name: "sign-view", max: 30 }),
  );
  app.use(
    "/api/trpc/assinaturas.assinarPorToken",
    rateLimit({ name: "sign-submit", max: 5 }),
  );
  // Webhooks públicos também precisam de limite
  app.use("/api/webhooks/asaas-billing", rateLimit({ name: "webhook-asaas-billing", max: 120 }));
  // PDF export route
  registerPDFExportRoute(app);
  // PDF export — chat interno de agentes IA
  registerAgenteChatPDFRoute(app);
  // Cal.com webhook
  registerCalcomWebhook(app);
  // Judit.IO webhook
  registerJuditWebhook(app);
  // Asaas webhook (escritório → seus clientes)
  registerAsaasWebhook(app);
  // Asaas webhook (Jurify → mensalidades dos escritórios)
  registerAsaasBillingWebhook(app);
  // WhatsApp Cloud API (CoEx) webhook
  const { registerWhatsAppCloudWebhook } = await import("../integracoes/whatsapp-cloud-webhook");
  registerWhatsAppCloudWebhook(app);

  // Resolução de ambiente — `JURIFY_AMBIENTE` tem precedência (set
  // explicitamente no Railway de staging). Fallback pra `NODE_ENV`.
  // Frontend lê isso via /api/health/live pra mostrar banner amarelo
  // em staging.
  const ambiente = (process.env.JURIFY_AMBIENTE
    || (process.env.NODE_ENV === "production" ? "production"
        : process.env.NODE_ENV === "staging" ? "staging"
        : "development")) as "production" | "staging" | "development";

  // Health check — usado pelo Railway/loadbalancer pra saber se o app respira.
  // Faz ping no MySQL com timeout curto pra detectar DB caído. Sem ele,
  // o LB acha que tá tudo bem mesmo se as queries tão estourando timeout.
  // /api/health/live (sempre 200, só prova que o processo Node respira) /
  // /api/health (200 só se DB responde — usado como readiness check).
  app.get("/api/health/live", (_req, res) => {
    res.json({
      ok: true,
      ambiente,
      uptime: process.uptime(),
      now: new Date().toISOString(),
    });
  });

  app.get("/api/health", async (_req, res) => {
    const inicio = Date.now();
    try {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) {
        res.status(503).json({
          ok: false,
          ambiente,
          db: "unavailable",
          reason: "getDb retornou null",
          uptime: process.uptime(),
        });
        return;
      }
      // Ping com timeout 2s — DB lento conta como falha pro health.
      const ping = await Promise.race([
        (async () => {
          const { sql } = await import("drizzle-orm");
          const result = await db.execute(sql`SELECT 1 AS ok`);
          return result;
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DB ping timeout 2s")), 2000),
        ),
      ]);
      res.json({
        ok: true,
        ambiente,
        db: "ok",
        latencyMs: Date.now() - inicio,
        uptime: process.uptime(),
        now: new Date().toISOString(),
        ping: !!ping,
      });
    } catch (err: any) {
      res.status(503).json({
        ok: false,
        ambiente,
        db: "error",
        reason: err.message || String(err),
        latencyMs: Date.now() - inicio,
        uptime: process.uptime(),
      });
    }
  });

  // SSE real-time notifications
  registrarSSE(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    log.info({ preferredPort, port }, "Preferred port busy, using fallback");
  }

  server.listen(port, () => {
    log.info({ port }, `Server running on http://localhost:${port}/`);
    verificarMysqldumpDisponivel();
    iniciarJobs();
  });
}

// Diagnóstico de boot: confirma se o binário `mysqldump` está disponível
// no PATH. Backup global usa spawn("mysqldump", ...) — se o binário não
// estiver no container, falha com ENOENT/exit=-2 só na hora do uso, e a
// causa raiz fica obscurecida (especialmente no admin UI, onde HTTP
// timeouta antes do erro chegar). Logando no startup, qualquer regressão
// no nixpacks.toml fica visível imediatamente.
function verificarMysqldumpDisponivel(): void {
  import("node:child_process").then(({ spawnSync }) => {
    const r = spawnSync("mysqldump", ["--version"], { encoding: "utf-8" });
    if (r.error || r.status !== 0) {
      const log = createLogger("backup-startup");
      log.error(
        {
          err: r.error?.message,
          status: r.status,
          stderr: r.stderr?.slice(0, 500),
          path: process.env.PATH,
        },
        "[backup-startup] mysqldump NÃO disponível no container — backups vão falhar com ENOENT",
      );
      return;
    }
    const log = createLogger("backup-startup");
    log.info({ versao: r.stdout.trim() }, "[backup-startup] mysqldump OK");
  });
}

// Captura erros assíncronos que escapam de promises e exceções não tratadas.
// Sem isso, qualquer rejection silenciosa vira processo morto sem rastro.
// O Sentry (quando configurado) também capta — esses handlers só garantem o
// log estruturado e que o processo não fique num estado inconsistente.
process.on("unhandledRejection", (reason) => {
  log.error({ reason: reason instanceof Error ? reason.stack : String(reason) }, "Unhandled promise rejection");
  captureError(reason, { kind: "unhandledRejection" });
});

process.on("uncaughtException", (err) => {
  log.fatal({ err: err.stack || err.message }, "Uncaught exception");
  captureError(err, { kind: "uncaughtException" });
  // Crash deliberado: estado do processo é desconhecido depois de uma uncaught.
  // Railway/PM2 reinicia. Melhor reiniciar limpo do que servir requests com bug.
  process.exit(1);
});

startServer().catch((err) => {
  log.fatal({ err: String(err) }, "Failed to start server");
  process.exit(1);
});
