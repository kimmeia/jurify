/**
 * A lista da Agenda descartava justamente o que você acabou de criar.
 *
 * `agenda.listar` aplicava `ORDER BY data ASC LIMIT 200` quando não recebe
 * janela de datas — que é exatamente o caso da aba Eventos. Sobravam os 200
 * MAIS ANTIGOS, e tudo depois disso era cortado em silêncio: o prazo criado
 * hoje é o último da fila e nunca chegava na tela.
 *
 * O calendário passa `dataInicio`/`dataFim`, cai no teto alto (3000) e mostra.
 * Daí o sintoma exato relatado: "entra no calendário, não aparece na lista".
 *
 * O corte agora é pelos dois lados a partir de hoje — próximos em ordem
 * crescente, passados em ordem decrescente. O que cai fora é arqueologia,
 * nunca o que está por vir.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const router = ler("server/escritorio/router-agenda.ts");
const tela = ler("client/src/pages/Agenda.tsx");

const listar = (() => {
  const i = router.indexOf("listar: protectedProcedure");
  expect(i).toBeGreaterThan(0);
  return router.slice(i, router.indexOf("pessoas: protectedProcedure"));
})();

describe("o corte não pega o futuro", () => {
  it("sem janela de datas, busca os dois lados a partir de hoje", () => {
    expect(listar).toContain("const semJanela = !(input?.dataInicio && input?.dataFim)");
    expect(listar).toContain("const inicioDeHoje = inicioDoDiaNoFuso(dataHojeBR(fusoHorario), fusoHorario)");
  });

  it("compromissos: próximos ASC, passados DESC", () => {
    // O DESC do passado é o que garante que, se algo tiver de cair, caia o
    // mais antigo — e não o de amanhã.
    expect(listar).toContain("gte(agendamentos.dataInicio, inicioDeHoje)))\n                .orderBy(asc(agendamentos.dataInicio))");
    expect(listar).toContain("lt(agendamentos.dataInicio, inicioDeHoje)))\n                .orderBy(desc(agendamentos.dataInicio))");
  });

  it("tarefas idem", () => {
    expect(listar).toContain("orderBy(desc(tarefas.dataVencimento))");
  });

  it("tarefa sem vencimento não some no caminho", () => {
    // `lt` e `gte` descartam NULL nos DOIS lados: sem o isNull, toda tarefa
    // sem data cairia fora da lista — um sumiço pior que o que veio consertar.
    expect(listar).toContain("or(gte(tarefas.dataVencimento, inicioDeHoje), isNull(tarefas.dataVencimento))");
  });

  it("com janela de datas nada muda", () => {
    // O calendário depende do teto alto por período; mexer nele reabriria o
    // bug de meses cheios (>200 eventos sumia do dia 22 em diante).
    expect(listar).toContain("const limiteEventos = input?.dataInicio && input?.dataFim ? 3000 : 200;");
  });
});

describe("prazo não é tarefa", () => {
  it("empatados na data, prazo vem antes", () => {
    // Prazo é o que TEM que sair até aquela data; tarefa é o que seria bom
    // sair. A ordem na tela precisa refletir de que lado está a consequência.
    expect(tela).toContain('ev.tipo === "prazo_processual" ? 0');
    expect(tela).toContain("return peso(a) - peso(b);");
  });

  it("a data continua mandando na ordenação", () => {
    // O peso é desempate, não critério primário: um prazo de mês que vem não
    // pode subir na frente da tarefa de hoje.
    expect(tela).toContain("if (dif !== 0) return dif;");
  });
});
