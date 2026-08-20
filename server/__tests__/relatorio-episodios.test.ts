/**
 * O relatório conta ATENDIMENTOS, não conversas.
 *
 * A conversa do WhatsApp nasce no primeiro contato e é reaproveitada pra
 * sempre. Contar conversa criada no período respondia outra pergunta: cliente
 * que voltou em agosto não cria conversa nova e sumia da contagem, enquanto o
 * atendimento dele em março aparecia no nome de quem pegou a conversa por
 * último.
 *
 * Estes testes prendem as duas metades: de onde vem o número, e que a ficha do
 * RH conta do mesmo jeito. Duas telas com contagens diferentes da mesma pessoa
 * no mesmo mês é o que faz alguém parar de confiar no relatório inteiro.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const relatorio = ler("server/escritorio/router-relatorios.ts");
const fichaRh = ler("server/rh/desempenho-repo.ts");
const pdf = ler("server/escritorio/relatorios-atendimento-pdf.ts");
const tela = ler("client/src/pages/Relatorios.tsx");

describe("de onde sai o número", () => {
  it("conta episódios abertos na janela", () => {
    expect(relatorio).toContain("atendimentosIniciados");
    expect(relatorio).toContain("gte(atendimentos.abertoEm, di)");
    expect(relatorio).toContain("lte(atendimentos.abertoEm, df)");
  });

  it("agrupa por quem ABRIU, não pelo dono atual da conversa", () => {
    // `atendenteAtual` muda na transferência. Agrupar por ele faria o
    // histórico migrar pro último atendente no dia em que alguém encostasse
    // na conversa.
    expect(relatorio).toContain("colabId: atendimentos.atendenteAbriu");
    expect(relatorio).toContain("groupBy(atendimentos.atendenteAbriu)");
    expect(relatorio).not.toContain("colabId: conversas.atendenteId");
  });

  it("o filtro de atendente também olha quem abriu", () => {
    expect(relatorio).toContain("inArray(atendimentos.atendenteAbriu, colaboradorIds)");
  });

  it("o período de comparação usa a mesma régua", () => {
    // Delta calculado entre duas contagens de origens diferentes seria ruído
    // com cara de tendência.
    expect(relatorio).toContain("baseAtd(dataInicioAnt, dataFimAnt)");
  });
});

describe("as telas não podem divergir", () => {
  it("a ficha do RH conta episódios, igual ao relatório", () => {
    expect(fichaRh).toContain("colabId: atendimentos.atendenteAbriu");
    expect(fichaRh).toContain("gte(atendimentos.abertoEm, de)");
    expect(fichaRh).not.toContain("colabId: conversas.atendenteId");
  });

  it("o card do relatório mostra atendimentos, e nomeia o resto", () => {
    expect(tela).toContain("Atendimentos iniciados");
    expect(tela).toContain("data.atendimentosIniciados");
    // "Conversas novas" continua visível: gente nova é outra pergunta, e
    // esconder o número faria as leituras se confundirem de novo.
    expect(tela).toContain("conversas novas");
  });

  it("nada mais chama conversa criada de atendimento", () => {
    expect(tela).not.toContain("atendimentos`");
    expect(pdf).toContain('label: "Atendimentos iniciados"');
    expect(pdf).toContain("data.atendimentosIniciados");
    expect(pdf).toContain('label: "Conversas novas"');
  });

  it("o gráfico diário do PDF desenha o que o título promete", () => {
    // O bloco se chamava "Atendimentos iniciados por dia" e plotava conversas
    // criadas por dia.
    expect(pdf).toContain("const serieDiaria = data.atendimentosPorDia;");
    expect(pdf).not.toContain("data.conversasPorDia.forEach");
  });
});
