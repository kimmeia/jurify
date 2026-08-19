/**
 * Atualização parcial no Monitoramento — aprovada no mockup de 19/08.
 *
 * O problema: com 425 monitorados e 11 parados, TODOS os botões de atualizar
 * rodavam os 425 — inclusive o "Verificar agora" do aviso vermelho, que fica
 * DENTRO do card que fala só dos parados. Reconsultar 11 processos custava
 * uma varredura inteira.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const fonte = readFileSync(join(raiz, "client/src/pages/Processos.tsx"), "utf8");

describe("o aviso de parados atualiza só os parados", () => {
  it("o botão passa idsParados, com o mesmo predicado do chip Parados", () => {
    expect(fonte).toContain("monitoramentoIds: idsParados");
    // O predicado é compartilhado: o botão atualiza exatamente o que o chip
    // conta. Dois filtros "de parado" divergindo foi o que quebrou a
    // confiança no contador de movimentações.
    expect(fonte).toContain('(m.statusJudit || m.status) === "erro" || !!m.ultimoErro');
    expect(fonte).toContain("Atualizar só os {idsParados.length}");
  });

  it("o Atualizar da barra continua rodando a carteira inteira", () => {
    const ocorrencias = fonte.match(/monitoramentoIds: listaMons\.map/g) ?? [];
    expect(ocorrencias.length).toBe(1);
  });
});

describe("atualizar um único processo pelo menu do card", () => {
  it("o menu ⋯ ganhou a opção, ligada ao mesmo motor", () => {
    expect(fonte).toContain("Atualizar só este");
    expect(fonte).toContain("monitoramentoIds: [m.id]");
  });

  it("o card mostra o andamento na própria linha", () => {
    // A operação em curso vem do polling de progresso — o card marca
    // "consultando…" sem depender do drawer aberto.
    expect(fonte).toContain("atualizando={idsAtualizando.has(m.id)}");
    expect(fonte).toContain("consultando…");
  });

  it("o drawer de lote não abre pra um processo só", () => {
    expect(fonte).toContain("if (d.total > 1) setAtualDrawerOpen(true)");
  });
});
