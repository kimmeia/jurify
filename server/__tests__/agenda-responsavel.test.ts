/**
 * Quem fica com a tarefa.
 *
 * O banco tem `responsavelId` em `agendamentos` e em `tarefas` desde sempre, e
 * as duas procedures de criação já aceitavam o campo. Só o diálogo nunca
 * mandou: todo evento nascia sem dono, ou herdava o dono do cliente vinculado
 * — a única forma de atribuir era escolher o cliente certo e torcer.
 *
 * Reatribuir depois era impossível até pela API: `atualizar` não tinha o campo
 * no input.
 *
 * Duas armadilhas moram aqui, e as duas são de permissão:
 *
 *  1. `atualizar` exigia ser o RESPONSÁVEL. Como vincular um cliente de outra
 *     pessoa passa o evento pra ela na hora da criação (herança que já
 *     existia), quem acabou de escrever perdia o direito de corrigir o que
 *     escreveu — mas continuava podendo EXCLUIR, porque o `excluir` sempre
 *     aceitou responsável OU criador. Agora as duas usam a mesma régua.
 *
 *  2. `responsavelId` chega do cliente e nada no schema o amarra a um
 *     colaborador. Sem checagem dava pra apontar pra id de outro escritório,
 *     ou pra alguém que já saiu — evento numa agenda que ninguém abre.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const router = ler("server/escritorio/router-agenda.ts");
const regra = ler("server/escritorio/atribuicao-responsavel.ts");
const routerAgendamento = ler("server/escritorio/router-agendamento.ts");
const routerTarefas = ler("server/escritorio/router-tarefas.ts");
const tela = ler("client/src/pages/Agenda.tsx");

const trecho = (fonte: string, marca: string, tamanho = 3000) => {
  const i = fonte.indexOf(marca);
  expect(i, marca).toBeGreaterThan(0);
  return fonte.slice(i, i + tamanho);
};

describe("o servidor aceita reatribuir", () => {
  it("`atualizar` tem responsavelId no input", () => {
    // Sem isso não havia caminho nenhum — nem pela API — pra passar uma
    // tarefa de uma pessoa pra outra.
    const corpo = trecho(router, "atualizar: protectedProcedure", 1400);
    expect(corpo).toContain("responsavelId: z.number().nullable().optional()");
  });

  it("grava nos dois tipos de evento", () => {
    const corpo = trecho(router, "atualizar: protectedProcedure", 6000);
    const ocorrencias = corpo.match(/if \(input\.responsavelId !== undefined\) updates\.responsavelId/g);
    expect(ocorrencias, "compromisso e tarefa").toHaveLength(2);
  });
});

describe("quem pode atribuir a outra pessoa", () => {
  it("existe uma régua só, num arquivo só", () => {
    // Copiar essas duas funções é exatamente como elas divergem — foi assim
    // que `atualizar` passou a exigir ser o responsável enquanto `excluir`
    // aceitava responsável OU criador.
    const corpo = trecho(regra, "export function exigirPoderDeAtribuir", 500);
    expect(corpo).toContain("!perm.verTodos && responsavelId !== perm.colaboradorId");
    expect(corpo).toContain("FORBIDDEN");
    expect(router).not.toContain("function exigirPoderDeAtribuir");
  });

  it("vale nos três caminhos da Agenda: criar compromisso, criar tarefa e editar", () => {
    const usos = router.match(/await validarResponsavel\(db, perm, input\.responsavelId\)/g);
    expect(usos).toHaveLength(3);
  });

  it("vale também nos routers antigos, que aceitavam qualquer id", () => {
    // `agendamento.criar` e `tarefas.criar` recebiam responsavelId sem
    // checagem nenhuma. O diálogo da movimentação passou a mandar o campo —
    // sem isto, seria um caminho aberto pra apontar pra outro escritório.
    expect(routerAgendamento).toContain("validarResponsavel(db, perm, input.responsavelId)");
    expect(routerTarefas).toContain("validarResponsavel(db, perm, input.responsavelId)");
  });

  it("o responsável escolhido é da equipe e está ativo", () => {
    const corpo = trecho(regra, "export async function exigirColaboradorAtivo", 700);
    expect(corpo).toContain("eq(colaboradores.escritorioId, escritorioId)");
    expect(corpo).toContain("eq(colaboradores.ativo, true)");
  });
});

describe("editar o que você criou", () => {
  it("`atualizar` aceita responsável OU criador, igual ao `excluir`", () => {
    // A divergência era alcançável hoje: bastava vincular um cliente de outra
    // pessoa. Quem criava perdia o editar e mantinha o excluir.
    const corpo = trecho(router, "atualizar: protectedProcedure", 3000);
    expect(corpo).toContain("r.responsavelId !== perm.colaboradorId && r.criadoPorId !== perm.colaboradorId");
    expect(corpo).toContain("r.responsavelId !== perm.colaboradorId && r.criadoPor !== perm.colaboradorId");
  });
});

describe("a tela", () => {
  it("o campo existe e vale pros dois tipos", () => {
    // Fora de qualquer `tipoEvento === ...`: tarefa e compromisso precisam
    // igualmente de dono.
    expect(tela).toContain("<Label className=\"text-xs\">Responsável</Label>");
    const i = tela.indexOf("{/* RESPONSÁVEL");
    expect(i).toBeGreaterThan(0);
    expect(tela.slice(i, i + 300)).not.toContain("tipoEvento ===");
  });

  it("manda o responsável nas três chamadas", () => {
    expect(tela).toContain("responsavelId: responsavelParaCriar");
    expect(tela.match(/responsavelId: responsavelParaCriar/g)).toHaveLength(2);
    expect(tela).toContain("responsavelId: responsavelParaEditar");
  });

  it("“não mexi” vale como você, e “limpei” devolve a decisão ao servidor", () => {
    // Três estados de propósito: `undefined` é o padrão e manda o seu id,
    // `null` é escolha explícita de deixar em branco (aí o servidor herda do
    // cliente, regra antiga), número é a pessoa escolhida.
    expect(tela).toContain("const responsavelParaCriar = responsavelId === undefined ? eu?.id : responsavelId ?? undefined");
  });

  it("quem não pode atribuir não manda o campo na edição", () => {
    // Mandar o valor que veio do evento faria o servidor recusar a edição
    // inteira quando o responsável é outra pessoa — inclusive pra quem só
    // quis corrigir o título do que criou.
    expect(tela).toContain("!podeAtribuirOutro || responsavelId === undefined ? undefined : responsavelId");
  });

  it("o gate da tela é o mesmo do servidor", () => {
    expect(tela).toContain('minhasPermsDlg?.cargo === "Dono" || !!minhasPermsDlg?.permissoes?.agenda?.verTodos');
  });

  it("quem não gerencia vê o próprio nome, sem seletor", () => {
    expect(tela).toContain("Você cria para si. Atribuir a um colega é do gestor.");
  });

  it("“você” vem do servidor, não de comparar nomes", () => {
    // Homônimo no escritório faria a tela marcar a pessoa errada como sendo
    // quem está logado.
    expect(tela).toContain("colaboradores.find((c) => c.souEu)");
    expect(router).toContain("souEu: r.id === perm.colaboradorId");
  });

  it("a lista de colaboradores não é mais exclusiva de compromisso", () => {
    // Era condicionada a `tipoEvento === "compromisso"` porque só servia aos
    // lembretes. O picker de responsável abriria vazio numa tarefa.
    const dialogo = tela.slice(tela.indexOf("function CriarEventoDialog"));
    const i = dialogo.indexOf("listarColaboradores?.useQuery?.");
    expect(i, "o diálogo busca colaboradores").toBeGreaterThan(0);
    expect(dialogo.slice(i, i + 200)).toContain("{ enabled: open, retry: false }");
  });
});
