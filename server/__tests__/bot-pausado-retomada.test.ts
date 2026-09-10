/**
 * "Assumi a conversa e mesmo assim o robô mandou mensagem depois."
 * (caso real do dono, 10/09/2026 — print do Atendimento: mensagens do
 * atendente às 10:12 e uma do bot às 10:15, com a conversa marcada
 * "Em atendimento · Bot pausado".)
 *
 * O bot pausado não é um flag próprio: é `conversas.status === em_atendimento`.
 * Havia DUAS portas conferindo isso, e as duas são movidas por MENSAGEM DO
 * CLIENTE — `dispararMensagemCanal` no topo, e o laço de envio do
 * whatsapp-handler antes de cada resposta.
 *
 * A terceira porta é movida pelo RELÓGIO e não conferia nada: o scheduler
 * retoma a execução quando o `whatsapp_aguardar_resposta` estoura o timeout
 * (ou quando um `esperar` vence). Nessa retomada o engine marca
 * `__retomadaPorTimeout`, o que faz `temCanal` virar false e o texto sair
 * DIRETO pelo canal (`enviarWhatsApp`, proativo) em vez de voltar como
 * `resposta` pro handler — pulando as duas travas. Era esse o caminho.
 *
 * A conferência mora DEPOIS do claim atômico de propósito: antes dele, a
 * execução ficaria com `retomarEm` no passado e o ciclo tentaria de novo pra
 * sempre. Cancelada, ela sai da fila do scheduler (que só busca `rodando`).
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi, beforeEach } from "vitest";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const NOME = Symbol.for("drizzle:Name");
function nomeTabela(t: any): string { return (t?.[NOME] as string) || ""; }

const filas: Record<string, any[][]> = {};
const updates: Array<{ table: string; set: any }> = [];
function proximaFila(table: string): any[] {
  const fila = filas[table];
  return fila && fila.length > 0 ? fila.shift()! : [];
}
const dbFalso = {
  select: () => {
    let table = "";
    const b: any = {
      from: (t: any) => { table = nomeTabela(t); return b; },
      innerJoin: () => b, leftJoin: () => b, where: () => b, orderBy: () => b, limit: () => b,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(proximaFila(table)).then(res, rej),
    };
    return b;
  },
  update: (t: any) => ({
    set: (s: any) => {
      updates.push({ table: nomeTabela(t), set: s });
      const p: any = Promise.resolve([{ affectedRows: 1 }]);
      p.where = () => Promise.resolve([{ affectedRows: 1 }]);
      return p;
    },
  }),
  insert: () => ({ values: () => Promise.resolve([{ insertId: 1 }]) }),
  delete: () => ({ where: () => Promise.resolve([{ affectedRows: 1 }]) }),
  execute: () => Promise.resolve([[]]),
};

vi.mock("../db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../db")>();
  return { ...real, getDb: vi.fn(async () => dbFalso) };
});

const executarCenarioMock = vi.fn(async () => ({ sucesso: true, contexto: {} }));
vi.mock("../smartflow/engine", async (importOriginal) => {
  const real = await importOriginal<typeof import("../smartflow/engine")>();
  return { ...real, executarCenario: (...a: unknown[]) => executarCenarioMock(...(a as [])) };
});

const { retomarExecucao } = await import("../smartflow/dispatcher");

const EXEC = {
  id: 77, escritorioId: 1, cenarioId: 9, contatoId: 40, conversaId: 300,
  status: "rodando", passoAtual: 2, contexto: JSON.stringify({ canalId: 5, telefoneCliente: "5585999990000" }),
  retomarEm: new Date("2026-09-10T13:15:00Z"), erro: null,
};

beforeEach(() => {
  for (const k of Object.keys(filas)) delete filas[k];
  updates.length = 0;
  executarCenarioMock.mockClear();
});

describe("retomada por timeout não fala por cima do atendente", () => {
  it("conversa em atendimento: não retoma, não roda cenário nenhum", async () => {
    filas["smartflow_execucoes"] = [[EXEC]];
    filas["conversas"] = [[{ status: "em_atendimento" }]];

    const r = await retomarExecucao(77);

    expect(r.retomada).toBe(false);
    expect(r.erro).toBe("Atendente assumiu a conversa");
    expect(executarCenarioMock).not.toHaveBeenCalled();
  });

  it("a execução é CANCELADA — senão o scheduler tenta de novo a cada ciclo", async () => {
    filas["smartflow_execucoes"] = [[EXEC]];
    filas["conversas"] = [[{ status: "em_atendimento" }]];

    await retomarExecucao(77);

    const cancelou = updates.filter((u) => u.table === "smartflow_execucoes" && u.set.status === "cancelado");
    expect(cancelou).toHaveLength(1);
    expect(cancelou[0].set.retomarEm).toBeNull();
    expect(cancelou[0].set.erro).toBe("Atendente assumiu a conversa");
  });

  it("o claim atômico vem ANTES da conferência (a ordem é o que evita o ciclo infinito)", async () => {
    filas["smartflow_execucoes"] = [[EXEC]];
    filas["conversas"] = [[{ status: "em_atendimento" }]];

    await retomarExecucao(77);

    // 1º update = claim (limpa retomarEm sem mexer no status); 2º = cancelamento.
    expect(updates[0].set).toEqual({ retomarEm: null });
    expect(updates[1].set.status).toBe("cancelado");
  });

  it("conversa ainda com o bot (aguardando): a retomada segue o caminho normal", async () => {
    filas["smartflow_execucoes"] = [[EXEC]];
    filas["conversas"] = [[{ status: "aguardando" }]];
    filas["smartflow_cenarios"] = [[]];

    const r = await retomarExecucao(77);

    // Passou da trava: só parou adiante, ao não achar o cenário no banco falso.
    expect(r.erro).toBe("Cenário não encontrado");
    expect(updates.some((u) => u.set.status === "cancelado")).toBe(false);
  });

  it("execução SEM conversa (lembrete de cobrança, agendamento) não é afetada", async () => {
    filas["smartflow_execucoes"] = [[{ ...EXEC, conversaId: null }]];
    filas["smartflow_cenarios"] = [[]];

    const r = await retomarExecucao(77);

    expect(r.erro).toBe("Cenário não encontrado");
    expect(updates.some((u) => u.set.status === "cancelado")).toBe(false);
  });
});

describe("amarras no código", () => {
  const disp = ler("server/smartflow/dispatcher.ts");
  const retomar = disp.slice(
    disp.indexOf("export async function retomarExecucao"),
    disp.indexOf("const cenario = await carregarCenarioPorId(exec.escritorioId, exec.cenarioId);"),
  );

  it("a conversa é lida escopada pelo escritório", () => {
    expect(retomar).toContain("eq(conversas.escritorioId, exec.escritorioId)");
  });

  it("só confere quando a execução tem conversa", () => {
    expect(retomar).toContain("if (exec.conversaId)");
  });

  it("as outras duas portas continuam de pé — esta foi somada, não trocada", () => {
    // Porta 1: mensagem do cliente chega e o bot está pausado.
    expect(disp).toContain('"SmartFlow: conversa em_atendimento — bot pausado, mensagem ignorada"');
    // Porta 2: atendente assume no meio do processamento das respostas.
    const handler = ler("server/integracoes/whatsapp-handler.ts");
    expect(handler).toContain('if (statusAtual === "em_atendimento") {');
    expect(handler).toContain("[SmartFlow] Atendente assumiu — cancelando respostas pendentes do bot");
    // Porta 3 (esta): o auto-reply fixo do canal.
    expect(handler).toContain("[AutoReply] bot pausado — auto-reply do canal não enviado");
  });

  it("o caminho que estourava é o do envio direto na retomada por timeout", () => {
    const engine = ler("server/smartflow/engine.ts");
    // `__retomadaPorTimeout` derruba `temCanal` e manda pelo executor (proativo),
    // fora do laço do handler. Se isso mudar, a trava da retomada perde o sentido.
    expect(engine).toContain('(ctx as any).__retomadaPorTimeout !== true');
    expect(engine).toContain("exec.enviarWhatsApp(telefone, mensagem, {");
  });
});
