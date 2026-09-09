/**
 * Testes de `validarGrafo` — função pura usada pelo editor antes de salvar.
 */

import { describe, it, expect } from "vitest";
import {
  validarGrafo,
  type PassoValidar,
  type EdgeValidar,
} from "../../shared/smartflow-graph-validation";

function passo(nodeId: string, clienteId: string, tipo: PassoValidar["tipo"] = "whatsapp_enviar"): PassoValidar {
  return { nodeId, clienteId, tipo, config: {}, temProximoSe: false };
}

describe("validarGrafo", () => {
  it("aceita cenário vazio como erro (bloqueia)", () => {
    const r = validarGrafo("gat", [], []);
    expect(r.erros).toContain("Adicione pelo menos um passo ao cenário.");
    expect(r.avisos).toEqual([]);
  });

  it("aceita fluxo linear válido sem avisos nem erros", () => {
    const passos = [passo("p1", "c1"), passo("p2", "c2"), passo("p3", "c3")];
    const edges: EdgeValidar[] = [
      { source: "gat", target: "p1" },
      { source: "p1", target: "p2" },
      { source: "p2", target: "p3" },
    ];
    const r = validarGrafo("gat", passos, edges);
    expect(r.erros).toEqual([]);
    expect(r.avisos).toEqual([]);
  });

  it("detecta ciclo — passo que aponta pra si mesmo", () => {
    const passos = [passo("p1", "c1")];
    const edges: EdgeValidar[] = [
      { source: "gat", target: "p1" },
      { source: "p1", target: "p1" },
    ];
    const r = validarGrafo("gat", passos, edges);
    expect(r.erros.join("|")).toContain("Aguardar resposta");
  });

  it("detecta ciclo indireto — A → B → A", () => {
    const passos = [passo("p1", "c1"), passo("p2", "c2")];
    const edges: EdgeValidar[] = [
      { source: "gat", target: "p1" },
      { source: "p1", target: "p2" },
      { source: "p2", target: "p1" }, // volta
    ];
    const r = validarGrafo("gat", passos, edges);
    expect(r.erros.join("|")).toContain("Aguardar resposta");
  });

  it("detecta ciclo em grafo longo — A → B → C → D → B", () => {
    const passos = [passo("p1", "c1"), passo("p2", "c2"), passo("p3", "c3"), passo("p4", "c4")];
    const edges: EdgeValidar[] = [
      { source: "gat", target: "p1" },
      { source: "p1", target: "p2" },
      { source: "p2", target: "p3" },
      { source: "p3", target: "p4" },
      { source: "p4", target: "p2" },
    ];
    const r = validarGrafo("gat", passos, edges);
    expect(r.erros.join("|")).toContain("Aguardar resposta");
  });

  it("órfão é permitido (não gera erro nem aviso)", () => {
    // Passo pode ser alvo só de um ramo específico; a validação não força
    // alcançabilidade desde o gatilho.
    const passos = [passo("p1", "c1"), passo("p2", "c2")];
    const edges: EdgeValidar[] = [
      { source: "gat", target: "p1" },
      // p2 não é alcançável — ok.
    ];
    const r = validarGrafo("gat", passos, edges);
    expect(r.erros).toEqual([]);
    expect(r.avisos).toEqual([]);
  });

  it("ERRO — condicional sem saídas conectadas", () => {
    const passos = [
      passo("p1", "c1"),
      { nodeId: "pcond", clienteId: "cc", tipo: "condicional" as const, config: {}, temProximoSe: true },
    ];
    const edges: EdgeValidar[] = [
      { source: "gat", target: "p1" },
      { source: "p1", target: "pcond" },
      // pcond sem saída
    ];
    const r = validarGrafo("gat", passos, edges);
    expect(r.erros.some((e) => e.includes("condicional"))).toBe(true);
  });

  it("condicional com saída não gera erro nem aviso", () => {
    const passos = [
      { nodeId: "pcond", clienteId: "cc", tipo: "condicional" as const, config: {}, temProximoSe: true },
      passo("p1", "c1"),
    ];
    const edges: EdgeValidar[] = [
      { source: "gat", target: "pcond" },
      { source: "pcond", target: "p1", sourceHandle: "fallback" },
    ];
    const r = validarGrafo("gat", passos, edges);
    expect(r.erros).toEqual([]);
    expect(r.avisos).toEqual([]);
  });

  it("grafo com ramos paralelos é válido (não é ciclo)", () => {
    // gat → cond; cond → p1 (cond_a); cond → p2 (fallback); ambos levam a p3
    const passos = [
      { nodeId: "pcond", clienteId: "cc", tipo: "condicional" as const, config: {}, temProximoSe: true },
      passo("p1", "c1"),
      passo("p2", "c2"),
      passo("p3", "c3"),
    ];
    const edges: EdgeValidar[] = [
      { source: "gat", target: "pcond" },
      { source: "pcond", target: "p1", sourceHandle: "cond_a" },
      { source: "pcond", target: "p2", sourceHandle: "fallback" },
      { source: "p1", target: "p3" },
      { source: "p2", target: "p3" },
    ];
    const r = validarGrafo("gat", passos, edges);
    expect(r.erros).toEqual([]);
    expect(r.avisos).toEqual([]);
  });

  it("PERMITE ciclo que passa por 'Aguardar resposta' (loop conversacional)", () => {
    // ia → aguardar → cond; cond volta pra ia (fallback) e tem saída cond_ok.
    const passos: PassoValidar[] = [
      { nodeId: "ia", clienteId: "ia", tipo: "ia_responder", config: {}, temProximoSe: true },
      { nodeId: "wait", clienteId: "wait", tipo: "whatsapp_aguardar_resposta", config: {}, temProximoSe: true },
      { nodeId: "cond", clienteId: "cond", tipo: "condicional", config: {}, temProximoSe: true },
      passo("fim", "fim"),
    ];
    const edges: EdgeValidar[] = [
      { source: "gat", target: "ia" },
      { source: "ia", target: "wait" },
      { source: "wait", target: "cond" },
      { source: "cond", target: "ia", sourceHandle: "fallback" }, // loop com espera = ok
      { source: "cond", target: "fim", sourceHandle: "cond_ok" },
    ];
    const r = validarGrafo("gat", passos, edges);
    expect(r.erros).toEqual([]);
  });

  it("PERMITE ciclo que passa por 'Pergunta com opções' (espera o clique)", () => {
    // pergunta → cond; cond volta pra pergunta (fallback). O pergunta_opcoes
    // pausa esperando o botão, então o ciclo NÃO gira sozinho.
    const passos: PassoValidar[] = [
      { nodeId: "perg", clienteId: "perg", tipo: "whatsapp_pergunta_opcoes", config: {}, temProximoSe: true },
      { nodeId: "cond", clienteId: "cond", tipo: "condicional", config: {}, temProximoSe: true },
      passo("fim", "fim"),
    ];
    const edges: EdgeValidar[] = [
      { source: "gat", target: "perg" },
      { source: "perg", target: "cond", sourceHandle: "opcao_a" },
      { source: "cond", target: "perg", sourceHandle: "fallback" }, // loop com espera = ok
      { source: "cond", target: "fim", sourceHandle: "cond_ok" },
    ];
    const r = validarGrafo("gat", passos, edges);
    expect(r.erros).toEqual([]);
  });

  it("BLOQUEIA ciclo sem espera mesmo tendo um aguardar em OUTRO ramo", () => {
    // p1 → p2 → p1 (sem espera) é inseguro, independente de existir um wait solto.
    const passos: PassoValidar[] = [
      passo("p1", "c1"),
      passo("p2", "c2"),
      { nodeId: "wsolto", clienteId: "ws", tipo: "whatsapp_aguardar_resposta", config: {}, temProximoSe: false },
    ];
    const edges: EdgeValidar[] = [
      { source: "gat", target: "p1" },
      { source: "p1", target: "p2" },
      { source: "p2", target: "p1" }, // ciclo sem espera
    ];
    const r = validarGrafo("gat", passos, edges);
    expect(r.erros.join("|")).toContain("Aguardar resposta");
  });

  // Regressão 27/08: fluxo real do dono — clique no botão "Podemos sim" e
  // nada aconteceu. A seta daquele botão não existia em `proximoSe`, o engine
  // encerrou EM SILÊNCIO e nenhuma validação acusou. O save agora aponta o
  // botão solto pelo nome.
  describe("Pergunta com opções — saídas dos botões", () => {
    const perg = (config: Record<string, unknown>): PassoValidar => ({
      nodeId: "perg",
      clienteId: "cperg",
      tipo: "whatsapp_pergunta_opcoes",
      config,
      temProximoSe: true,
    });

    it("ERRO — bloco sem NENHUMA saída (pergunta e morre calado)", () => {
      const passos = [perg({ opcoes: [{ id: "b1", titulo: "Podemos sim" }] })];
      const edges: EdgeValidar[] = [{ source: "gat", target: "perg" }];
      const r = validarGrafo("gat", passos, edges);
      expect(r.erros.some((e) => e.includes("Pergunta com opções sem nenhuma saída"))).toBe(true);
    });

    it("AVISO nomeando o botão sem seta — os outros ramos ligados não bastam", () => {
      const passos = [
        perg({ opcoes: [{ id: "b1", titulo: "Podemos sim" }, { id: "b2", titulo: "Podemos Não" }] }),
        passo("fim", "cfim"),
      ];
      const edges: EdgeValidar[] = [
        { source: "gat", target: "perg" },
        { source: "perg", target: "fim", sourceHandle: "cond_b2" },
      ];
      const r = validarGrafo("gat", passos, edges);
      expect(r.erros).toEqual([]);
      expect(r.avisos.some((a) => a.includes('"Podemos sim"') && a.includes("não tem seta"))).toBe(true);
    });

    it("todos os botões ligados → sem aviso de seta solta", () => {
      const passos = [
        perg({ opcoes: [{ id: "b1", titulo: "Sim" }, { id: "b2", titulo: "Não" }] }),
        passo("a", "ca"),
        passo("b", "cb"),
      ];
      const edges: EdgeValidar[] = [
        { source: "gat", target: "perg" },
        { source: "perg", target: "a", sourceHandle: "cond_b1" },
        { source: "perg", target: "b", sourceHandle: "cond_b2" },
      ];
      const r = validarGrafo("gat", passos, edges);
      expect(r.erros).toEqual([]);
      expect(r.avisos.some((a) => a.includes("não tem seta"))).toBe(false);
    });

    it("modo lista valida os itens das seções", () => {
      const passos = [
        perg({
          modo: "lista",
          secoes: [{ titulo: "S", itens: [{ id: "i1", titulo: "Agendar" }, { id: "i2", titulo: "Cancelar" }] }],
        }),
        passo("a", "ca"),
      ];
      const edges: EdgeValidar[] = [
        { source: "gat", target: "perg" },
        { source: "perg", target: "a", sourceHandle: "cond_i1" },
      ];
      const r = validarGrafo("gat", passos, edges);
      expect(r.avisos.some((a) => a.includes('"Cancelar"') && a.includes("não tem seta"))).toBe(true);
    });
  });

  // "Enviar template" ramifica pelos botões quick-reply — mesmas regras de
  // seta solta da Pergunta com opções, com uma exceção: template SEM botão
  // é envio simples (fim natural permitido).
  describe("Enviar template — saídas dos botões", () => {
    const tpl = (config: Record<string, unknown>): PassoValidar => ({
      nodeId: "tpl",
      clienteId: "ctpl",
      tipo: "whatsapp_enviar_template",
      config,
      temProximoSe: true,
    });

    it("ERRO — template COM botões e nenhuma saída", () => {
      const passos = [tpl({ opcoes: [{ id: "qr0", titulo: "Podemos sim" }] })];
      const edges: EdgeValidar[] = [{ source: "gat", target: "tpl" }];
      const r = validarGrafo("gat", passos, edges);
      expect(r.erros.some((e) => e.includes("Enviar template sem nenhuma saída"))).toBe(true);
    });

    it("template SEM botões e sem saída é fim natural (não é erro)", () => {
      const passos = [tpl({ opcoes: [] })];
      const edges: EdgeValidar[] = [{ source: "gat", target: "tpl" }];
      const r = validarGrafo("gat", passos, edges);
      expect(r.erros).toEqual([]);
    });

    it("AVISO nomeando o botão do template sem seta", () => {
      const passos = [
        tpl({ opcoes: [{ id: "qr0", titulo: "Podemos sim" }, { id: "qr1", titulo: "Podemos não" }] }),
        passo("fim", "cfim"),
      ];
      const edges: EdgeValidar[] = [
        { source: "gat", target: "tpl" },
        { source: "tpl", target: "fim", sourceHandle: "cond_qr1" },
      ];
      const r = validarGrafo("gat", passos, edges);
      expect(r.erros).toEqual([]);
      expect(r.avisos.some((a) => a.includes("Enviar template") && a.includes('"Podemos sim"'))).toBe(true);
    });

    it("ciclo passando pelo Enviar template é permitido (ele pausa esperando o clique)", () => {
      const passos = [
        tpl({ opcoes: [{ id: "qr0", titulo: "Sim" }] }),
        passo("p1", "c1"),
      ];
      const edges: EdgeValidar[] = [
        { source: "gat", target: "tpl" },
        { source: "tpl", target: "p1", sourceHandle: "cond_qr0" },
        { source: "p1", target: "tpl" },
      ];
      const r = validarGrafo("gat", passos, edges);
      expect(r.erros).toEqual([]);
    });
  });

  it("múltiplos erros convivem (ciclo + condicional sem saída)", () => {
    const passos = [
      passo("p1", "c1"),
      { nodeId: "pcond", clienteId: "cc", tipo: "condicional" as const, config: {}, temProximoSe: true },
    ];
    const edges: EdgeValidar[] = [
      { source: "gat", target: "p1" },
      { source: "p1", target: "p1" }, // ciclo → erro
      { source: "p1", target: "pcond" },
      // pcond sem saída → erro
    ];
    const r = validarGrafo("gat", passos, edges);
    expect(r.erros.length).toBeGreaterThanOrEqual(2);
    expect(r.avisos).toEqual([]);
  });
});

describe("validarGrafo — saída pra atendimento humano (avisos, não bloqueiam)", () => {
  const iaAtendente = (nodeId: string, ferramentas?: string[]): PassoValidar => ({
    nodeId,
    clienteId: nodeId,
    tipo: "ia_atendente",
    config: ferramentas ? { ferramentas } : {},
    temProximoSe: false,
  });

  it("AVISA — fluxo conversacional sem nenhuma saída pra humano", () => {
    const passos: PassoValidar[] = [iaAtendente("ia", ["agendar", "encerrar"])];
    const edges: EdgeValidar[] = [{ source: "gat", target: "ia" }];
    const r = validarGrafo("gat", passos, edges);
    expect(r.erros).toEqual([]);
    expect(r.avisos.some((a) => a.includes("saída para atendimento humano"))).toBe(true);
  });

  it("AVISA — aguardar resposta sem transferir em lugar nenhum", () => {
    const passos: PassoValidar[] = [
      passo("p1", "c1"),
      { nodeId: "wait", clienteId: "wait", tipo: "whatsapp_aguardar_resposta", config: {}, temProximoSe: false },
    ];
    const edges: EdgeValidar[] = [
      { source: "gat", target: "p1" },
      { source: "p1", target: "wait" },
    ];
    const r = validarGrafo("gat", passos, edges);
    expect(r.avisos.some((a) => a.includes("saída para atendimento humano"))).toBe(true);
  });

  it("NÃO avisa — fluxo só de notificação (sem passo conversacional)", () => {
    const passos = [passo("p1", "c1"), passo("p2", "c2")];
    const edges: EdgeValidar[] = [
      { source: "gat", target: "p1" },
      { source: "p1", target: "p2" },
    ];
    const r = validarGrafo("gat", passos, edges);
    expect(r.avisos).toEqual([]);
  });

  it("NÃO avisa — tem bloco 'Transferir p/ humano' no fluxo", () => {
    const passos: PassoValidar[] = [
      { nodeId: "perg", clienteId: "perg", tipo: "whatsapp_pergunta_opcoes", config: {}, temProximoSe: true },
      { nodeId: "transf", clienteId: "transf", tipo: "transferir", config: {}, temProximoSe: false },
    ];
    const edges: EdgeValidar[] = [
      { source: "gat", target: "perg" },
      { source: "perg", target: "transf", sourceHandle: "opcao_humano" },
    ];
    const r = validarGrafo("gat", passos, edges);
    expect(r.avisos).toEqual([]);
  });

  it("NÃO avisa 'sem saída' — Atendente IA com ferramenta transferir CONECTADA", () => {
    const passos: PassoValidar[] = [
      iaAtendente("ia", ["transferir"]),
      { nodeId: "transf", clienteId: "transf", tipo: "transferir", config: {}, temProximoSe: false },
    ];
    const edges: EdgeValidar[] = [
      { source: "gat", target: "ia" },
      { source: "ia", target: "transf", sourceHandle: "transferir" },
    ];
    const r = validarGrafo("gat", passos, edges);
    expect(r.avisos).toEqual([]);
  });

  it("AVISA — Atendente IA com ferramenta transferir marcada mas saída desconectada", () => {
    const passos: PassoValidar[] = [iaAtendente("ia", ["transferir"])];
    const edges: EdgeValidar[] = [{ source: "gat", target: "ia" }];
    const r = validarGrafo("gat", passos, edges);
    expect(r.erros).toEqual([]);
    expect(r.avisos.some((a) => a.includes("desconectada"))).toBe(true);
    // Tem a ferramenta → o aviso "sem saída pra humano" NÃO deve duplicar.
    expect(r.avisos.some((a) => a.includes("saída para atendimento humano"))).toBe(false);
  });

  it("saída transferir conectada em OUTRO nó não silencia o aviso do nó solto", () => {
    const passos: PassoValidar[] = [
      iaAtendente("ia1", ["transferir"]),
      iaAtendente("ia2", ["transferir"]),
      { nodeId: "transf", clienteId: "transf", tipo: "transferir", config: {}, temProximoSe: false },
    ];
    const edges: EdgeValidar[] = [
      { source: "gat", target: "ia1" },
      { source: "ia1", target: "ia2", sourceHandle: "encerrar" },
      { source: "ia2", target: "transf", sourceHandle: "transferir" },
      // ia1 tem a ferramenta mas a saída "transferir" dele está solta.
    ];
    const r = validarGrafo("gat", passos, edges);
    expect(r.avisos.some((a) => a.includes("desconectada"))).toBe(true);
  });
});
