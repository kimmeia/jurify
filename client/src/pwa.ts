/**
 * Registro do service worker do PWA. Chamado uma vez no main.tsx.
 *
 * Só registra em produção (build): em dev o Vite tem HMR e um SW só
 * atrapalharia o ciclo de recarga. Quando há versão nova, manda o SW novo
 * assumir na hora (skip-waiting) e recarrega a aba uma única vez — evita o
 * usuário ficar preso numa versão antiga.
 */
export function registrarServiceWorker() {
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        reg.addEventListener("updatefound", () => {
          const novo = reg.installing;
          if (!novo) return;
          novo.addEventListener("statechange", () => {
            // Há um SW novo instalado E já existe um controlando a página
            // → é uma ATUALIZAÇÃO (não a primeira instalação). Ativa já.
            if (novo.state === "installed" && navigator.serviceWorker.controller) {
              novo.postMessage("skip-waiting");
            }
          });
        });
      })
      .catch(() => {
        /* registro best-effort — falha não pode quebrar o app */
      });

    // Quando o SW novo assume o controle, recarrega uma vez pra pegar os
    // assets novos. `recarregou` evita loop de reload.
    let recarregou = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (recarregou) return;
      recarregou = true;
      window.location.reload();
    });
  });
}
