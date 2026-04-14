import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

const queryClient = new QueryClient();

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
    const target = getLoginUrl() || "/";
    window.location.href = target;
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
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    handleAuthError(error);
    console.error("[API Mutation Error]", error);
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
