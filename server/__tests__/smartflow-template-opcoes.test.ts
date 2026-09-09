/**
 * Bloco "Enviar template" (whatsapp_enviar_template) — follow-up fora da
 * janela de 24h. Envia template APROVADO da Meta com payload nos botões
 * quick-reply e pausa esperando a resposta; o clique volta como type
 * "button" ({payload, text}) e roteia cond_<id>.
 *
 * Amarras anti-punição (aprovadas pelo dono em 27/08, condição explícita
 * "se respeita a documentação"): MARKETING não sai sem confirmação extra;
 * o executor de template força exigirOptin (coberto em executores.ts).
 */
import { describe, it, expect, vi } from "vitest";
import { executarCenario, type Passo, type SmartflowExecutores } from "../smartflow/engine";
import { readFileSync } from "fs";
import { join } from "path";

function mockExec(overrides?: Partial<SmartflowExecutores>): SmartflowExecutores {
  return {
    chamarIA: vi.fn().mockResolvedValue("ok"),
    enviarWhatsApp: vi.fn().mockResolvedValue(true),
    enviarWhatsAppTemplate: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  } as unknown as SmartflowExecutores;
}

const cfgBase = {
  templateNome: "followup_continuidade",
  templateIdioma: "pt_BR",
  templateCategoria: "UTILITY",
  templateCorpoTexto: "Olá {{1}}! Podemos dar continuidade ao seu atendimento?",
  templateCorpo: ["{{nomeCliente}}"],
  opcoes: [
    { id: "qr0", titulo: "Podemos sim", index: 0 },
    { id: "qr1", titulo: "Podemos não", index: 1 },
  ],
};

const ctxEnvio = { contatoId: 7, telefoneCliente: "5585999999999", nomeCliente: "Rafael" };

describe("whatsapp_enviar_template — envio", () => {
  it("envia com payload quick_reply por botão e PAUSA aguardando resposta (default 24h)", async () => {
    const exec = mockExec();
    const passos: Passo[] = [
      { id: 1, ordem: 1, tipo: "whatsapp_enviar_template", config: cfgBase, clienteId: "n1" },
    ];
    const r = await executarCenario(passos, ctxEnvio, exec);
    expect(r.sucesso).toBe(true);
    expect((r.contexto as any).aguardandoMensagem).toBe(true);
    expect((r.contexto as any).aguardandoContatoId).toBe(7);
    expect((r.contexto as any).aguardandoTimeoutMinutos).toBe(1440);
    expect((r.contexto as any).aguardandoNodeClienteId).toBe("n1");

    const [telefone, template] = (exec.enviarWhatsAppTemplate as any).mock.calls[0];
    expect(telefone).toBe("5585999999999");
    expect(template.nome).toBe("followup_continuidade");
    // O payload de CADA botão vai no envio — é ele que volta no clique e
    // permite rotear cond_<id> sem depender do texto aprovado do botão.
    const quickReplies = (template.componentes as any[]).filter(
      (c) => c.type === "button" && c.sub_type === "quick_reply",
    );
    expect(quickReplies).toHaveLength(2);
    expect(quickReplies[0].parameters[0].payload).toBe("qr0");
    expect(quickReplies[1].parameters[0].payload).toBe("qr1");
    // Variável do corpo interpolada com o contexto do fluxo.
    const body = (template.componentes as any[]).find((c) => c.type === "body");
    expect(body.parameters[0].text).toBe("Rafael");
  });

  it("MARKETING sem a confirmação extra NÃO envia (anti-punição)", async () => {
    const exec = mockExec();
    const passos: Passo[] = [
      {
        id: 1, ordem: 1, tipo: "whatsapp_enviar_template", clienteId: "n1",
        config: { ...cfgBase, templateCategoria: "MARKETING" },
      },
    ];
    const r = await executarCenario(passos, ctxEnvio, exec);
    expect(r.sucesso).toBe(false);
    expect(r.erro).toMatch(/MARKETING/);
    expect(exec.enviarWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it("MARKETING com confirmação explícita envia", async () => {
    const exec = mockExec();
    const passos: Passo[] = [
      {
        id: 1, ordem: 1, tipo: "whatsapp_enviar_template", clienteId: "n1",
        config: { ...cfgBase, templateCategoria: "MARKETING", confirmoMarketing: true },
      },
    ];
    const r = await executarCenario(passos, ctxEnvio, exec);
    expect(r.sucesso).toBe(true);
    expect(exec.enviarWhatsAppTemplate).toHaveBeenCalled();
  });

  it("template SEM botão não pausa — segue pela saída default", async () => {
    const exec = mockExec();
    const passos: Passo[] = [
      {
        id: 1, ordem: 1, tipo: "whatsapp_enviar_template", clienteId: "n1",
        config: { ...cfgBase, opcoes: [] },
        proximoSe: { default: "fim" },
      },
      { id: 2, ordem: 2, tipo: "definir_variavel", config: { chave: "seguiu", valor: "sim" }, clienteId: "fim" },
    ];
    const r = await executarCenario(passos, ctxEnvio, exec);
    expect(r.sucesso).toBe(true);
    expect((r.contexto as any).seguiu).toBe("sim");
    expect((r.contexto as any).aguardandoMensagem).toBeUndefined();
  });

  it("sem template escolhido falha cedo com mensagem clara", async () => {
    const exec = mockExec();
    const passos: Passo[] = [
      { id: 1, ordem: 1, tipo: "whatsapp_enviar_template", config: {}, clienteId: "n1" },
    ];
    const r = await executarCenario(passos, ctxEnvio, exec);
    expect(r.sucesso).toBe(false);
    expect(exec.enviarWhatsAppTemplate).not.toHaveBeenCalled();
  });
});

describe("whatsapp_enviar_template — retomada", () => {
  const passosComRamos = (extra?: Partial<Passo>): Passo[] => [
    {
      id: 1, ordem: 1, tipo: "whatsapp_enviar_template", config: cfgBase, clienteId: "n1",
      proximoSe: {
        cond_qr0: "fim_sim",
        cond_qr1: "fim_nao",
        outra_resposta: "fim_outra",
        sem_resposta: "fim_timeout",
      },
      ...extra,
    },
    { id: 2, ordem: 2, tipo: "definir_variavel", config: { chave: "ramo", valor: "sim" }, clienteId: "fim_sim" },
    { id: 3, ordem: 3, tipo: "definir_variavel", config: { chave: "ramo", valor: "nao" }, clienteId: "fim_nao" },
    { id: 4, ordem: 4, tipo: "definir_variavel", config: { chave: "ramo", valor: "outra" }, clienteId: "fim_outra" },
    { id: 5, ordem: 5, tipo: "definir_variavel", config: { chave: "ramo", valor: "timeout" }, clienteId: "fim_timeout" },
  ];

  it("clique no botão do template (payload qrN) roteia cond_<id> sem reenviar", async () => {
    const exec = mockExec();
    const ctx = {
      ...ctxEnvio,
      __resumindoWaitClienteId: "n1",
      respostaUsuario: "Podemos sim",
      respostaOpcao: { tipo: "button", id: "qr0", titulo: "Podemos sim" },
    };
    const r = await executarCenario(passosComRamos(), ctx, exec);
    expect(r.sucesso).toBe(true);
    expect((r.contexto as any).ramo).toBe("sim");
    expect(exec.enviarWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it("payload desconhecido (template antigo) cai no match por TÍTULO do botão", async () => {
    const exec = mockExec();
    const ctx = {
      ...ctxEnvio,
      __resumindoWaitClienteId: "n1",
      respostaOpcao: { tipo: "button", id: "payload-de-outro-fluxo", titulo: "Podemos não" },
    };
    const r = await executarCenario(passosComRamos(), ctx, exec);
    expect(r.sucesso).toBe(true);
    expect((r.contexto as any).ramo).toBe("nao");
  });

  it("timeout do scheduler roteia sem_resposta", async () => {
    const exec = mockExec();
    const ctx = {
      ...ctxEnvio,
      __resumindoWaitClienteId: "n1",
      __resumindoWaitMotivo: "timeout",
      __retomadaPorTimeout: true,
    };
    const r = await executarCenario(passosComRamos(), ctx, exec);
    expect(r.sucesso).toBe(true);
    expect((r.contexto as any).ramo).toBe("timeout");
  });

  it("texto livre com fuzzy bate por título; sem match cai em outra_resposta", async () => {
    const exec = mockExec();
    const bateu = await executarCenario(
      passosComRamos(),
      { ...ctxEnvio, __resumindoWaitClienteId: "n1", respostaUsuario: "podemos sim" },
      exec,
    );
    expect((bateu.contexto as any).ramo).toBe("sim");

    const semMatch = await executarCenario(
      passosComRamos(),
      { ...ctxEnvio, __resumindoWaitClienteId: "n1", respostaUsuario: "quero falar de outra coisa" },
      mockExec(),
    );
    expect((semMatch.contexto as any).ramo).toBe("outra");
  });
});

describe("pergunta com opções — motivo real do envio barrado", () => {
  // Caso real (execução #5391, 27/08): o timeout do Atendente IA disparou,
  // a Pergunta com opções tentou o envio proativo, o guard barrou — e o
  // painel só dizia "verifique canal Cloud API conectado". O executor agora
  // devolve { ok, erro } e o erro persistido carrega o motivo.
  it("erro do guard aparece no erro da execução (não o genérico)", async () => {
    const exec = mockExec({
      enviarWhatsAppInteractive: vi.fn().mockResolvedValue({
        ok: false,
        erro: "Qualidade do número está VERMELHA na Meta — disparos proativos pausados automaticamente até a qualidade se recuperar.",
      }),
    } as any);
    const passos: Passo[] = [
      {
        id: 1, ordem: 1, tipo: "whatsapp_pergunta_opcoes", clienteId: "n1",
        config: { modo: "botoes", body: "Pode prosseguir?", opcoes: [{ id: "b1", titulo: "Sim" }] },
      },
    ];
    const r = await executarCenario(passos, ctxEnvio, exec);
    expect(r.sucesso).toBe(false);
    expect(r.erro).toContain("VERMELHA");
    expect(r.erro).not.toContain("verifique canal Cloud API conectado");
  });

  it("executor booleano (mock antigo) continua aceito", async () => {
    const exec = mockExec({ enviarWhatsAppInteractive: vi.fn().mockResolvedValue(true) } as any);
    const passos: Passo[] = [
      {
        id: 1, ordem: 1, tipo: "whatsapp_pergunta_opcoes", clienteId: "n1",
        config: { modo: "botoes", body: "Pode prosseguir?", opcoes: [{ id: "b1", titulo: "Sim" }] },
      },
    ];
    const r = await executarCenario(passos, ctxEnvio, exec);
    expect(r.sucesso).toBe(true);
    expect((r.contexto as any).aguardandoMensagem).toBe(true);
  });
});

describe("amarras de UI e catálogo", () => {
  const raiz = join(__dirname, "..", "..");
  const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

  it("o tipo está declarado no catálogo compartilhado (paleta) como grupo mensagem", () => {
    const shared = ler("shared/smartflow-types.ts");
    expect(shared).toContain('"whatsapp_enviar_template"');
    expect(shared).toContain('id: "whatsapp_enviar_template", label: "Enviar template"');
  });

  it("editor: nó ramifica pelos botões e o painel tem o gate de Marketing", () => {
    const editor = ler("client/src/pages/SmartFlowEditor.tsx");
    expect(editor).toContain('data.tipo === "whatsapp_enviar_template"');
    expect(editor).toContain("ConfigWhatsappEnviarTemplateFields");
    expect(editor).toContain("confirmoMarketing");
  });

  it("builder de template grava categoria + snapshot dos quick-replies (payload qrN)", () => {
    const builder = ler("client/src/pages/smartflow/config-whatsapp-template.tsx");
    expect(builder).toContain("comOpcoes");
    expect(builder).toContain("templateCategoria");
    expect(builder).toContain("`qr${b.index}`");
  });
});
