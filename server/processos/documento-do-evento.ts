/**
 * Que documento este evento tem, respondido na hora da leitura.
 *
 * A classificação era decidida na coleta e gravada pra sempre. Quando o
 * extrator de id no rótulo entrou no ar, toda movimentação já coletada ficou
 * congelada em `sem_documento` — inclusive sentenças cujo próprio rótulo diz
 * "Embargos de Declaração Não-acolhidos 226220878 - Sentença". O id estava
 * escrito na tela, e o sistema respondia que não havia documento.
 *
 * Backfill em SQL resolveria uma vez e criaria uma segunda cópia do parser,
 * que envelhece separada. Derivar na leitura resolve todas as linhas antigas
 * de uma vez, hoje, e continua valendo pra qualquer melhoria futura do
 * extrator — sem migration e com uma única fonte da verdade.
 */

import { lerDocumentoNoRotulo } from "../../shared/documento-no-rotulo";
import type { TeorStatus } from "./teor-documento";

export interface EventoComDocumento {
  /** O texto publicado pelo tribunal (`eventos_processo.conteudo`). */
  conteudo: string | null;
  teorUrl: string | null;
  teorStatus: string;
  documentoIdTribunal: string | null;
  documentoTipo: string | null;
}

/** O id do documento, venha da coleta ou do rótulo. */
export function documentoIdDoEvento(ev: EventoComDocumento): string | null {
  return ev.documentoIdTribunal ?? lerDocumentoNoRotulo(ev.conteudo ?? "")?.id ?? null;
}

export function documentoTipoDoEvento(ev: EventoComDocumento): string | null {
  return ev.documentoTipo ?? lerDocumentoNoRotulo(ev.conteudo ?? "")?.tipo ?? null;
}

/**
 * `sem_documento` só se sustenta quando não há URL nem id no rótulo.
 *
 * Os outros status são fatos do que já se tentou (deu erro, é sigiloso, já
 * leu) e não se reescrevem aqui — só a afirmação "não existe documento", que
 * é a única que o rótulo pode desmentir sozinho.
 */
export function teorStatusDoEvento(ev: EventoComDocumento): TeorStatus {
  const status = ev.teorStatus as TeorStatus;
  if (status !== "sem_documento") return status;
  const temDocumento = Boolean(ev.teorUrl) || documentoIdDoEvento(ev) !== null;
  return temDocumento ? "pendente" : "sem_documento";
}
