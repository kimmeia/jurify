/**
 * Prazo tem duas datas, e só uma estava na tela.
 *
 * No escritório o prazo se trabalha em par: a data em que se começa e a data
 * FATAL, que é o limite legal e não se move. Os diálogos que nascem de uma
 * movimentação ("Criar prazo", "Criar tarefa") tinham um campo só — "Data
 * limite" —, e ele fazia os dois papéis. Faltava também o responsável, então
 * tudo caía no nome de quem clicou.
 *
 * `agendamentos` já tinha dataInicio e dataFim; `tarefas` só tinha
 * dataVencimento e ganhou `dataInicial` por migration não-destrutiva.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const drawer = ler("client/src/components/MovimentacaoDetalheDrawer.tsx");
const routerTarefas = ler("server/escritorio/router-tarefas.ts");
const migration = ler("drizzle/0193_tarefa_data_inicial.sql");
const schema = ler("drizzle/schema.ts");

const trecho = (marca: string, tamanho = 5200) => {
  const i = drawer.indexOf(marca);
  expect(i, marca).toBeGreaterThan(0);
  return drawer.slice(i, i + tamanho);
};

describe("o par de datas", () => {
  it("tarefa ganhou a data inicial no banco", () => {
    expect(migration).toContain("ADD COLUMN dataInicial TIMESTAMP NULL DEFAULT NULL");
    expect(schema).toContain('dataInicial: timestamp("dataInicial")');
    expect(routerTarefas).toContain("dataInicial: z.string().optional()");
    expect(routerTarefas).toContain("dataInicial: input.dataInicial ? new Date(input.dataInicial) : null");
  });

  it("o diálogo de prazo tem inicial e fatal, não “data limite”", () => {
    const corpo = trecho("function CriarPrazoDialog");
    expect(corpo).toContain("Data inicial");
    expect(corpo).toContain("Data fatal");
    expect(corpo).not.toContain("Data limite");
  });

  it("o de tarefa também, no lugar de “vencimento”", () => {
    const corpo = trecho("function CriarTarefaDialog");
    expect(corpo).toContain("Data inicial");
    expect(corpo).toContain("Data fatal");
    expect(corpo).not.toContain(">Vencimento<");
  });

  it("a fatal é marcada como o que não se move", () => {
    // O par só ajuda se a diferença entre as duas estiver na tela. Duas
    // caixas de data iguais lado a lado convidam a preencher trocado.
    expect(drawer.match(/NÃO SE MOVE/g)).toHaveLength(2);
  });

  it("prazo grava as duas: início na agenda, fatal em dataFim", () => {
    const corpo = trecho("function CriarPrazoDialog");
    expect(corpo).toContain("dataInicio: `${dataInicial}T09:00:00`");
    expect(corpo).toContain("dataFim: `${dataFatal}T23:59:59`");
  });

  it("tarefa grava as duas: inicial nova, fatal no vencimento", () => {
    const corpo = trecho("function CriarTarefaDialog");
    expect(corpo).toContain("dataInicial: dataInicial ? `${dataInicial}T00:00:00` : undefined");
    expect(corpo).toContain("dataVencimento: dataFatal ? `${dataFatal}T23:59:59` : undefined");
  });

  it("criar sem a fatal continua barrado", () => {
    // A data que não pode faltar é a fatal — a inicial se ajusta.
    expect(trecho("function CriarPrazoDialog", 6500)).toContain("!titulo.trim() || !dataFatal");
  });
});

describe("responsável e descrição", () => {
  it("os dois diálogos têm o campo de responsável", () => {
    expect(drawer.match(/<CampoResponsavel valor=\{responsavelId\} onChange=\{setResponsavelId\} \/>/g))
      .toHaveLength(2);
  });

  it("o prazo ganhou descrição editável, em vez de mandar o teor escondido", () => {
    // Antes a descrição ia pro banco com o teor inteiro sem ninguém ver nem
    // poder ajustar.
    const corpo = trecho("function CriarPrazoDialog");
    expect(corpo).toContain('id="prazo-desc"');
    expect(corpo).toContain("descricao: descricao || undefined");
  });

  it("os dois mandam o responsável escolhido", () => {
    expect(drawer.match(/responsavelId: responsavelId \?\? undefined/g)).toHaveLength(2);
  });

  it("quem não coordena vê o próprio nome, sem seletor", () => {
    const corpo = trecho("function CampoResponsavel", 1800);
    expect(corpo).toContain("if (!podeAtribuirOutro)");
    expect(corpo).toContain("atribuir a um colega é do gestor");
  });

  it("a régua da tela é a mesma da Agenda", () => {
    const corpo = trecho("function useEquipe", 1200);
    expect(corpo).toContain('perms?.cargo === "Dono" || !!perms?.permissoes?.agenda?.verTodos');
  });
});
