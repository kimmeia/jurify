/**
 * O que, no acervo, é jurisprudência — e o que é só estatística.
 *
 * Jurisprudência é decisão de órgão COLEGIADO: acórdão de câmara ou turma do
 * tribunal, de turma recursal, ou de tribunal superior. Sentença de juiz
 * singular não é: não vincula, não se cita em petição, e é justamente o que a
 * 2ª instância reforma.
 *
 * A distinção não é preciosismo — é a diferença entre responder "o tribunal
 * entende assim" e "essa vara costuma julgar assim". As duas respostas valem,
 * mas confundi-las é vender uma como se fosse a outra.
 *
 * O campo `grau` vem do próprio DataJud e a classificação é determinística: a
 * IA não opina sobre isso.
 */

export type NaturezaProcesso =
  /** Colegiado — serve pra fundamentar. */
  | "jurisprudencia"
  /** Juiz singular — serve pra prever a vara, não pra citar. */
  | "estatistica";

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Reconhece tanto o código (`G2`, `SUP`, `TR`, `G1`, `JE`) quanto formas
 * descritivas que apareçam no lugar dele.
 *
 * A ordem importa: "turma recursal" contém "1" em alguns tribunais ("1ª Turma
 * Recursal") e cairia como primeiro grau se o teste de colegiado não viesse
 * antes.
 */
export function naturezaDoGrau(grau: string | null | undefined): NaturezaProcesso | null {
  if (typeof grau !== "string") return null;
  const g = semAcento(grau);
  if (!g) return null;

  // Colegiado primeiro.
  if (g.includes("TURMARECURSAL") || g === "TR") return "jurisprudencia";
  if (g.includes("SUPERIOR") || g === "SUP" || g === "STJ" || g === "STF" || g === "TST") {
    return "jurisprudencia";
  }
  if (g === "G2" || g === "2" || g.includes("SEGUNDOGRAU") || g.includes("2GRAU")) {
    return "jurisprudencia";
  }

  if (g === "JE" || g.includes("JUIZADOESPECIAL")) return "estatistica";
  if (g === "G1" || g === "1" || g.includes("PRIMEIROGRAU") || g.includes("1GRAU")) {
    return "estatistica";
  }

  // Grau desconhecido não vira jurisprudência por otimismo. Fica sem
  // classificação e aparece assim no painel, pra ser corrigido olhando dado
  // real em vez de suposição.
  return null;
}

export interface ComposicaoNatureza {
  jurisprudencia: number;
  estatistica: number;
  indefinido: number;
}

export function contarNatureza(
  graus: Array<{ grau: string | null; quantidade: number }>,
): ComposicaoNatureza {
  const c: ComposicaoNatureza = { jurisprudencia: 0, estatistica: 0, indefinido: 0 };
  for (const g of graus) {
    const n = naturezaDoGrau(g.grau);
    const q = Number.isFinite(g.quantidade) ? Math.max(0, Math.trunc(g.quantidade)) : 0;
    if (n === "jurisprudencia") c.jurisprudencia += q;
    else if (n === "estatistica") c.estatistica += q;
    else c.indefinido += q;
  }
  return c;
}

/**
 * O aviso que a tela mostra sobre um recorte.
 *
 * Null quando não há o que ressalvar. Um recorte só de acórdão não precisa de
 * aviso — ele é o que o produto promete.
 */
export function avisoDeNatureza(c: ComposicaoNatureza): string | null {
  const total = c.jurisprudencia + c.estatistica + c.indefinido;
  if (total === 0) return null;

  if (c.jurisprudencia === 0 && c.estatistica > 0) {
    return "Este recorte é todo de 1º grau. Serve pra prever como as varas decidem — não é jurisprudência e não fundamenta petição.";
  }
  if (c.estatistica > c.jurisprudencia) {
    return "A maior parte deste recorte é sentença de 1º grau, que prevê a vara mas não fundamenta. Só a parte de 2ª instância é jurisprudência.";
  }
  if (c.indefinido > 0 && c.indefinido >= total / 2) {
    return "Boa parte destes processos veio sem o grau informado pelo tribunal, então não dá pra afirmar se são jurisprudência.";
  }
  return null;
}
