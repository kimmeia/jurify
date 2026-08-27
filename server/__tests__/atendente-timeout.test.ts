/**
 * Timeout configurável do Atendente IA (aprovado 27/08 com duas condições
 * do dono): teto de 24h — o prazo fica DENTRO da janela do WhatsApp — e
 * saída "nao_respondeu" opcional: sem seta ligada, o fluxo apenas termina
 * (comportamento de sempre é o padrão).
 *
 * Regressão embutida: no timeout, o agente NÃO re-executa. Antes a
 * retomada por timeout reentrava no nó e rodava o agente de novo —
 * resposta nova pra um cliente que sumiu.
 */
import { describe, it, expect, vi } from "vitest";
import { executarCenario, type Passo, type SmartflowExecutores } from "../smartflow/engine";
import { readFileSync } from "fs";
import { join } from "path";

function mockExec(overrides?: Partial<SmartflowExecutores>): SmartflowExecutores {
  return {
    conversarComAgente: vi.fn().mockResolvedValue({ resposta: "Olá! Como posso ajudar?", acao: null }),
    extrairCamposDoAgente: vi.fn().mockResolvedValue({}),
    resolverResponsavelAgenda: vi.fn().mockResolvedValue(null),
    enviarWhatsApp: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as SmartflowExecutores;
}

const ctxBase = { contatoId: 7, conversaId: 3, telefoneCliente: "5585999999999", mensagem: "oi" };

describe("ia_atendente — timeout configurável", () => {
  it("pausa com o tempo configurado (teto 1440 = 24h; ausente = 1440)", async () => {
    const casos: Array<[number | undefined, number]> = [
      [120, 120],        // 2h configuradas
      [99999, 1440],     // acima do teto → 24h
      [undefined, 1440], // sem config → comportamento de sempre
    ];
    for (const [configurado, esperado] of casos) {
      const exec = mockExec();
      const passos: Passo[] = [
        {
          id: 1, ordem: 1, tipo: "ia_atendente", clienteId: "ia",
          config: { agenteId: 11, ...(configurado != null ? { timeoutMinutos: configurado } : {}) },
        },
      ];
      const r = await executarCenario(passos, { ...ctxBase }, exec);
      expect(r.sucesso).toBe(true);
      expect((r.contexto as any).aguardandoTimeoutMinutos).toBe(esperado);
      expect((r.contexto as any).aguardandoNodeClienteId).toBe("ia");
    }
  });

  it("timeout sai pela saída nao_respondeu SEM re-rodar o agente", async () => {
    const exec = mockExec();
    const passos: Passo[] = [
      {
        id: 1, ordem: 1, tipo: "ia_atendente", clienteId: "ia",
        config: { agenteId: 11, timeoutMinutos: 120 },
        proximoSe: { nao_respondeu: "fim" },
      },
      { id: 2, ordem: 2, tipo: "definir_variavel", config: { chave: "destino", valor: "followup" }, clienteId: "fim" },
    ];
    const ctx = {
      ...ctxBase,
      __resumindoWaitClienteId: "ia",
      __resumindoWaitMotivo: "timeout",
      __retomadaPorTimeout: true,
    };
    const r = await executarCenario(passos, ctx, exec);
    expect(r.sucesso).toBe(true);
    expect((r.contexto as any).destino).toBe("followup");
    expect(exec.conversarComAgente).not.toHaveBeenCalled();
  });

  it("timeout SEM seta ligada apenas termina (padrão do dono) — e não roda o agente", async () => {
    const exec = mockExec();
    const passos: Passo[] = [
      {
        id: 1, ordem: 1, tipo: "ia_atendente", clienteId: "ia",
        config: { agenteId: 11 },
        proximoSe: { agendar: "outro" }, // tem setas, mas não a nao_respondeu
      },
      { id: 2, ordem: 2, tipo: "definir_variavel", config: { chave: "x", valor: "y" }, clienteId: "outro" },
    ];
    const ctx = { ...ctxBase, __resumindoWaitClienteId: "ia", __resumindoWaitMotivo: "timeout" };
    const r = await executarCenario(passos, ctx, exec);
    expect(r.sucesso).toBe(true);
    expect((r.contexto as any).x).toBeUndefined(); // não desviou pra outro ramo
    expect(exec.conversarComAgente).not.toHaveBeenCalled();
  });

  it("retomada por MENSAGEM continua re-executando o agente (só o timeout mudou)", async () => {
    const exec = mockExec();
    const passos: Passo[] = [
      { id: 1, ordem: 1, tipo: "ia_atendente", clienteId: "ia", config: { agenteId: 11 } },
    ];
    const ctx = { ...ctxBase, __resumindoWaitClienteId: "ia", respostaUsuario: "quero agendar" };
    const r = await executarCenario(passos, ctx, exec);
    expect(r.sucesso).toBe(true);
    expect(exec.conversarComAgente).toHaveBeenCalledTimes(1);
  });
});

describe("amarras de UI", () => {
  const raiz = join(__dirname, "..", "..");
  const editor = readFileSync(join(raiz, "client/src/pages/SmartFlowEditor.tsx"), "utf8");

  it("o nó mostra a saída 'não respondeu' e o painel tem o campo em MINUTOS com teto 1440", () => {
    expect(editor).toContain('handleId="nao_respondeu"');
    expect(editor).toContain("Se o cliente sumir no meio da conversa");
    // Campo em minutos (pedido do dono 27/08) com teto de 1440 = 24h
    // (condição expressa: dentro da janela do WhatsApp).
    const secao = editor.slice(editor.indexOf("Se o cliente sumir"), editor.indexOf("Agrupar mensagens picadas"));
    expect(secao).toContain("max={1440}");
    expect(secao).toContain("minutos");
    expect(secao).not.toContain("horas</span>");
  });

  it("config compartilhada documenta o teto de 1440 minutos", () => {
    const shared = readFileSync(join(raiz, "shared/smartflow-types.ts"), "utf8");
    const bloco = shared.slice(shared.indexOf("interface ConfigIaAtendente"), shared.indexOf("TipoCampoExtracao"));
    expect(bloco).toContain("timeoutMinutos");
    expect(bloco).toContain("1440");
  });
});
