/**
 * Extras avulsos por escritório: mais usuários, mais processos vigiados, mais
 * CPFs, mais números de WhatsApp — vendidos por fora do plano.
 *
 * Foram anunciados junto com o pacote de 3 planos (usuário R$ 29, +100
 * processos R$ 29, número extra R$ 49) e ficaram sem mecanismo: o teto vive na
 * linha do PLANO, então não havia onde registrar "este cliente comprou 200
 * processos a mais". Resultado: o upsell mais fácil que existe — cliente
 * dentro, já pagando, já com a dor — não era vendável.
 *
 * Moram em `escritorio_addons` com produto "extra:<chave>", a MESMA tabela e a
 * mesma semântica dos módulos avulsos (status, vigência, preço congelado na
 * concessão). Nada de coluna nova: `limiteMensal` guarda a QUANTIDADE extra e
 * `precoCentavos` o preço mensal TOTAL daquela concessão.
 *
 * Por que o preço é o total e não o unitário: ele anunciou "+100 processos por
 * R$ 29", que é pacote, não unidade — e negociar "200 por R$ 49 pra fechar o
 * cliente" tem que caber. Guardar o total congelado deixa a fatura somar a
 * linha como já soma a dos módulos, sem multiplicação nenhuma e sem discussão
 * sobre o que é "um".
 *
 * O extra SOMA ao que o plano dá (decisão do dono): é aditivo, não mexe em
 * quem já tem, e revogar é apagar a linha.
 */

export const PRODUTO_EXTRA_PREFIXO = "extra:";

/**
 * O que se vende a mais, e qual teto do plano cada um empurra.
 *
 * `zeroEIlimitado` não é detalhe: os tetos do produto discordam sobre o que
 * significa zero. Em monitoramentos, `0` (e null) quer dizer "sem teto" — o
 * `avaliarLimiteMonitoramentos` libera. Em conexões de WhatsApp, `0` quer dizer
 * "nenhuma" e bloqueia. Somar extra sem saber disso daria duas coisas erradas:
 * transformaria plano ilimitado em plano limitado ao extra, e deixaria o número
 * comprado sem efeito em quem tem plano sem WhatsApp.
 */
export const EXTRAS_AVULSOS = [
  {
    chave: "usuarios",
    rotulo: "usuários",
    rotuloSingular: "usuário",
    /** Sugestão de preço da concessão; o que vale é o congelado na linha. */
    precoSugeridoCentavos: 2900,
    passoSugerido: 1,
    zeroEIlimitado: true,
  },
  {
    chave: "processos",
    rotulo: "processos vigiados",
    rotuloSingular: "processo vigiado",
    precoSugeridoCentavos: 2900,
    passoSugerido: 100,
    zeroEIlimitado: true,
  },
  {
    chave: "cpfs",
    rotulo: "CPFs/CNPJs vigiados",
    rotuloSingular: "CPF/CNPJ vigiado",
    precoSugeridoCentavos: 2900,
    passoSugerido: 10,
    zeroEIlimitado: true,
  },
  {
    chave: "numeros",
    rotulo: "números de WhatsApp",
    rotuloSingular: "número de WhatsApp",
    precoSugeridoCentavos: 4900,
    passoSugerido: 1,
    zeroEIlimitado: false,
  },
] as const;

export type ChaveExtra = (typeof EXTRAS_AVULSOS)[number]["chave"];
export type ExtraAvulso = (typeof EXTRAS_AVULSOS)[number];

export const CHAVES_EXTRAS: readonly ChaveExtra[] = EXTRAS_AVULSOS.map((e) => e.chave);

export function ehChaveExtra(v: unknown): v is ChaveExtra {
  return typeof v === "string" && (CHAVES_EXTRAS as readonly string[]).includes(v);
}

export function definicaoDoExtra(chave: string): ExtraAvulso | null {
  return EXTRAS_AVULSOS.find((e) => e.chave === chave) ?? null;
}

export function extraParaProduto(chave: ChaveExtra): string {
  return `${PRODUTO_EXTRA_PREFIXO}${chave}`;
}

/** `null` pra produto que não é extra — é o filtro que separa das outras famílias. */
export function produtoParaExtra(produto: string): ChaveExtra | null {
  if (!produto.startsWith(PRODUTO_EXTRA_PREFIXO)) return null;
  const chave = produto.slice(PRODUTO_EXTRA_PREFIXO.length);
  return ehChaveExtra(chave) ? chave : null;
}

/**
 * O teto do plano depois de somar o extra comprado.
 *
 * `zeroEIlimitado` vem da definição do extra, e não de palpite de quem chama:
 * é o que impede transformar "ilimitado" em "limitado ao extra". Extra zerado
 * (ou negativo, que não deveria existir) devolve o teto intocado.
 */
export function somarAoTeto(
  base: number | null,
  extra: number,
  opcoes: { zeroEIlimitado: boolean },
): number | null {
  const somar = Number.isFinite(extra) ? Math.max(0, Math.trunc(extra)) : 0;
  if (somar === 0) return base;
  if (base == null) return null;
  if (opcoes.zeroEIlimitado && base <= 0) return base;
  return Math.max(0, base) + somar;
}

/** Rótulo da linha da fatura: "+200 processos vigiados". */
export function rotuloDoExtra(chave: ChaveExtra, quantidade: number): string {
  const def = definicaoDoExtra(chave);
  if (!def) return `+${quantidade}`;
  return `+${quantidade} ${quantidade === 1 ? def.rotuloSingular : def.rotulo}`;
}
