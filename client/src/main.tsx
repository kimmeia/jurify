import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import * as Sentry from "@sentry/react";
import App from "./App";
import "./index.css";

// Sentry — frontend. DSN injetada no build via VITE_SENTRY_DSN. Vazio = no-op.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_GIT_COMMIT_SHA as string | undefined,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    ],
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1,
  });
}

function reportToSentry(err: unknown, kind: "query" | "mutation") {
  if (!sentryDsn) return;
  if (err instanceof TRPCClientError) {
    const code = (err.data as { code?: string } | undefined)?.code;
    // Erros esperados (auth/permissão/input) não viram issue no Sentry.
    if (code === "UNAUTHORIZED" || code === "FORBIDDEN" || code === "BAD_REQUEST" ||
        code === "NOT_FOUND" || code === "CONFLICT" || code === "TOO_MANY_REQUESTS") {
      return;
    }
  }
  Sentry.captureException(err, { tags: { kind } });
}

// Defaults conservadores pra evitar tempestade de requests:
//   - staleTime 60s: dados são considerados frescos por 1min, então
//     re-render de componente (mudança de tab interno, etc) NÃO refaz
//     request. Cada query pode override pra mais (ex: 5min em badges
//     menos sensíveis) ou menos (ex: 0s em consultas on-demand).
//   - refetchOnWindowFocus false: trocar de aba do browser e voltar
//     NÃO dispara refetch. Antes (default true), abrir /financeiro
//     com 4 queries em polling + alternar abas várias vezes/hora
//     gerava picos de chamada que estouravam o rate limit do Asaas.
//   - refetchOnReconnect mantém true (default): ao voltar online faz
//     sentido refetch porque cache pode estar genuinamente velho.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

// Evita disparar logout/redirect múltiplas vezes em paralelo.
let logoutInFlight = false;

/** Faz logout server-side (limpa cookie) e redireciona pro login.
 *  Usado quando recebemos UNAUTHORIZED — inclusive o caso de
 *  ex-colaborador removido do escritório, em que a sessão precisa
 *  ser invalidada de verdade (não apenas redirecionar pra Plans). */
async function forceLogoutAndRedirect(motivo?: string) {
  if (logoutInFlight) return;
  if (typeof window === "undefined") return;
  logoutInFlight = true;
  try {
    if (motivo) {
      try {
        sessionStorage.setItem("logoutMotivo", motivo);
      } catch {}
    }
    // Chama logout direto via fetch (não depende do client tRPC, já que
    // estamos lidando com erro do client mesmo)
    await fetch("/api/trpc/auth.logout?batch=1", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ "0": { json: null } }),
    }).catch(() => {});
  } finally {
    window.location.href = "/";
  }
}

const handleAuthError = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const code = (error.data as { code?: string } | undefined)?.code;
  const isUnauthorized =
    error.message === UNAUTHED_ERR_MSG || code === "UNAUTHORIZED";

  if (!isUnauthorized) return;

  forceLogoutAndRedirect(error.message);
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    handleAuthError(error);
    console.error("[API Query Error]", error);
    reportToSentry(error, "query");
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    handleAuthError(error);
    console.error("[API Mutation Error]", error);
    reportToSentry(error, "mutation");
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
