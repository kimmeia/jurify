/**
 * Como o RECURSO terminou — eixo próprio, separado do desfecho do pedido.
 *
 * É a decisão de projeto que mais importa neste arquivo, então vale explicar.
 *
 * "Provimento" NÃO é "procedente". Quando o réu recorre e vence, o recurso foi
 * provido e o pedido do autor foi rejeitado — as duas palavras apontam para
 * lados opostos. Encaixar movimento de recurso no enum de 1ª instância
 * (procedente/improcedente) seria erro de unidade, do mesmo tipo que já
 * mordeu a comparação com o histórico do escritório: número certo, grandeza
 * errada, e ninguém percebe porque o gráfico continua bonito.
 *
 * Por isso instância superior ganha coluna própria. Um processo do STJ tem
 * `resultadoRecurso` preenchido e `resultado` nulo, e a tela fala a língua
 * certa em cada caso.
 *
 * O vocabulário abaixo NÃO é lembrança da TPU: veio de uma agregação no índice
 * `api_publica_stj`, com contagem. As frases estão como o tribunal escreve.
 */

export type ResultadoRecurso =
  /** Recurso acolhido — a decisão de origem caiu. */
  | "provido"
  | "parcialmente_provido"
  /** Recurso julgado e rejeitado — a decisão de origem fica de pé. */
  | "nao_provido"
  /** Nem chegou ao mérito: faltou requisito de admissibilidade. */
  | "nao_conhecido"
  /** Perdeu o objeto. */
  | "prejudicado"
  | "desistencia";

export interface MovimentoRecurso {
  nome: string;
  /** ISO. */
  dataHora: string;
}

export interface DesfechoRecurso {
  resultado: ResultadoRecurso;
  em: string;
  /** A frase que gerou a classificação — é o que se confere quando dá errado. */
  movimento: string;
}

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // O tribunal escreve "Não-Provimento" e "Não Provimento" na mesma base.
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Embargos de declaração ficam DE FORA.
 *
 * ED não julga o mérito do recurso — pede que a própria decisão seja
 * esclarecida. Como a classificação usa o último movimento decisivo, um ED
 * rejeitado depois de um recurso provido viraria "não provido", invertendo o
 * resultado do caso. São 247 mil ocorrências no STJ; deixá-los entrar
 * estragaria mais do que resolveria.
 */
const IGNORAR = /embargos de declaracao/;

/**
 * Ordem importa e cada linha tem razão de estar onde está.
 *
 * "Conhecimento para não conhecer do Recurso Especial" contém "conhecimento":
 * a regra de não-conhecimento precisa vir antes de qualquer coisa que case
 * "conhec". E "provimento em parte" precisa vir antes de "provimento", senão
 * todo parcial vira integral.
 */
const REGRAS: Array<{ re: RegExp; resultado: ResultadoRecurso }> = [
  { re: /desistencia/, resultado: "desistencia" },
  { re: /prejudicad/, resultado: "prejudicado" },
  {
    re: /nao conhec|nao.?conhecimento|negacao de seguimento|negar seguimento|inadmis/,
    resultado: "nao_conhecido",
  },
  {
    re: /provimento em parte|parcial provimento|provimento parcial/,
    resultado: "parcialmente_provido",
  },
  { re: /nao provimento|negar provimento|negou provimento|improvimento|denegac/, resultado: "nao_provido" },
  { re: /provimento|provido/, resultado: "provido" },
];

/**
 * Usa o ÚLTIMO movimento decisivo. Um recurso pode ter decisão monocrática
 * revista pelo colegiado depois, e o que vale é a palavra final.
 */
export function deduzirDesfechoRecurso(
  movimentos: MovimentoRecurso[],
): DesfechoRecurso | null {
  const ordenados = [...movimentos]
    .filter((m) => typeof m?.nome === "string" && typeof m?.dataHora === "string")
    .sort((a, b) => a.dataHora.localeCompare(b.dataHora));

  let achado: DesfechoRecurso | null = null;
  for (const m of ordenados) {
    const nome = normalizar(m.nome);
    if (IGNORAR.test(nome)) continue;

    for (const r of REGRAS) {
      if (r.re.test(nome)) {
        achado = { resultado: r.resultado, em: m.dataHora, movimento: m.nome };
        break;
      }
    }
  }
  return achado;
}

const ROTULO: Record<ResultadoRecurso, string> = {
  provido: "Provido",
  parcialmente_provido: "Provido em parte",
  nao_provido: "Não provido",
  nao_conhecido: "Não conhecido",
  prejudicado: "Prejudicado",
  desistencia: "Desistência",
};

export function rotuloRecurso(r: ResultadoRecurso): string {
  return ROTULO[r];
}

/**
 * Ordem canônica, do mais favorável ao recorrente ao menos.
 *
 * Fixa pelo mesmo motivo de `ORDEM_RESULTADO`: comparar dois recortes exige a
 * mesma linha no mesmo lugar, e a cor segue o slot, não o tamanho da fatia.
 */
export const ORDEM_RECURSO: ResultadoRecurso[] = [
  "provido",
  "parcialmente_provido",
  "nao_provido",
  "nao_conhecido",
  "prejudicado",
  "desistencia",
];
