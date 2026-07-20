import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerAsaasBillingWebhook } from "../billing/asaas-billing-webhook";
import { registerPDFExportRoute } from "../calculos/export-pdf-route";
import { registerAgenteChatPDFRoute } from "../integracoes/agente-chat-pdf-route";
import { registerAssinaturaPdfRoute } from "../escritorio/assinatura-pdf-route";
import { registerCalcomWebhook } from "../integracoes/calcom-webhook";
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
import { resolverAmbiente } from "./ambiente";

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
        log.warn(
          { uploadsDir },
          "⚠️  uploads/ sem volume persistente. Arquivos (modelos, assinaturas, PDFs) " +
            "serão APAGADOS no próximo deploy. Configure conforme " +
            "docs/setup-volume-railway.md e defina UPLOADS_PERSISTENT=1.",
        );
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
  // base64 — base64 infla ~33%, então arquivo binário de 2GB chega como ~2.7GB
  // de string. 3GB cobre com folga. Cuidado: uploads grandes carregam todo o
  // buffer em memória — operador com upload concorrente pode estourar a RAM
  // do Node (OOM). Limite operacional na prática é o que a infra do servidor
  // aguenta, não esse número.
  // O `verify` callback captura o body RAW como Buffer em `req.rawBody`
  // apenas pra paths de webhook que precisam validar HMAC (ex: Cal.com,
  // futuramente WhatsApp Cloud). Para o resto, `req.body` continua sendo o
  // objeto já parsed — sem custo de memória adicional em requests
  // normais do tRPC.
  app.use(
    express.json({
      limit: "3gb",
      verify: (req, _res, buf) => {
        const url = (req as { url?: string }).url ?? "";
        if (url.startsWith("/api/webhooks/")) {
          (req as { rawBody?: Buffer }).rawBody = buf;
        }
      },
    }),
  );
  app.use(express.urlencoded({ limit: "3gb", extended: true }));
  // /uploads AUTENTICADO. Antes era express.static puro — documento jurídico
  // com PII acessível por URL sem login (LGPD). O assinante EXTERNO não usa
  // este caminho (tem rota própria por token — assinatura-pdf-route); todo
  // consumidor interno é same-origin e manda o cookie de sessão sozinho.
  // Tenancy pelo path: `escritorio_<id>` (uploads/assinaturas/modelos) ou
  // `whatsapp-cloud/<escritorioId>/...` (mídia recebida). Path sem marcador
  // de escritório (legado) exige só login.
  // Cache curto userId→escritorioId: uma tela do Atendimento carrega dezenas
  // de mídias em paralelo — sem isso cada <img> custava um lookup de
  // colaborador no DB.
  const uploadsEscCache = new Map<number, { escritorioId: number | null; ate: number }>();
  app.use(
    "/uploads",
    async (req, res, next) => {
      // Exceção PÚBLICA por design: pareceres são capability-URLs (slug +
      // timestamp + random) compartilhados com o CLIENTE do advogado por
      // e-mail/WhatsApp — destinatário externo não tem sessão. O resto do
      // /uploads exige login + escritório.
      if (req.path.startsWith("/pareceres/")) {
        next();
        return;
      }
      try {
        const { sdk } = await import("./sdk");
        const user = await sdk.authenticateRequest(req);
        const m =
          req.path.match(/escritorio_(\d+)/) || req.path.match(/^\/whatsapp-cloud\/(\d+)\//);
        if (m && user.role !== "admin") {
          const agora = Date.now();
          let entrada = uploadsEscCache.get(user.id);
          if (!entrada || entrada.ate < agora) {
            const { getEscritorioPorUsuario } = await import("../escritorio/db-escritorio");
            const esc = await getEscritorioPorUsuario(user.id);
            entrada = { escritorioId: esc?.escritorio.id ?? null, ate: agora + 60_000 };
            uploadsEscCache.set(user.id, entrada);
          }
          if (entrada.escritorioId !== Number(m[1])) {
            res.status(403).json({ error: "Sem acesso a este arquivo" });
            return;
          }
        }
        next();
      } catch {
        res.status(401).json({ error: "Não autenticado" });
      }
    },
    express.static("./uploads"),
  );
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
  // PDF preview/serve pra fluxo de assinatura (com auth + logs)
  registerAssinaturaPdfRoute(app);
  // Cal.com webhook
  registerCalcomWebhook(app);
  // Asaas webhook (escritório → seus clientes)
  registerAsaasWebhook(app);
  // Asaas webhook (JuridFlow → mensalidades dos escritórios)
  registerAsaasBillingWebhook(app);
  // WhatsApp Cloud API (CoEx) webhook
  const { registerWhatsAppCloudWebhook } = await import("../integracoes/whatsapp-cloud-webhook");
  registerWhatsAppCloudWebhook(app);

  // Resolução de ambiente — centralizada em ./ambiente.ts. Ordem:
  //   1. JURIFY_AMBIENTE  (override manual)
  //   2. RAILWAY_ENVIRONMENT_NAME  (auto-setado pelo Railway)
  //   3. NODE_ENV  (fallback)
  // Frontend lê isso via /api/health/live pra mostrar banner amarelo
  // em staging.
  const ambiente = resolverAmbiente();

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
    verificarChromiumDisponivel();
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

// Diagnóstico de boot: confirma se o Chromium do Playwright está instalado.
// O motor próprio (auto-validação de credenciais do cofre + monitoramento de
// processos) depende dele em runtime. Se o binário não estiver no container,
// TODA revalidação automática falha — e o sintoma (processos param de
// atualizar) aparece longe da causa. Logando no boot, a ausência fica óbvia
// na hora, em vez de virar uma falha silenciosa no meio de um cron.
function verificarChromiumDisponivel(): void {
  const log = createLogger("motor-startup");
  import("@playwright/test")
    .then(async ({ chromium }) => {
      const { existsSync } = await import("node:fs");
      let execPath: string | null = null;
      try {
        execPath = chromium.executablePath();
      } catch {
        execPath = null;
      }
      if (!execPath || !existsSync(execPath)) {
        log.error(
          {
            execPath,
            ambiente: resolverAmbiente(),
            jurifyAmbiente: process.env.JURIFY_AMBIENTE ?? "(unset)",
          },
          "[motor-startup] Chromium do Playwright NÃO encontrado — auto-validação de credenciais e monitoramento do motor próprio vão falhar neste ambiente.",
        );
        return;
      }
      log.info({ execPath }, "[motor-startup] Chromium do motor próprio disponível");
    })
    .catch((err) => {
      log.error(
        { err: err instanceof Error ? err.message : String(err) },
        "[motor-startup] não foi possível verificar o Chromium (pacote @playwright/test ausente em runtime?)",
      );
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
