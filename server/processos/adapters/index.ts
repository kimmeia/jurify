/**
 * Despachante do motor próprio: dado o tribunal, escolhe o adapter.
 *
 * Existiam dois "if (tribunal === 'tjce')" no runner da aba Consultar e um
 * "if (mon.tribunal === 'trf5')" no cron — três lugares decidindo a mesma
 * coisa, cada um sabendo de um tribunal só. Agora a decisão mora aqui:
 *  - tribunal do REGISTRO (PDPJ, com credencial) → `consultarTjce` com a
 *    config DO tribunal (o runner chamava sem config e caía sempre no TJCE);
 *  - tribunal de consulta pública → adapter aberto, carregado sob demanda
 *    (cada um puxa o Playwright do spike; carregar só quando usa);
 *  - fora dos dois → a mesma mensagem que o router já dá.
 */

import { consultarTjce, consultarTjcePorCpf, type OpcoesConsulta } from "./pje-tjce";
import { getConfigTribunal } from "../tribunais-pdpj";
import { mensagemTribunalSemMotor, siglaDoTribunal } from "../../../shared/tribunais-pje";
import type { ResultadoScraper } from "../../../scripts/spike-motor-proprio/lib/types-spike";

export type AdapterPublico = (cnj: string) => Promise<ResultadoScraper>;

/**
 * Tribunais de consulta pública e como carregar o adapter de cada um. A chave
 * é o código do CNJ; a lista compartilhada (`TRIBUNAIS_CONSULTA_PUBLICA_PJE`)
 * tem que ter EXATAMENTE estas chaves — o teste trava.
 */
export const ADAPTERS_PUBLICOS: Record<string, () => Promise<AdapterPublico>> = {
  trf5: async () => (await import("./pje-trf5")).consultarTrf5,
  trt2: async () => (await import("./pje-trt")).consultarTrt2,
  trt15: async () => (await import("./pje-trt")).consultarTrt15,
};

export function temAdapterPublico(codigoTribunal: string): boolean {
  return Object.prototype.hasOwnProperty.call(ADAPTERS_PUBLICOS, codigoTribunal);
}

export type OpcoesDespacho = OpcoesConsulta & {
  /** Grau da consulta nos tribunais do registro (1 por padrão). */
  grau?: 1 | 2;
};

/**
 * Consulta um processo por número no tribunal informado.
 *
 * `storageStateJson` null = sem sessão: só resolve em tribunal de consulta
 * pública. Tribunal do registro sem sessão é erro próprio (não "sem motor" —
 * o motor existe, faltou a credencial).
 */
export async function consultarProcesso(
  codigoTribunal: string,
  cnj: string,
  storageStateJson: string | null,
  opts?: OpcoesDespacho,
): Promise<ResultadoScraper> {
  const { grau, ...opcoesConsulta } = opts ?? {};
  const cfg = getConfigTribunal(codigoTribunal, grau ?? 1);
  if (storageStateJson && cfg) {
    return consultarTjce(cnj, storageStateJson, cfg, opcoesConsulta);
  }
  if (temAdapterPublico(codigoTribunal)) {
    const adapter = await ADAPTERS_PUBLICOS[codigoTribunal]();
    return adapter(cnj);
  }
  if (cfg) {
    throw new Error(
      `O ${siglaDoTribunal(codigoTribunal)} exige credencial no Cofre — nenhuma sessão foi informada.`,
    );
  }
  throw new Error(mensagemTribunalSemMotor(siglaDoTribunal(codigoTribunal)));
}

/**
 * Busca processos por CPF/CNPJ no tribunal informado. Só existe com sessão,
 * em tribunal do registro: a busca por parte é tela autenticada do PJe.
 */
export async function consultarPorDocumento(
  codigoTribunal: string,
  tipo: "cpf" | "cnpj",
  valor: string,
  storageStateJson: string,
): Promise<Awaited<ReturnType<typeof consultarTjcePorCpf>>> {
  const cfg = getConfigTribunal(codigoTribunal);
  if (!cfg) {
    throw new Error(
      `Busca por ${tipo.toUpperCase()} não disponível no ${siglaDoTribunal(codigoTribunal)}: ` +
        `o tribunal não está no registro do PJe com credencial.`,
    );
  }
  return consultarTjcePorCpf(valor, storageStateJson, cfg);
}
