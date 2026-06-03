/**
 * Hook de ligação de voz via WhatsApp Business Calling API (Meta) no navegador.
 *
 * O navegador do atendente é o peer WebRTC: o SDP vai/vem completo (sem trickle
 * ICE — espera o gathering terminar antes de mandar). Sinalização:
 *   - servidor → navegador: eventos SSE (window "jurify:notif", kind
 *     "sinalizacao_chamada") repassados pelo useNotificacoes global
 *   - navegador → servidor: mutations tRPC (whatsappCalling.*)
 *
 * Entrada:  SSE chamada_entrante (offer) → atender() responde com o answer
 * Saída:    ligar() manda o offer → SSE chamada_resposta traz o answer da Meta
 *
 * A camada de mídia precisa de validação em staging (chamada real da Meta).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";

export type EstadoChamada = "idle" | "tocando" | "conectando" | "em_chamada" | "encerrada";

export interface ChamadaAtiva {
  callId: string;
  direcao: "entrada" | "saida";
  contatoNome: string;
  telefone: string;
}

export interface IniciarLigacaoOpts {
  canalId: number;
  telefone: string;
  contatoId?: number;
  contatoNome?: string;
  conversaId?: number;
}

// STUN público pra descoberta de candidatos. A própria oferta da Meta traz os
// candidatos de relay dela; isso cobre o lado do navegador. Pode precisar de
// ajuste/TURN em staging dependendo da rede.
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

/** Espera o ICE gathering terminar (ou um teto de tempo) pra mandar o SDP completo. */
function esperarIceCompleto(pc: RTCPeerConnection, timeoutMs = 3000): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const finalizar = () => {
      pc.removeEventListener("icegatheringstatechange", checar);
      resolve();
    };
    const checar = () => {
      if (pc.iceGatheringState === "complete") finalizar();
    };
    pc.addEventListener("icegatheringstatechange", checar);
    setTimeout(finalizar, timeoutMs);
  });
}

export function useWhatsappCall() {
  const [estado, setEstado] = useState<EstadoChamada>("idle");
  const [chamada, setChamada] = useState<ChamadaAtiva | null>(null);
  const [duracaoSegundos, setDuracao] = useState(0);
  const [erro, setErro] = useState("");
  const [mudo, setMudo] = useState(false);
  // Ligação de saída barrada por falta de permissão do cliente → oferece o
  // pedido de permissão na própria UI.
  const [precisaPermissao, setPrecisaPermissao] = useState(false);
  const [permissaoEnviada, setPermissaoEnviada] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ofertaPendenteRef = useRef<string | null>(null); // offer do connect de entrada
  const ultimaLigacaoRef = useRef<IniciarLigacaoOpts | null>(null); // pra reusar no pedido de permissão
  const estadoRef = useRef(estado);
  const chamadaRef = useRef<ChamadaAtiva | null>(null);
  estadoRef.current = estado;

  const preAceitar = trpc.whatsappCalling.preAceitar.useMutation();
  const aceitar = trpc.whatsappCalling.aceitar.useMutation();
  const rejeitar = trpc.whatsappCalling.rejeitar.useMutation();
  const encerrar = trpc.whatsappCalling.encerrar.useMutation();
  const iniciar = trpc.whatsappCalling.iniciarChamada.useMutation();
  const permissao = trpc.whatsappCalling.pedirPermissao.useMutation();

  // Elemento de áudio (destacado do DOM) pra tocar a voz do cliente.
  useEffect(() => {
    const audio = new Audio();
    audio.autoplay = true;
    remoteAudioRef.current = audio;
    return () => {
      audio.pause();
      audio.srcObject = null;
      remoteAudioRef.current = null;
    };
  }, []);

  const limparMidia = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {
        /* ignore */
      }
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
  }, []);

  const definirChamada = useCallback((c: ChamadaAtiva | null) => {
    chamadaRef.current = c;
    setChamada(c);
  }, []);

  /** Encerra localmente (mídia + estado), sem chamar a API. */
  const finalizar = useCallback(() => {
    limparMidia();
    ofertaPendenteRef.current = null;
    setMudo(false);
    setPrecisaPermissao(false);
    setPermissaoEnviada(false);
    setEstado("encerrada");
    setTimeout(() => {
      if (estadoRef.current === "encerrada") {
        setEstado("idle");
        definirChamada(null);
        setDuracao(0);
        setErro("");
      }
    }, 2500);
  }, [limparMidia, definirChamada]);

  /**
   * Encerra uma ligação de saída que a API recusou, mantendo a UI aberta com a
   * opção de pedir permissão (causa mais comum de recusa). Sem auto-reset.
   */
  const encerrarComPermissao = useCallback(
    (msg: string) => {
      limparMidia();
      ofertaPendenteRef.current = null;
      setMudo(false);
      setErro(msg);
      setPrecisaPermissao(true);
      setEstado("encerrada");
    },
    [limparMidia],
  );

  const iniciarTimer = useCallback(() => {
    if (timerRef.current) return;
    setDuracao(0);
    timerRef.current = setInterval(() => setDuracao((d) => d + 1), 1000);
  }, []);

  /** Monta o RTCPeerConnection com mic local + saída de áudio remota. */
  const montarPeer = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const pc = new RTCPeerConnection(RTC_CONFIG);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    pc.ontrack = (e) => {
      const audio = remoteAudioRef.current;
      if (audio && e.streams[0]) {
        audio.srcObject = e.streams[0];
        audio.play().catch(() => {
          /* autoplay pode falhar sem gesto; o gesto de atender/ligar cobre */
        });
      }
    };
    pcRef.current = pc;
    localStreamRef.current = stream;
    return { pc, stream };
  }, []);

  // ─── Ações do atendente ────────────────────────────────────────────────────

  /** Atende uma chamada recebida (responde o offer com o answer). */
  const atender = useCallback(async () => {
    const c = chamadaRef.current;
    const offer = ofertaPendenteRef.current;
    if (!c || !offer) return;
    try {
      setErro("");
      setEstado("conectando");
      const { pc } = await montarPeer();
      await pc.setRemoteDescription({ type: "offer", sdp: offer });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await esperarIceCompleto(pc);
      const sdpAnswer = pc.localDescription?.sdp || answer.sdp || "";
      // pre_accept estabelece a mídia antes; accept finaliza. Ordem importa.
      await preAceitar.mutateAsync({ callId: c.callId, sdpAnswer });
      await aceitar.mutateAsync({ callId: c.callId, sdpAnswer });
      setEstado("em_chamada");
      iniciarTimer();
    } catch (e: any) {
      setErro(e?.message || "Falha ao atender a chamada");
      try {
        await encerrar.mutateAsync({ callId: c.callId });
      } catch {
        /* ignore */
      }
      finalizar();
    }
  }, [montarPeer, preAceitar, aceitar, encerrar, iniciarTimer, finalizar]);

  /** Recusa uma chamada recebida. */
  const recusar = useCallback(async () => {
    const c = chamadaRef.current;
    if (c) {
      try {
        await rejeitar.mutateAsync({ callId: c.callId });
      } catch {
        /* ignore */
      }
    }
    finalizar();
  }, [rejeitar, finalizar]);

  /** Desliga uma chamada em andamento (qualquer direção). */
  const desligar = useCallback(async () => {
    const c = chamadaRef.current;
    if (c?.callId) {
      try {
        await encerrar.mutateAsync({ callId: c.callId });
      } catch {
        /* ignore */
      }
    }
    finalizar();
  }, [encerrar, finalizar]);

  /** Inicia uma chamada da empresa pro cliente (saída). */
  const ligar = useCallback(
    async (opts: IniciarLigacaoOpts) => {
      if (estadoRef.current !== "idle" && estadoRef.current !== "encerrada") return;
      ultimaLigacaoRef.current = opts;
      setPrecisaPermissao(false);
      setPermissaoEnviada(false);
      let chegouNaApi = false;
      try {
        setErro("");
        setEstado("conectando");
        definirChamada({
          callId: "",
          direcao: "saida",
          contatoNome: opts.contatoNome || opts.telefone,
          telefone: opts.telefone,
        });
        const { pc } = await montarPeer();
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await esperarIceCompleto(pc);
        const sdpOffer = pc.localDescription?.sdp || offer.sdp || "";
        chegouNaApi = true;
        const { callId } = await iniciar.mutateAsync({
          canalId: opts.canalId,
          telefone: opts.telefone,
          sdpOffer,
          contatoId: opts.contatoId,
          conversaId: opts.conversaId,
        });
        // Guarda o callId e espera o answer da Meta via SSE (chamada_resposta).
        if (chamadaRef.current) definirChamada({ ...chamadaRef.current, callId });
      } catch (e: any) {
        const msg = e?.message || "Falha ao iniciar a chamada";
        // Erro na chamada à Meta (não na mídia local) → provável falta de
        // permissão. Mantém a UI com a opção de pedir permissão.
        if (chegouNaApi) encerrarComPermissao(msg);
        else {
          setErro(msg);
          finalizar();
        }
      }
    },
    [montarPeer, iniciar, definirChamada, finalizar, encerrarComPermissao],
  );

  /** Envia o pedido de permissão de ligação ao cliente (reusa a última ligação). */
  const pedirPermissao = useCallback(async () => {
    const opts = ultimaLigacaoRef.current;
    if (!opts) return;
    try {
      await permissao.mutateAsync({ canalId: opts.canalId, telefone: opts.telefone });
      setPermissaoEnviada(true);
    } catch (e: any) {
      setErro(e?.message || "Falha ao enviar o pedido de permissão");
    }
  }, [permissao]);

  /** Liga/desliga o microfone. */
  const alternarMudo = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    setMudo((prev) => {
      const novo = !prev;
      stream.getAudioTracks().forEach((t) => (t.enabled = !novo));
      return novo;
    });
  }, []);

  /** Fecha a UI quando a chamada já terminou. */
  const fechar = useCallback(() => {
    limparMidia();
    setEstado("idle");
    definirChamada(null);
    setDuracao(0);
    setErro("");
    setPrecisaPermissao(false);
    setPermissaoEnviada(false);
  }, [limparMidia, definirChamada]);

  // ─── Recepção dos sinais SSE ────────────────────────────────────────────────
  useEffect(() => {
    function onNotif(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (!detail || detail.dados?.kind !== "sinalizacao_chamada") return;
      const d = detail.dados as Record<string, any>;

      if (detail.tipo === "chamada_entrante") {
        // Só toca se estiver livre — não interrompe uma chamada em curso.
        if (estadoRef.current !== "idle" && estadoRef.current !== "encerrada") return;
        ofertaPendenteRef.current = d.sdpOffer || null;
        definirChamada({
          callId: d.callId,
          direcao: "entrada",
          contatoNome: d.contatoNome || d.telefone || "Contato",
          telefone: d.telefone || "",
        });
        setErro("");
        setEstado("tocando");
      } else if (detail.tipo === "chamada_resposta") {
        const c = chamadaRef.current;
        const pc = pcRef.current;
        if (!c || c.callId !== d.callId || !pc || !d.sdpAnswer) return;
        pc.setRemoteDescription({ type: "answer", sdp: d.sdpAnswer })
          .then(() => {
            setEstado("em_chamada");
            iniciarTimer();
          })
          .catch(() => setErro("Falha na conexão de mídia"));
      } else if (detail.tipo === "chamada_encerrada") {
        const c = chamadaRef.current;
        if (!c || c.callId !== d.callId) return;
        finalizar();
      }
    }

    window.addEventListener("jurify:notif", onNotif);
    return () => window.removeEventListener("jurify:notif", onNotif);
  }, [definirChamada, iniciarTimer, finalizar]);

  // Cleanup ao desmontar.
  useEffect(() => () => limparMidia(), [limparMidia]);

  return {
    estado,
    chamada,
    duracaoSegundos,
    erro,
    mudo,
    precisaPermissao,
    permissaoEnviada,
    enviandoPermissao: permissao.isPending,
    atender,
    recusar,
    desligar,
    ligar,
    pedirPermissao,
    alternarMudo,
    fechar,
  };
}

export type UseWhatsappCall = ReturnType<typeof useWhatsappCall>;
