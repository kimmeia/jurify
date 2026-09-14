/**
 * Origem do lead por anúncio (Click-to-WhatsApp).
 *
 * A Meta manda o bloco `referral` na PRIMEIRA mensagem de quem clicou num
 * anúncio do Facebook/Instagram com destino WhatsApp. Guardamos no contato
 * para o atendimento saber de onde a pessoa veio e para a atribuição por
 * campanha existir — sem isso o escritório paga tráfego sem saber qual
 * anúncio traz cliente que fecha.
 *
 * Atribuição FIRST-TOUCH: grava só quando ainda não há origem. Quem volta
 * meses depois por outro anúncio continua creditado ao primeiro.
 */

import { contatos } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import type { ReferralAnuncio } from "../../shared/whatsapp-types";
import { createLogger } from "../_core/logger";

const log = createLogger("integracoes-whatsapp-origem-anuncio");

/** Lê a origem gravada. `null` quando o contato não veio de anúncio. */
export function parseOrigemAnuncio(json: string | null | undefined): ReferralAnuncio | null {
  if (!json) return null;
  try {
    const o = JSON.parse(json);
    return o && typeof o === "object" ? (o as ReferralAnuncio) : null;
  } catch {
    return null;
  }
}

/**
 * Recorte da origem que vai pra LISTA de conversas — o cartão do anúncio e o
 * selo. Fora daqui ficam `sourceId` e `ctwaClid`: são identificadores de
 * atribuição, usados no relatório dentro do servidor, e a lista carrega
 * centenas de linhas. `null` quando o contato não veio de anúncio.
 */
export function origemAnuncioParaLista(json: string | null | undefined): {
  titulo: string;
  corpo: string;
  midiaTipo: string;
  sourceType: string;
  sourceUrl: string;
  thumbnailUrl: string;
  imagemUrl: string;
} | null {
  const o = parseOrigemAnuncio(json);
  if (!o) return null;
  return {
    titulo: o.titulo || "",
    corpo: o.corpo || "",
    midiaTipo: o.midiaTipo || "",
    sourceType: o.sourceType || "",
    sourceUrl: o.sourceUrl || "",
    thumbnailUrl: o.thumbnailUrl || "",
    imagemUrl: o.imagemUrl || "",
  };
}

export async function registrarOrigemAnuncioSeAusente(
  db: any,
  contatoId: number,
  referral: ReferralAnuncio,
  quandoMs?: number,
): Promise<void> {
  try {
    const [row] = await db
      .select({ atual: contatos.origemAnuncio })
      .from(contatos)
      .where(eq(contatos.id, contatoId))
      .limit(1);
    if (!row || row.atual) return;
    await db
      .update(contatos)
      .set({
        origemAnuncio: JSON.stringify(referral),
        origemAnuncioEm: new Date(quandoMs ?? Date.now()),
      })
      .where(eq(contatos.id, contatoId));
    // Loga as CHAVES preenchidas (não o conteúdo) pra conferir, no primeiro
    // clique real, quais campos a Meta manda de fato neste tipo de criativo.
    log.info(
      {
        contatoId,
        sourceType: referral.sourceType,
        midiaTipo: referral.midiaTipo,
        campos: Object.entries(referral).filter(([, v]) => v !== "").map(([k]) => k),
      },
      "[OrigemAnuncio] lead veio de anúncio — origem gravada",
    );
  } catch (e: any) {
    // Best-effort no ATENDIMENTO (origem é enriquecimento e nunca pode
    // derrubar a mensagem do cliente), mas NUNCA silencioso: engolir sem
    // registrar deixava "a Meta não mandou referral" e "a gravação falhou"
    // com exatamente a mesma cara — nenhuma linha de log, nenhum jeito de
    // saber qual dos dois aconteceu. Coluna ausente num ambiente que não
    // migrou é o caso clássico.
    log.error(
      { contatoId, erro: String(e?.message || e).slice(0, 300) },
      "[OrigemAnuncio] FALHOU ao gravar a origem do anúncio — o lead veio de campanha e o registro se perdeu",
    );
  }
}
