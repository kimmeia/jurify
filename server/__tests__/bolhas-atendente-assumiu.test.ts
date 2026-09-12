/**
 * As bolhas da MESMA resposta não se reconferiam entre si.
 *
 * Uma resposta do robô é dividida em bolhas ("atendente humano"), com pausa
 * entre elas proporcional ao tamanho da próxima. Quem chama confere o status
 * da conversa ANTES da resposta, mas a resposta inteira leva segundos até a
 * última bolha — e a pausa é exatamente a janela em que o atendente digita.
 * Assumir a conversa no meio parava as respostas SEGUINTES e não as bolhas
 * que faltavam da resposta em curso.
 *
 * A conferência fica só a partir da segunda bolha: a primeira sai logo depois
 * da checagem de quem chamou, e reconferir ali seria consulta a mais por
 * mensagem sem cobrir nada novo.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

const handler = ler("server/integracoes/whatsapp-handler.ts");
const enviarResposta = handler.slice(
  handler.indexOf("async function enviarResposta("),
  handler.indexOf("async function buscarContextoEnvioConversa("),
);

describe("bolhas da mesma resposta param quando o atendente assume", () => {
  it("existe reconferência do status dentro do laço de bolhas", () => {
    expect(enviarResposta).toContain('(await pegarStatusConversa(conversaId)) === "em_atendimento"');
  });

  it("a reconferência interrompe o laço em vez de só pular uma bolha", () => {
    const trecho = enviarResposta.slice(
      enviarResposta.indexOf("pegarStatusConversa(conversaId)"),
    );
    expect(trecho.slice(0, 400)).toContain("break;");
  });

  it("acontece DEPOIS da pausa, que é a janela em que o atendente digita", () => {
    // Âncora na CHAMADA, não no import do helper lá em cima.
    const pausa = enviarResposta.indexOf("setTimeout(r, calcularDelayDigitacaoMs(");
    const confere = enviarResposta.indexOf("pegarStatusConversa(conversaId)");
    expect(pausa).toBeGreaterThan(-1);
    expect(confere).toBeGreaterThan(pausa);
  });

  it("fica dentro do `if (i > 0)` — a primeira bolha não reconsulta o banco", () => {
    const bloco = enviarResposta.slice(
      enviarResposta.indexOf("if (i > 0) {"),
      enviarResposta.indexOf("const msgId = await salvarMensagem"),
    );
    expect(bloco).toContain("pegarStatusConversa(conversaId)");
  });

  it("o cancelamento fica registrado no log, com quantas bolhas ficaram de fora", () => {
    expect(enviarResposta).toContain("restantes: partes.length - i");
    expect(enviarResposta).toContain("[ChatBot] Atendente assumiu — bolhas restantes canceladas");
  });

  it("as travas de fora continuam de pé — esta foi somada, não trocada", () => {
    // Antes de cada RESPOSTA (laço de quem chama): a condição, não só o log —
    // `if (false)` com o texto intacto passaria numa busca pelo texto.
    const laco = handler.slice(
      handler.indexOf("for (let i = 0; i < sf.respostas.length; i++)"),
      handler.indexOf("[SmartFlow] Atendente assumiu — cancelando respostas pendentes do bot"),
    );
    expect(laco).toContain("const statusAtual = await pegarStatusConversa(conversaId);");
    expect(laco).toContain('if (statusAtual === "em_atendimento") {');
    expect(handler).toContain("[SmartFlow] Atendente assumiu — cancelando respostas pendentes do bot");
    // Antes de processar a mensagem (dispatcher).
    expect(ler("server/smartflow/dispatcher.ts")).toContain(
      '"SmartFlow: conversa em_atendimento — bot pausado, mensagem ignorada"',
    );
    // Auto-reply fixo do canal.
    expect(handler).toContain("[AutoReply] bot pausado — auto-reply do canal não enviado");
  });

  it("a divisão em bolhas continua existindo (a correção não desligou o recurso)", () => {
    expect(enviarResposta).toContain("dividirMensagemNatural");
    expect(enviarResposta).toContain("ctxConv?.dividir.ativo");
  });
});
