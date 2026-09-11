/**
 * A natureza do processo pelo banco público do CNJ.
 *
 * Reserva de quando o tribunal não devolve a capa: a página do processo não
 * abriu, o portal caiu, o layout mudou. O DataJud é dado público, não cobra
 * consulta do plano nem usa credencial do Cofre, e cobre tribunal que o motor
 * próprio ainda não raspa.
 *
 * O que ele NÃO tem é tão importante quanto o que tem: o CNJ não publica as
 * partes. Por isso esta consulta nunca decide polo — ela preenche classe,
 * assunto, vara e data, e quem diz de que lado o cliente está continua sendo
 * o robô (quando lê o processo) ou a pessoa (com o botão no card).
 *
 * Nunca lança: reserva que derruba o caminho principal não é reserva.
 */

import { BASE, chaveDataJud } from "../jurisia/datajud-client";
import { parseCnjTribunal } from "./cnj-parser";
import { normalizarCnj } from "../../scripts/spike-motor-proprio/lib/parser-utils";
import { createLogger } from "../_core/logger";

const log = createLogger("capa-datajud");

export type CapaDataJud = {
  classe: string | null;
  assuntos: string[];
  orgaoJulgador: string | null;
  /** ISO como o CNJ devolve; quem consome converte. */
  dataAjuizamento: string | null;
};

function nomeDe(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  const nome = (v as { nome?: unknown })?.nome;
  return typeof nome === "string" && nome.trim() ? nome.trim() : null;
}

/**
 * Lê o `_source` de um hit do DataJud. Separada da chamada de rede pra o teste
 * poder conferir a tradução sem subir servidor nenhum.
 */
export function lerCapaDataJud(source: unknown): CapaDataJud | null {
  if (!source || typeof source !== "object") return null;
  const o = source as Record<string, unknown>;
  const classe = nomeDe(o.classe);
  const orgaoJulgador = nomeDe(o.orgaoJulgador);
  const assuntos = (Array.isArray(o.assuntos) ? o.assuntos : [])
    .map(nomeDe)
    .filter((a): a is string => !!a)
    .slice(0, 6);
  const dataAjuizamento =
    typeof o.dataAjuizamento === "string" && o.dataAjuizamento.trim()
      ? o.dataAjuizamento.trim()
      : null;
  if (!classe && !orgaoJulgador && assuntos.length === 0) return null;
  return { classe, assuntos, orgaoJulgador, dataAjuizamento };
}

/**
 * Índice do DataJud pro CNJ informado. O `codigoTribunal` do parser já é o
 * alias que o CNJ usa ("tjce", "trf1", "trt7"), então não existe segunda
 * tabela pra sair de sincronia.
 */
export function indiceDataJudDoCnj(cnj: string): string | null {
  const tribunal = parseCnjTribunal(cnj);
  return tribunal ? `api_publica_${tribunal.codigoTribunal}` : null;
}

export async function capaPorCnjNoDataJud(
  cnj: string,
  opts: { timeoutMs?: number } = {},
): Promise<CapaDataJud | null> {
  const indice = indiceDataJudDoCnj(cnj);
  const numero = normalizarCnj(cnj);
  if (!indice || numero.length !== 20) return null;

  try {
    const chave = await chaveDataJud();
    const res = await fetch(`${BASE}/${indice}/_search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `APIKey ${chave}`,
      },
      body: JSON.stringify({
        size: 1,
        query: { match: { numeroProcesso: numero } },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
    });
    if (!res.ok) {
      log.warn({ cnj: numero, status: res.status }, "DataJud recusou a consulta de capa");
      return null;
    }
    const corpo = (await res.json()) as { hits?: { hits?: Array<{ _source?: unknown }> } };
    const primeiro = corpo?.hits?.hits?.[0]?._source;
    return lerCapaDataJud(primeiro);
  } catch (err) {
    log.warn(
      { cnj: numero, err: err instanceof Error ? err.message : String(err) },
      "DataJud não respondeu a consulta de capa",
    );
    return null;
  }
}
