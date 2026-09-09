import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "node:path";
import { defineConfig } from "vite";

const plugins = [react(), tailwindcss(), jsxLocPlugin()];

// Sentry sourcemaps — só se SENTRY_AUTH_TOKEN existir no build (CI/Railway).
// Em dev local sem token, plugin fica fora pra não atrasar o boot.
// Sem o plugin, stack traces de prod chegam minificados no Sentry e ficam
// inúteis. Com ele, sourcemaps são uploadados após o build e excluídos
// dos assets servidos (filesToDeleteAfterUpload).
if (process.env.SENTRY_AUTH_TOKEN) {
  plugins.push(
    sentryVitePlugin({
      authToken: process.env.SENTRY_AUTH_TOKEN,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT_FRONTEND || process.env.SENTRY_PROJECT,
      release: {
        name:
          process.env.RAILWAY_GIT_COMMIT_SHA ||
          process.env.GIT_COMMIT ||
          process.env.VITE_GIT_COMMIT_SHA,
      },
      sourcemaps: {
        filesToDeleteAfterUpload: ["**/*.map"],
      },
      telemetry: false,
    }),
  );
}

export default defineConfig({
  plugins,
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(import.meta.dirname, "client", "src") },
      { find: "@shared", replacement: path.resolve(import.meta.dirname, "shared") },
      { find: "@assets", replacement: path.resolve(import.meta.dirname, "attached_assets") },
      // pdfjs no build LEGACY (regex de match exato — subpaths como
      // `pdfjs-dist/legacy/build/...` continuam resolvendo direto). O build
      // moderno usa Promise.withResolvers, que não existe em iOS < 17.4 nem
      // em Samsung Internet antigo: nesses aparelhos o preview do documento
      // na tela pública de assinatura quebrava. Biblioteca e worker têm que
      // ser da mesma variante.
      { find: /^pdfjs-dist$/, replacement: "pdfjs-dist/legacy/build/pdf.mjs" },
    ],
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Necessário pro Sentry produzir sourcemaps. O plugin acima deleta os
    // arquivos .map dos assets finais depois de subir pro Sentry, então
    // não vão pra produção — só ficam disponíveis pra symbolicação remota.
    sourcemap: true,
  },
  server: {
    host: true,
    allowedHosts: [
      "localhost",
      "127.0.0.1",
    ],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
