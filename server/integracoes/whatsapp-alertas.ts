/**
 * Alertas ativos de saúde dos canais WhatsApp (Cloud API).
 *
 * Nos dois incidentes de ban (jul/2026), a degradação de qualidade só
 * existia em `log.warn` — ninguém viu antes do 131031. Aqui, transição de
 * estado (qualidade, tier, disjuntor) vira notificação in-app + SSE pro
 * DONO do escritório, seguindo o padrão de observabilidade do projeto:
 * erro de integração externa nunca mora só no log/response.
 */

import { getDb } from "../db";
import { canaisIntegrados, escritorios, notificacoes } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { createLogger } from "../_core/logger";
import { limiteDiarioPorTier } from "./whatsapp-envio-guard";

const log = createLogger("whatsapp-alertas");

export interface AlertaSaude {
  titulo: string;
  mensagem: string;
}

/**
 * Decide quais alertas uma mudança de qualidade/tier merece. Pura — só
 * transições geram alerta (persistir o mesmo valor de novo = silêncio),
 * senão o health-check horário viraria spam de notificação.
 */
export function avaliarTransicaoSaude(p: {
  qualidadeAnterior: string | null | undefined;
  qualidadeNova: string | null | undefined;
  tierAnterior?: string | null;
  tierNovo?: string | null;
}): AlertaSaude[] {
  const out: AlertaSaude[] = [];
  const qa = (p.qualidadeAnterior || "").toUpperCase();
  const qn = (p.qualidadeNova || "").toUpperCase();

  if (qn && qn !== qa) {
    if (qn === "RED") {
      out.push({
        titulo: "🔴 Qualidade do WhatsApp em VERMELHO",
        mensagem:
          "A Meta rebaixou a qualidade do número — clientes estão bloqueando/denunciando mensagens e há risco real de restrição. Os disparos proativos foram pausados automaticamente (só respostas a quem escreve saem). Reveja volume, listas e conteúdo antes de retomar.",
      });
    } else if (qn === "YELLOW") {
      out.push(
        qa === "RED"
          ? {
              titulo: "🟡 Qualidade do WhatsApp subiu para AMARELO",
              mensagem:
                "O número melhorou de vermelho para amarelo. O teto diário segue reduzido pela metade até voltar ao verde — mantenha o volume baixo.",
            }
          : {
              titulo: "🟡 Qualidade do WhatsApp caiu para AMARELO",
              mensagem:
                "Clientes estão bloqueando ou denunciando mensagens deste número. O teto diário foi reduzido pela metade automaticamente. Reduza disparos e revise o conteúdo agora — amarelo é o último aviso antes do vermelho.",
            },
      );
    } else if (qn === "GREEN" && (qa === "YELLOW" || qa === "RED")) {
      out.push({
        titulo: "🟢 Qualidade do WhatsApp voltou ao verde",
        mensagem: "O número se recuperou — tetos normais de envio restabelecidos.",
      });
    }
  }

  const ta = p.tierAnterior || null;
  const tn = p.tierNovo || null;
  if (ta && tn && ta !== tn && limiteDiarioPorTier(tn) < limiteDiarioPorTier(ta)) {
    out.push({
      titulo: "📉 Teto de mensagens rebaixado pela Meta",
      mensagem: `O limite de conversas iniciadas caiu de ${ta} para ${tn} — em geral, consequência de qualidade baixa. O sistema já respeita o novo teto automaticamente; o excedente é reagendado.`,
    });
  }

  return out;
}

/**
 * Notifica o dono do escritório sobre um evento de saúde do canal:
 * notificação in-app persistida + push SSE. Best-effort — nunca propaga
 * erro pro caminho de envio/health-check que a chamou.
 */
export async function notificarSaudeCanal(params: {
  canalId: number;
  titulo: string;
  mensagem: string;
}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const [canal] = await db
      .select({
        escritorioId: canaisIntegrados.escritorioId,
        nome: canaisIntegrados.nome,
        telefone: canaisIntegrados.telefone,
      })
      .from(canaisIntegrados)
      .where(eq(canaisIntegrados.id, params.canalId))
      .limit(1);
    if (!canal?.escritorioId) return;
    const [esc] = await db
      .select({ ownerId: escritorios.ownerId })
      .from(escritorios)
      .where(eq(escritorios.id, canal.escritorioId))
      .limit(1);
    if (!esc?.ownerId) return;

    const rotulo = canal.telefone || canal.nome || `canal ${params.canalId}`;
    const titulo = `${params.titulo} (${rotulo})`;
    await db.insert(notificacoes).values({
      userId: esc.ownerId,
      titulo: titulo.slice(0, 255),
      mensagem: params.mensagem.slice(0, 1000),
      tipo: "sistema",
    });
    const { emitirNotificacao } = await import("../_core/sse-notifications");
    emitirNotificacao(esc.ownerId, {
      tipo: "whatsapp_saude",
      titulo,
      mensagem: params.mensagem,
      dados: { canalId: params.canalId },
    });
  } catch (err) {
    log.warn(
      { canalId: params.canalId, err: err instanceof Error ? err.message : String(err) },
      "notificarSaudeCanal falhou (best-effort)",
    );
  }
}
