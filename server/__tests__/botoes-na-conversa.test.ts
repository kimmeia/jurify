/**
 * "Criei um fluxo que mostra botões para o cliente clicar, mas na conversa
 * não apareceu." (dono, 11/09/2026.)
 *
 * Os botões SAEM para o cliente pela Cloud API — o buraco era do nosso lado:
 * a conversa gravava só o corpo da pergunta, as opções não iam para lugar
 * nenhum, e o clique do cliente entrava como texto comum (por isso "Verificar
 * Processo" parecia digitado). E quando o envio interativo falhava, o motivo
 * vivia só no registro técnico do fluxo: na conversa não aparecia nada.
 *
 * Agora o envio grava as opções em `mensagens.payload` e a tela desenha as
 * três coisas: o que foi oferecido, que houve clique, e por que não saiu.
 * Nada disso fala com a Meta — é leitura do que já foi enviado.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import {
  cliqueDoPayload,
  envioInterativoDoPayload,
  opcoesDasSecoes,
} from "../../shared/mensagem-interativa";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

describe("leitura do que ficou gravado", () => {
  const payloadBotoes = {
    interativo: { modo: "botoes", opcoes: [{ id: "op1", titulo: "Verificar Processo" }, { id: "op2", titulo: "Financeiro" }] },
  };

  it("lê as opções enviadas", () => {
    const envio = envioInterativoDoPayload(payloadBotoes);
    expect(envio?.modo).toBe("botoes");
    expect(envio?.opcoes.map((o) => o.titulo)).toEqual(["Verificar Processo", "Financeiro"]);
  });

  it("lê igual quando o payload vem como texto do banco", () => {
    expect(envioInterativoDoPayload(JSON.stringify(payloadBotoes))?.opcoes).toHaveLength(2);
  });

  it("texto que não é JSON não derruba a conversa", () => {
    expect(envioInterativoDoPayload("{ isso não é json")).toBeNull();
    expect(cliqueDoPayload("[1,2,3]")).toBeNull();
  });

  it("mensagem comum não vira mensagem com botões", () => {
    expect(envioInterativoDoPayload(null)).toBeNull();
    expect(envioInterativoDoPayload({ interactiveReply: { id: "op1", titulo: "x" } })).toBeNull();
  });

  it("opção sem id ou sem título é descartada — botão vazio não se desenha", () => {
    const envio = envioInterativoDoPayload({
      interativo: { modo: "botoes", opcoes: [{ id: "a", titulo: "Ok" }, { id: "", titulo: "sem id" }, { id: "c" }] },
    });
    expect(envio?.opcoes).toEqual([{ id: "a", titulo: "Ok" }]);
  });

  it("lista sem nenhuma opção válida não vira bloco de botões", () => {
    expect(envioInterativoDoPayload({ interativo: { modo: "botoes", opcoes: [] } })).toBeNull();
  });

  it("modo desconhecido cai em botões (nunca inventa um terceiro desenho)", () => {
    const envio = envioInterativoDoPayload({ interativo: { modo: "carrossel", opcoes: [{ id: "a", titulo: "Ok" }] } });
    expect(envio?.modo).toBe("botoes");
  });

  it("lê o clique que voltou da Meta", () => {
    const c = cliqueDoPayload({ interactiveReply: { tipo: "button", id: "op1", titulo: "Verificar Processo" } });
    expect(c).toEqual({ tipo: "button", id: "op1", titulo: "Verificar Processo" });
  });

  it("texto digitado pelo cliente não vira clique", () => {
    expect(cliqueDoPayload({ interativo: { modo: "botoes", opcoes: [] } })).toBeNull();
    expect(cliqueDoPayload({})).toBeNull();
  });

  it("a lista é achatada: os itens de todas as seções, na ordem", () => {
    const plano = opcoesDasSecoes([
      { itens: [{ id: "a", titulo: "Primeiro" }] },
      { itens: [{ id: "b", titulo: "Segundo" }, { id: "", titulo: "descartado" }] },
    ]);
    expect(plano).toEqual([{ id: "a", titulo: "Primeiro" }, { id: "b", titulo: "Segundo" }]);
  });

  it("seções vazias não quebram", () => {
    expect(opcoesDasSecoes(undefined)).toEqual([]);
    expect(opcoesDasSecoes([{}, { itens: [] }])).toEqual([]);
  });
});

describe("o envio grava o que foi oferecido", () => {
  const exec = ler("server/smartflow/executores.ts");
  const interativo = exec.slice(
    exec.indexOf("async enviarWhatsAppInteractive(p)"),
    exec.indexOf("async enviarWhatsAppTemplate("),
  );

  it("as opções vão para o payload da mensagem", () => {
    expect(interativo).toContain("interativo: { modo: p.modo, opcoes, drawerLabel: p.drawerLabel }");
  });

  it("a lista usa o mesmo achatamento do shared — não uma cópia local", () => {
    expect(interativo).toContain('opcoesDasSecoes(p.secoes)');
  });

  it("sem opção nenhuma, o payload fica nulo (mensagem comum segue comum)", () => {
    expect(interativo).toContain("opcoes.length > 0");
  });

  it("o template também grava os botões que o cliente recebeu", () => {
    const tpl = exec.slice(exec.indexOf("async enviarWhatsAppTemplate("));
    expect(tpl).toContain("interativo: { modo: \"botoes\", opcoes: botoesTpl, template: template.nome }");
    expect(ler("server/smartflow/engine.ts")).toContain("conteudoPreview, botoes: quickReplies,");
  });

  it("quem grava a mensagem passa o payload adiante", () => {
    expect(exec).toContain("payload: dados.payload ?? null,");
  });
});

describe("a falha de envio deixa recado na conversa", () => {
  const exec = ler("server/smartflow/executores.ts");
  const falha = exec.slice(
    exec.indexOf("SmartFlow: envio WhatsApp interativo falhou"),
    exec.indexOf("} else if (p.contatoId) {"),
  );

  it("o recado é interno (mensagem de sistema, não vai pro cliente)", () => {
    expect(falha).toContain('tipo: "sistema"');
  });

  it("o recado carrega o motivo REAL quando existe", () => {
    expect(falha).toContain("${r.erro ||");
  });

  it("sem motivo, explica o suspeito de sempre (canal não é o oficial)", () => {
    expect(falha).toContain("precisa ser WhatsApp oficial, Cloud API");
  });

  it("só grava quando dá pra achar a conversa do contato", () => {
    expect(falha).toContain("if (p.contatoId) {");
  });
});

describe("a conversa desenha as três coisas", () => {
  const tela = ler("client/src/pages/Atendimento.tsx");
  const comp = ler("client/src/pages/atendimento/opcoes-interativas.tsx");

  it("a bolha enviada mostra as opções", () => {
    expect(tela).toContain("<OpcoesEnviadas payload={(m as any).payload} />");
    expect(comp).toContain('data-testid="opcoes-enviadas"');
  });

  it("a bolha recebida mostra que houve clique", () => {
    expect(tela).toContain("<CliqueEmBotao payload={(m as any).payload} />");
    expect(comp).toContain('data-testid="clicou-no-botao"');
  });

  it("os botões desenhados não são clicáveis — é registro, não controle", () => {
    expect(comp).not.toContain("<button");
    expect(comp).not.toContain("onClick");
  });

  it("a tela lê pelo shared, não por um parser próprio", () => {
    expect(comp).toContain('from "@shared/mensagem-interativa"');
    expect(comp).not.toContain("JSON.parse");
  });

  it("o recado de sistema (a falha) já tinha desenho próprio e continua tendo", () => {
    expect(tela).toContain('m.tipo === "sistema" ? (');
    expect(tela).toContain("Recado interno — o cliente não vê.");
  });

  it("a lista de mensagens continua devolvendo o payload pro client", () => {
    const dbCrm = ler("server/escritorio/db-crm.ts");
    const listar = dbCrm.slice(dbCrm.indexOf("export async function listarMensagens("));
    // `select()` sem colunas + spread do row: payload vai junto. Se alguém
    // trocar por uma projeção manual, os botões somem da tela em silêncio.
    expect(listar).toContain("await db.select().from(mensagens)");
    expect(listar).toContain("...r,");
  });
});

describe("nada disso muda o que a Meta recebe", () => {
  const engine = ler("server/smartflow/engine.ts");

  it("o limite de 3 botões continua valendo", () => {
    expect(engine).toContain("Pergunta com opções: configure de 1 a 3 botões.");
  });

  it("a lista continua limitada a 10 seções e 10 itens por seção", () => {
    expect(engine).toContain("configure de 1 a 10 seções");
    expect(engine).toContain("cada seção precisa de 1 a 10 itens");
  });

  it("o envio proativo continua exigindo opt-in e contando o teto", () => {
    expect(engine).toContain("proativo: !veioDeMensagem");
    expect(engine).toContain("exigirOptin: !veioDeMensagem");
  });
});
