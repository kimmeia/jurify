/**
 * Detecção de "o processo subiu pro 2º grau" a partir das movimentações do
 * 1º grau — o "cérebro" do monitoramento auto-detectar grau (issue #529,
 * opção C). O motor sempre lê o 1º grau; quando estes indícios aparecem, ele
 * também passa a consultar o 2º grau pra não perder as movimentações do
 * recurso.
 *
 * É uma heurística por palavras-chave no texto da movimentação. As frases são
 * as típicas do PJe/TJCE, mas DEVEM ser afinadas com dados reais quando o 2º
 * grau estiver ligado e validado (algumas variam por tribunal).
 *
 * Fora de escopo de propósito: "Recurso Inominado" vai pra Turma Recursal dos
 * Juizados (não é o 2º grau do tribunal), então não entra aqui.
 */

export interface MovimentacaoTexto {
  texto: string;
}

export interface DeteccaoGrau {
  /** true se as movimentações indicam que o processo foi pro 2º grau. */
  subiu: boolean;
  /** Trechos que dispararam a detecção — pra log/auditoria. */
  indicios: string[];
}

/** Remove acentos e baixa pra minúsculas pra a comparação ser robusta. */
function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Comparados contra o texto JÁ normalizado (sem acento, minúsculo).
const PADROES_SUBIU: RegExp[] = [
  /remetidos? os autos/,
  /remessa (dos autos )?(ao|a|para o|pro) (tribunal|instancia superior|segundo grau|2o grau)/,
  /recurso de apelacao/,
  /\bapelacao\b/,
  /agravo de instrumento/,
  /autos recebidos no tribunal/,
  /\brelator(a)?\b/,
  /desembargador(a)?/,
];

export function detectarSubiuParaSegundoGrau(
  movimentacoes: readonly MovimentacaoTexto[],
): DeteccaoGrau {
  const indicios: string[] = [];

  for (const mov of movimentacoes) {
    const texto = mov?.texto ?? "";
    if (!texto.trim()) continue;
    const norm = normalizar(texto);
    if (PADROES_SUBIU.some((padrao) => padrao.test(norm))) {
      indicios.push(texto.trim().slice(0, 120));
    }
  }

  return { subiu: indicios.length > 0, indicios };
}
