/**
 * Conformidade Meta no módulo Atendimento — o pacote fechado depois do aviso
 * de spam de 19/08. Três portas que o relatório da auditoria apontou:
 *
 * 1. "Executar agora" do SmartFlow aceitava contexto arbitrário. Um JSON com
 *    `canalId` classificava TODO envio do cenário como "reply" — sem opt-out,
 *    sem opt-in, sem teto diário. `contatoId`/`conversaId` forjados entravam
 *    cru no guard e na memória dos agentes IA.
 *
 * 2. Os endpoints manuais de envio (template, botões, lista) passavam pelas
 *    travas anti-ban mas NÃO exigiam opt-in — número que nunca escreveu
 *    recebendo template é exatamente a mensagem que gera denúncia.
 *
 * 3. O bot se apresentava como pessoa ("Conduza a conversa de forma humana"),
 *    e os templates prontos diziam "Você é um advogado". A política da Meta
 *    exige transparência em experiência automatizada — e bot posando de
 *    advogado é risco OAB, não só de política.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { sanitizarContextoManual } from "../smartflow/dispatcher-helpers";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

describe("sanitizarContextoManual — identidade não é dado de teste", () => {
  it("remove as chaves que forjam reply/identidade", () => {
    const limpo = sanitizarContextoManual({
      canalId: 5,
      contatoId: 123,
      conversaId: 77,
      telefoneCliente: "5585999990000",
      cliente: { nome: "Teste" },
    });
    expect(limpo).toEqual({ telefoneCliente: "5585999990000", cliente: { nome: "Teste" } });
  });

  it("remove marcas internas de retomada do engine", () => {
    const limpo = sanitizarContextoManual({
      __resumindoWaitClienteId: "abc",
      __retomadaPorTimeout: true,
      mensagem: "oi",
    });
    expect(limpo).toEqual({ mensagem: "oi" });
  });

  it("variáveis de dado do teste passam intactas", () => {
    const ctx = {
      telefoneCliente: "5585988887777",
      pagamentoValor: 800,
      cliente: { nome: "Maria", telefone: "5585988887777" },
    };
    expect(sanitizarContextoManual(ctx)).toEqual(ctx);
  });

  it("executarManual passa o contexto bruto pela sanitização", () => {
    const dispatcher = ler("server/smartflow/dispatcher.ts");
    expect(dispatcher).toContain("sanitizarContextoManual(contextoBruto)");
  });
});

describe("envio manual (Cloud API) exige opt-in", () => {
  // Estrutural de propósito: o guard em si já tem teste próprio
  // (whatsapp-envio-guard.test.ts); aqui o que se trava é CADA chamada
  // proativa do router carregar `exigirOptin` — foi omissão pontual numa
  // chamada que abriu a porta da vez.
  const fonte = ler("server/routers/whatsapp-cloud-services.ts");

  it("toda chamada proativa do guard exige opt-in", () => {
    const guardas = fonte.match(/podeEnviar\(\{[\s\S]*?\}\)/g) ?? [];
    const proativas = guardas.filter((g) => g.includes("proativo: true"));
    expect(proativas.length).toBeGreaterThanOrEqual(3); // template, botões, lista
    for (const g of proativas) {
      expect(g, g).toContain("exigirOptin: true");
    }
  });

  it("reação continua sendo reply — sem exigir opt-in", () => {
    // Reação referencia mensagem que o contato mandou; exigir opt-in aqui
    // quebraria resposta legítima de atendimento.
    const guardas = fonte.match(/podeEnviar\(\{[\s\S]*?\}\)/g) ?? [];
    const replies = guardas.filter((g) => g.includes("proativo: false"));
    expect(replies.length).toBeGreaterThanOrEqual(1);
    for (const g of replies) {
      expect(g).not.toContain("exigirOptin");
    }
  });
});

describe("o bot se apresenta como assistente virtual, não como pessoa", () => {
  it("a instrução do Atendente IA manda revelar a automação", () => {
    const executores = ler("server/smartflow/executores.ts");
    expect(executores).toContain("NUNCA se apresente como pessoa");
    expect(executores).toContain("assistente virtual");
    expect(executores).not.toContain("Conduza a conversa de forma humana e natural");
  });

  it("nenhum template pronto de agente diz 'Você é um advogado'", () => {
    const agentes = ler("client/src/pages/AgentesIA.tsx");
    expect(agentes).not.toContain("Você é um advogado");
    expect(agentes).not.toContain("Você é um atendente jurídico");
    expect(agentes).toContain("assistente virtual");
  });

  it("a conversa pronta do editor já nasce se apresentando", () => {
    const editor = ler("client/src/pages/SmartFlowEditor.tsx");
    expect(editor).toContain("Apresente-se como o assistente virtual do escritório");
  });
});

describe("sinal fraco de descadastro vira alerta pro atendente", () => {
  it("o handler liga a detecção ao sino dos responsáveis", () => {
    const handler = ler("server/integracoes/whatsapp-handler.ts");
    expect(handler).toContain("pareceIntencaoDeOptOut(msg.conteudo)");
    expect(handler).toContain('kind: "possivel_optout"');
  });
});
