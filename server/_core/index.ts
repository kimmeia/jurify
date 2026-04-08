import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerAsaasBillingWebhook } from "../billing/asaas-billing-webhook";
import { registerPDFExportRoute } from "../calculos/export-pdf-route";
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

  const app = express();
  const server = createServer(app);

  // Confia no proxy reverso (Railway, Vercel, Nginx, etc.) — necessário pra
  // que req.protocol detecte HTTPS via X-Forwarded-Proto. Sem isso, os cookies
  // saem com `secure: false` mesmo em HTTPS, e o navegador rejeita
  // (sameSite=none exige secure=true).
  app.set("trust proxy", 1);

  // Headers de segurança — Cross-Origin-Opener-Policy permite popups (Google
  // Sign-In, Facebook Login) se comunicarem de volta via postMessage com a
  // janela pai. Sem isso, o popup do Google Sign-In falha ao retornar o token.
  app.use((_req, res, next) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
    next();
  });

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
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

  // Diagnostic endpoint (temporary)
  app.get("/api/debug/templates", async (_req, res) => {
    let conn: any = null;
    try {
      const mysql = await import("mysql2/promise");
      conn = await mysql.createConnection(process.env.DATABASE_URL!);
      const results: any = {};

      try {
        await conn.execute("CREATE TABLE IF NOT EXISTS mensagem_templates (id INT AUTO_INCREMENT PRIMARY KEY, escritorioIdTpl INT NOT NULL, tituloTpl VARCHAR(100) NOT NULL, conteudoTpl TEXT NOT NULL, categoriaTpl ENUM('saudacao','cobranca','agendamento','juridico','encerramento','outro') DEFAULT 'outro' NOT NULL, atalhoTpl VARCHAR(20), criadoPorTpl INT NOT NULL, createdAtTpl TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL, INDEX tpl_escritorio (escritorioIdTpl))");
        results.step1_createTable = "OK";
      } catch (e: any) { results.step1_error = { msg: e.message, code: e.code, errno: e.errno }; }

      try {
        const [rows] = await conn.execute("DESCRIBE mensagem_templates");
        results.step2_describe = rows;
      } catch (e: any) { results.step2_error = { msg: e.message, code: e.code }; }

      try {
        const [ins] = await conn.execute("INSERT INTO mensagem_templates (escritorioIdTpl, tituloTpl, conteudoTpl, categoriaTpl, criadoPorTpl) VALUES (1, 'test_debug', 'teste ok', 'outro', 1)");
        results.step3_insert = { ok: true, id: (ins as { insertId: number }).insertId };
      } catch (e: any) { results.step3_error = { msg: e.message, code: e.code, errno: e.errno }; }

      try {
        const [rows] = await conn.execute("SELECT * FROM mensagem_templates LIMIT 5");
        results.step4_rows = rows;
      } catch (e: any) { results.step4_error = { msg: e.message, code: e.code }; }

      try { await conn.execute("DELETE FROM mensagem_templates WHERE tituloTpl = 'test_debug'"); } catch {}

      await conn.end();
      res.json(results);
    } catch (e: any) {
      if (conn) try { await conn.end(); } catch {}
      res.json({ fatal: e.message, code: e.code });
    }
  });

  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
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
    iniciarJobs();
  });
}

startServer().catch((err) => {
  log.fatal({ err: String(err) }, "Failed to start server");
  process.exit(1);
});
