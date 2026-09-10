/**
 * "Encerrei a conversa e logo depois o cliente mandou mensagem, reiniciando o
 * fluxo. Em smartflow está para o cliente passar apenas uma vez por dia."
 * (caso real do dono, 10/09/2026.)
 *
 * Não reiniciou: RETOMOU. Três coisas se somavam.
 *   1. Um roteiro que espera resposta (`whatsapp_aguardar_resposta`, Atendente
 *      IA) fica `rodando` com prazo, guardando o lugar por até 24h.
 *   2. Encerrar a conversa mexia só no status dela. Quem cancelava roteiro
 *      parado era EXCLUIR a conversa, e mais ninguém.
 *   3. "Roda por contato" só é consultado quando um roteiro COMEÇA. Retomada é
 *      a mesma passagem, então o limite nem entrava na conta.
 *
 * Com o roteiro encerrado junto, a volta do cliente vira roteiro novo — e aí o
 * limite decide. Quando ele cala o robô, fica um recado interno na conversa:
 * na tela, silêncio por regra e silêncio por defeito eram idênticos.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  LIMITES_POR_CONTATO,
  ROTULO_LIMITE_CONTATO,
  PERIODO_LIMITE_CONTATO,
  recadoRoboSilenciado,
} from "../../shared/limite-por-contato";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const NOME = Symbol.for("drizzle:Name");
function nomeTabela(t: any): string { return (t?.[NOME] as string) || ""; }

const filas: Record<string, any[][]> = {};
const updates: Array<{ table: string; set: any }> = [];
const inserts: Array<{ table: string; values: any }> = [];
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
  insert: (t: any) => ({
    values: (v: any) => { inserts.push({ table: nomeTabela(t), values: v }); return Promise.resolve([{ insertId: 1 }]); },
  }),
  delete: () => ({ where: () => Promise.resolve([{ affectedRows: 1 }]) }),
  execute: () => Promise.resolve([[]]),
};

vi.mock("../db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../db")>();
  return { ...real, getDb: vi.fn(async () => dbFalso) };
});

const { atualizarConversa, encerrarRoteirosParadosDaConversa } = await import("../escritorio/db-crm");

beforeEach(() => {
  for (const k of Object.keys(filas)) delete filas[k];
  updates.length = 0;
  inserts.length = 0;
});

describe("encerrar a conversa encerra o roteiro parado do robô", () => {
  it("status resolvido: cancela a execução parada com o motivo escrito", async () => {
    await atualizarConversa(300, 1, { status: "resolvido" });

    const cancelou = updates.filter((u) => u.table === "smartflow_execucoes" && u.set.status === "cancelado");
    expect(cancelou).toHaveLength(1);
    expect(cancelou[0].set.erro).toBe("Atendimento encerrado");
  });

  it("cancelar limpa o prazo E a espera — os dois é que fazem a conversa ressuscitar", async () => {
    await encerrarRoteirosParadosDaConversa(300, 1, "Atendimento encerrado");

    const [cancelou] = updates.filter((u) => u.set.status === "cancelado");
    expect(cancelou.set.retomarEm).toBeNull();
    expect(cancelou.set.aguardandoMensagemContatoId).toBeNull();
  });

  it("status fechado também encerra", async () => {
    await atualizarConversa(300, 1, { status: "fechado" });
    expect(updates.some((u) => u.table === "smartflow_execucoes" && u.set.status === "cancelado")).toBe(true);
  });

  it("voltar pra aguardando NÃO encerra — é o que o handler faz a cada mensagem que chega", async () => {
    await atualizarConversa(300, 1, { status: "aguardando" });
    expect(updates.some((u) => u.table === "smartflow_execucoes")).toBe(false);
  });

  it("assumir a conversa (em_atendimento) NÃO encerra: o roteiro só é calado, não morto", async () => {
    filas["conversas"] = [[{ contatoId: 40 }]];
    await atualizarConversa(300, 1, { status: "em_atendimento", atendenteId: 7 });
    expect(updates.some((u) => u.table === "smartflow_execucoes")).toBe(false);
  });

  it("trocar só a prioridade não mexe em roteiro nenhum", async () => {
    await atualizarConversa(300, 1, { prioridade: "alta" });
    expect(updates.some((u) => u.table === "smartflow_execucoes")).toBe(false);
  });
});

describe("amarras no código do encerramento", () => {
  const dbCrm = ler("server/escritorio/db-crm.ts");
  const helper = dbCrm.slice(
    dbCrm.indexOf("export async function encerrarRoteirosParadosDaConversa"),
    dbCrm.indexOf("export async function atualizarConversa"),
  );

  it("a consulta é escopada pelo escritório e pela conversa", () => {
    expect(helper).toContain("eq(smartflowExecucoes.escritorioId, escritorioId)");
    expect(helper).toContain("eq(smartflowExecucoes.conversaId, id)");
  });

  it("só alcança execução PARADA — a que está rodando agora não tem prazo nem espera gravados", () => {
    expect(helper).toContain("isNotNull(smartflowExecucoes.retomarEm)");
    expect(helper).toContain("isNotNull(smartflowExecucoes.aguardandoMensagemContatoId)");
    expect(helper).toContain("or(");
  });

  it("só toca no que está rodando: execução já concluída não vira cancelada", () => {
    expect(helper).toContain('eq(smartflowExecucoes.status, "rodando")');
  });

  it("excluir a conversa continua cancelando tudo dela — nada foi tirado de lá", () => {
    const excluir = dbCrm.slice(dbCrm.indexOf("export async function excluirConversa"));
    expect(excluir).toContain('status: "cancelado"');
    expect(excluir).toContain("eq(smartflowExecucoes.conversaId, id)");
  });

  it("o bloco 'Encerrar conversa' do fluxo escreve direto na conversa, fora deste caminho", () => {
    // Se um dia ele passar a usar `atualizarConversa`, a execução que ACABOU de
    // encerrar a conversa entraria na varredura — e o filtro de parada acima é
    // o que impede o desfecho dela de ser sobrescrito.
    const disp = ler("server/smartflow/dispatcher.ts");
    expect(disp).toContain("async function aplicarEfeitosNaConversa");
    expect(disp).toContain("await db\n        .update(conversas)");
  });
});

describe("recado interno quando o limite cala o robô", () => {
  it("a frase nomeia o fluxo e o período", () => {
    expect(recadoRoboSilenciado("Triagem inicial", "dia")).toBe(
      'O robô não respondeu: o fluxo "Triagem inicial" roda 1x a cada 24h por contato e já rodou neste período.',
    );
  });

  it("cenário sem nome não vira aspas vazias", () => {
    expect(recadoRoboSilenciado("  ", "semana")).toBe(
      "O robô não respondeu: o fluxo roda 1x a cada 7 dias por contato e já rodou neste período.",
    );
  });

  it("todo limite tem rótulo e período — inclusive os que ninguém usa", () => {
    for (const l of LIMITES_POR_CONTATO) {
      expect(ROTULO_LIMITE_CONTATO[l]).toBeTruthy();
      expect(PERIODO_LIMITE_CONTATO[l]).toBeTruthy();
    }
  });

  it('os rótulos dizem a janela real: "por dia" é 24h corridas, não dia do calendário', () => {
    expect(ROTULO_LIMITE_CONTATO.dia).toBe("1x a cada 24h");
    expect(ROTULO_LIMITE_CONTATO.semana).toBe("1x a cada 7 dias");
    expect(ROTULO_LIMITE_CONTATO.mes).toBe("1x a cada 30 dias");
  });

  it("a conta no servidor continua sendo a janela deslizante que o rótulo promete", () => {
    const disp = ler("server/smartflow/dispatcher.ts");
    expect(disp).toContain("dia: 24 * 60 * 60 * 1000");
    expect(disp).toContain("semana: 7 * 24 * 60 * 60 * 1000");
    expect(disp).toContain("mes: 30 * 24 * 60 * 60 * 1000");
  });
});

describe("amarras no código do recado", () => {
  const disp = ler("server/smartflow/dispatcher.ts");
  const registrar = disp.slice(
    disp.indexOf("async function registrarRoboSilenciado"),
    disp.indexOf("const cacheFuso = new Map"),
  );

  it("o recado só é gravado quando a execução tem conversa", () => {
    expect(disp).toContain("if (refs?.conversaId) await registrarRoboSilenciado(escritorioId, cenario, refs.conversaId);");
  });

  it("é gravado no PULO do limite, não em qualquer pulo", () => {
    const trecho = disp.slice(
      disp.indexOf("if (await atingiuLimitePorContato(cenario, refs?.contatoId)) {"),
      disp.indexOf("const execId = await criarExecucao("),
    );
    expect(trecho).toContain("registrarRoboSilenciado");
  });

  it("a conversa é lida escopada pelo escritório", () => {
    expect(registrar).toContain("eq(conversas.escritorioId, escritorioId)");
  });

  it("um recado por atendimento: a janela é o início do atendimento atual", () => {
    expect(registrar).toContain("conv.atendimentoIniciadoEm ?? conv.createdAt");
    expect(registrar).toContain("gte(mensagens.createdAt, inicio)");
    expect(registrar).toContain("if (jaAvisado) return;");
  });

  it("a busca do recado anterior é pelo marcador dele, não por 'qualquer sistema'", () => {
    expect(registrar).toContain('like(mensagens.payload, "%robo_silenciado%")');
  });

  it("nasce como mensagem de sistema, com o marcador no payload", () => {
    expect(registrar).toContain('tipo: "sistema"');
    expect(registrar).toContain('tipo: "robo_silenciado"');
  });

  it("o texto vem do shared — a tela e o recado não podem divergir", () => {
    expect(registrar).toContain("recadoRoboSilenciado(cenario.nome, cenario.limitePorContato)");
  });

  it("falha ao gravar o recado não derruba o disparo", () => {
    expect(registrar).toContain("catch (err: any)");
  });
});

describe("o Atendimento desenha o recado, e ele não sai como bolha do robô", () => {
  const tela = ler("client/src/pages/Atendimento.tsx");

  it("mensagem de sistema tem desenho próprio", () => {
    expect(tela).toContain('m.tipo === "sistema" ? (');
    expect(tela).toContain('data-testid="recado-sistema"');
  });

  it("a tela diz que é interno — senão alguém acha que foi enviado ao cliente", () => {
    expect(tela).toContain("Recado interno — o cliente não vê.");
  });

  it("o histórico que a IA lê continua pulando mensagem de sistema", () => {
    expect(ler("server/smartflow/historico-conversa.ts")).toContain('if (r.tipo === "sistema") continue;');
  });
});

describe("o editor do SmartFlow mostra os mesmos rótulos", () => {
  const editor = ler("client/src/pages/SmartFlowEditor.tsx");

  it("as opções vêm da lista compartilhada", () => {
    expect(editor).toContain("LIMITES_POR_CONTATO.map");
    expect(editor).toContain("ROTULO_LIMITE_CONTATO[l]");
  });

  it("nenhuma opção continua escrita à mão na tela", () => {
    expect(editor).not.toContain('<SelectItem value="dia">1x por dia</SelectItem>');
    expect(editor).not.toContain('<SelectItem value="vida">');
  });

  it("o servidor valida pela mesma lista, nas duas procedures (criar e atualizar)", () => {
    const router = ler("server/smartflow/router-smartflow.ts");
    expect(router.match(/z\.enum\(LIMITES_POR_CONTATO\)/g) ?? []).toHaveLength(2);
    expect(router).not.toContain('z.enum(["sempre", "dia", "semana", "mes", "vida"])');
  });
});
