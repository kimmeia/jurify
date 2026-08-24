/**
 * Composição da fatura mensal de um escritório na cobrança por módulo:
 *
 *   pacote (preço do plano) + módulos avulsos + atendentes adicionais
 *   − desconto do escritório (percentual ou fixo, com validade opcional)
 *
 * Puro de propósito: o admin vê o preview no painel e o server aplica o
 * mesmo número na assinatura — divergência entre os dois seria cobrança
 * errada, então há UMA função e ela é testada.
 *
 * Valores sempre em centavos.
 */

export interface AvulsoFatura {
  modulo: string;
  nome: string;
  precoCentavos: number;
}

export interface DescontoEscritorio {
  tipo: "percentual" | "fixo";
  /** Pontos percentuais (0–100) quando percentual; centavos quando fixo. */
  valor: number;
  /** ISO ou null. Vencido = desconto deixa de valer (a fatura avisa). */
  validoAte: string | null;
}

export interface ItemFatura {
  tipo: "pacote" | "avulso" | "atendentes_adicionais";
  rotulo: string;
  centavos: number;
}

export interface FaturaCalculada {
  itens: ItemFatura[];
  subtotalCentavos: number;
  descontoCentavos: number;
  /** Desconto existe mas passou da validade — mostrado como aviso, não aplicado. */
  descontoExpirado: boolean;
  totalCentavos: number;
  atendentesAdicionais: number;
}

export interface CalcularFaturaArgs {
  nomePlano: string;
  precoPacoteCentavos: number;
  avulsos: AvulsoFatura[];
  atendentesAtivos: number;
  /** null = plano sem cobrança por assento (grandfather dos planos atuais). */
  atendentesInclusos: number | null;
  precoAtendenteAdicionalCentavos: number;
  desconto: DescontoEscritorio | null;
  agoraMs: number;
}

export function calcularFatura(args: CalcularFaturaArgs): FaturaCalculada {
  const itens: ItemFatura[] = [
    {
      tipo: "pacote",
      rotulo: `Pacote ${args.nomePlano}`,
      centavos: Math.max(0, args.precoPacoteCentavos),
    },
  ];

  for (const avulso of args.avulsos) {
    itens.push({
      tipo: "avulso",
      rotulo: `${avulso.nome} (avulso)`,
      centavos: Math.max(0, avulso.precoCentavos),
    });
  }

  let atendentesAdicionais = 0;
  if (args.atendentesInclusos != null && args.precoAtendenteAdicionalCentavos > 0) {
    atendentesAdicionais = Math.max(0, args.atendentesAtivos - args.atendentesInclusos);
    if (atendentesAdicionais > 0) {
      itens.push({
        tipo: "atendentes_adicionais",
        rotulo:
          atendentesAdicionais === 1
            ? "1 atendente adicional"
            : `${atendentesAdicionais} atendentes adicionais`,
        centavos: atendentesAdicionais * args.precoAtendenteAdicionalCentavos,
      });
    }
  }

  const subtotalCentavos = itens.reduce((soma, item) => soma + item.centavos, 0);

  let descontoCentavos = 0;
  let descontoExpirado = false;
  if (args.desconto) {
    const vencido =
      args.desconto.validoAte != null &&
      new Date(args.desconto.validoAte).getTime() < args.agoraMs;
    if (vencido) {
      descontoExpirado = true;
    } else if (args.desconto.tipo === "percentual") {
      const pct = Math.min(100, Math.max(0, args.desconto.valor));
      descontoCentavos = Math.floor((subtotalCentavos * pct) / 100);
    } else {
      descontoCentavos = Math.min(subtotalCentavos, Math.max(0, args.desconto.valor));
    }
  }

  return {
    itens,
    subtotalCentavos,
    descontoCentavos,
    descontoExpirado,
    totalCentavos: subtotalCentavos - descontoCentavos,
    atendentesAdicionais,
  };
}

/**
 * Um módulo avulso (linha de escritorio_addons com produto "modulo:*")
 * está valendo agora? Ativo + dentro da janela início/vencimento.
 */
export function avulsoVigente(
  addon: { status: string; inicioEm: string | null; expiraEm: string | null },
  agoraMs: number,
): boolean {
  if (addon.status !== "ativo") return false;
  if (addon.inicioEm != null && new Date(addon.inicioEm).getTime() > agoraMs) return false;
  if (addon.expiraEm != null && new Date(addon.expiraEm).getTime() <= agoraMs) return false;
  return true;
}

/** Prefixo que separa módulos avulsos dos demais add-ons (ex: jurisia). */
export const PRODUTO_MODULO_PREFIXO = "modulo:";

export function produtoParaModulo(produto: string): string | null {
  return produto.startsWith(PRODUTO_MODULO_PREFIXO)
    ? produto.slice(PRODUTO_MODULO_PREFIXO.length)
    : null;
}

export function moduloParaProduto(modulo: string): string {
  return `${PRODUTO_MODULO_PREFIXO}${modulo}`;
}

/**
 * União plano + avulsos pro porteiro de módulos. Mantém o contrato
 * fail-open do gate: lista null = tudo liberado, e aí avulso é redundante.
 */
export function unirModulosContratados(
  doPlano: string[] | null,
  avulsos: string[],
): string[] | null {
  if (doPlano == null) return null;
  const uniao = new Set(doPlano);
  for (const m of avulsos) uniao.add(m);
  return [...uniao];
}
