/**
 * O fecho da varredura.
 *
 * A frase é o produto do robô: "exercitei N de M, achei X, e as Y que
 * não exercitei são estas, por isto". Ela substitui a promessa que
 * nenhum robô cumpre — "não existe falha" — por uma que dá pra
 * verificar: cobertura declarada.
 *
 * Por isso o relatório imprime as não verificadas junto com as falhas,
 * agrupadas por motivo. Esconder o âmbar deixaria o texto com cara de
 * aprovação, que é exatamente o que este robô existe pra não fazer.
 */

import { MOTIVO_TEXTO, resumir, type Motivo, type ResultadoAcao } from "./tipos";

export function formatarRelatorio(resultados: readonly ResultadoAcao[]): string {
  const r = resumir(resultados);
  const linhas: string[] = [];

  linhas.push(
    `Exercitei ${r.exercitadas} das ${r.mapeadas} ações mapeadas. ` +
      `Achei ${r.falhou} problema(s). ` +
      `As ${r.naoVerificadas} que não exercitei estão abaixo, com o porquê.`,
  );

  const falhas = resultados.filter((x) => x.veredito.estado === "falhou");
  if (falhas.length > 0) {
    linhas.push("", "FALHOU");
    for (const f of falhas) {
      linhas.push(`  ${f.rota} · ${f.nome}`, `    ${f.veredito.evidencia}`);
    }
  }

  const porMotivo = new Map<Motivo, ResultadoAcao[]>();
  for (const x of resultados) {
    if (x.veredito.estado !== "nao_verificada") continue;
    const motivo = x.veredito.motivo ?? "efeito_nao_observavel";
    porMotivo.set(motivo, [...(porMotivo.get(motivo) ?? []), x]);
  }

  if (porMotivo.size > 0) {
    linhas.push("", "NÃO VERIFICADAS");
    for (const [motivo, itens] of porMotivo) {
      linhas.push(`  ${itens.length}× ${MOTIVO_TEXTO[motivo]}`);
      for (const i of itens.slice(0, 8)) linhas.push(`      ${i.rota} · ${i.nome}`);
      if (itens.length > 8) linhas.push(`      … e mais ${itens.length - 8}`);
    }
  }

  return linhas.join("\n");
}
