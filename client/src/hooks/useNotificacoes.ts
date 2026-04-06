/**
 * Hook de notificações em tempo real via SSE
 * 
 * Uso no AppLayout:
 *   const { naoLidas, limpar } = useNotificacoes(user?.id);
 * 
 * Conecta automaticamente ao SSE, exibe toast para cada notificação,
 * e mantém contador de não-lidas.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";

export interface Notificacao {
  tipo: string;
  titulo: string;
  mensagem: string;
  dados?: Record<string, any>;
  timestamp: string;
}

const ICONES_TIPO: Record<string, string> = {
  nova_mensagem: "💬",
  novo_lead: "🎯",
  conversa_atribuida: "📋",
  assinatura_concluida: "✅",
  movimentacao_processo: "⚖️",
  info: "ℹ️",
};

export function useNotificacoes(userId: number | undefined) {
  const [naoLidas, setNaoLidas] = useState(0);
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconectarRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const conectar = useCallback(() => {
    if (!userId) return;

    // Fechar conexão anterior
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`/api/events?userId=${userId}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as Notificacao;

        // Ignorar heartbeats e conexão
        if (data.tipo === "conectado") return;

        // Adicionar à lista
        setNotificacoes(prev => [data, ...prev].slice(0, 50));
        setNaoLidas(prev => prev + 1);

        // Exibir toast
        const icone = ICONES_TIPO[data.tipo] || "🔔";
        toast(`${icone} ${data.titulo}`, {
          description: data.mensagem,
          duration: 5000,
          action: data.tipo === "nova_mensagem" ? {
            label: "Ver",
            onClick: () => {
              window.location.href = "/atendimento";
            },
          } : undefined,
        });
      } catch {
        // Ignorar mensagens inválidas
      }
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      // Reconectar em 5 segundos
      if (reconectarRef.current) clearTimeout(reconectarRef.current);
      reconectarRef.current = setTimeout(() => conectar(), 5000);
    };
  }, [userId]);

  useEffect(() => {
    conectar();
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
      if (reconectarRef.current) clearTimeout(reconectarRef.current);
    };
  }, [conectar]);

  const limpar = useCallback(() => {
    setNaoLidas(0);
  }, []);

  const limparTudo = useCallback(() => {
    setNaoLidas(0);
    setNotificacoes([]);
  }, []);

  return { naoLidas, notificacoes, limpar, limparTudo };
}
