/**
 * Hook de Web Push (PWA). Pede permissão, inscreve o dispositivo (com a
 * chave VAPID do servidor) e registra/remove no backend.
 *
 * Uso: const { suportado, estado, ativar, desativar, ocupado } = usePush();
 *   - estado: "indisponivel" | "negado" | "desativado" | "ativo"
 */

import { useCallback, useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

type EstadoPush = "indisponivel" | "negado" | "desativado" | "ativo";

function suportaPush(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** base64url (VAPID) → Uint8Array exigido por applicationServerKey. */
function base64UrlParaUint8(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function usePushNotifications() {
  const suportado = suportaPush();
  const [estado, setEstado] = useState<EstadoPush>(suportado ? "desativado" : "indisponivel");
  const [ocupado, setOcupado] = useState(false);

  const utils = trpc.useUtils();
  const inscrever = trpc.push.inscrever.useMutation();
  const desinscrever = trpc.push.desinscrever.useMutation();

  // Estado inicial: permissão + se já há inscrição ativa neste device.
  useEffect(() => {
    if (!suportado) return;
    (async () => {
      if (Notification.permission === "denied") {
        setEstado("negado");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setEstado(sub && Notification.permission === "granted" ? "ativo" : "desativado");
      } catch {
        setEstado("desativado");
      }
    })();
  }, [suportado]);

  const ativar = useCallback(async () => {
    if (!suportado || ocupado) return false;
    setOcupado(true);
    try {
      const permissao = await Notification.requestPermission();
      if (permissao !== "granted") {
        setEstado(permissao === "denied" ? "negado" : "desativado");
        return false;
      }
      const { publicKey } = await utils.push.chavePublica.fetch();
      if (!publicKey) {
        setEstado("desativado");
        return false;
      }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          // cast: a lib DOM tipa como ArrayBuffer-backed; em runtime o
          // Uint8Array é aceito normalmente como BufferSource.
          applicationServerKey: base64UrlParaUint8(publicKey) as unknown as BufferSource,
        });
      }
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        setEstado("desativado");
        return false;
      }
      await inscrever.mutateAsync({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        userAgent: navigator.userAgent,
      });
      setEstado("ativo");
      return true;
    } catch {
      setEstado("desativado");
      return false;
    } finally {
      setOcupado(false);
    }
  }, [suportado, ocupado, utils, inscrever]);

  const desativar = useCallback(async () => {
    if (!suportado || ocupado) return;
    setOcupado(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const json = sub.toJSON() as { endpoint?: string };
        if (json.endpoint) await desinscrever.mutateAsync({ endpoint: json.endpoint }).catch(() => undefined);
        await sub.unsubscribe().catch(() => undefined);
      }
      setEstado("desativado");
    } finally {
      setOcupado(false);
    }
  }, [suportado, ocupado, desinscrever]);

  return { suportado, estado, ativar, desativar, ocupado };
}
