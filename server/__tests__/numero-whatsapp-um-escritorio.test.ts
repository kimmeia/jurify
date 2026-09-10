/**
 * O mesmo número de WhatsApp não fica no ar em dois escritórios.
 *
 * O webhook da Meta chega sem inquilino: quem decide o destino da conversa é
 * o `phoneNumberId`. A checagem de duplicidade existia, mas só DENTRO do
 * escritório ("já tenho este número?") — o que dedupla reconexão e não
 * impede o número de entrar em dois lugares.
 *
 * Com duas linhas conectadas, `findCanalByPhoneNumberId` devolvia a
 * primeira que o scan encontrasse (na prática a de menor id), sem olhar
 * status. A banca vítima não teria como perceber: a mensagem do cliente
 * dela simplesmente chega na caixa de entrada de outra.
 *
 * Duas travas, e as duas precisam existir: recusar na CONEXÃO (os três
 * caminhos que criam canal WhatsApp) e recusar a ADIVINHAR no roteamento.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const raiz = (...p: string[]) => join(__dirname, "..", ...p);

const CAMINHOS_DE_CONEXAO = [
  ["Embedded Signup", raiz("routers", "meta-channels.ts")],
  ["pareamento CoEx", raiz("routers", "whatsapp-coex.ts")],
  ["conexão manual", raiz("escritorio", "db-canais.ts")],
] as const;

describe("conexão recusa número já no ar em outro escritório", () => {
  for (const [nome, arquivo] of CAMINHOS_DE_CONEXAO) {
    it(`${nome} consulta o portão antes de inserir`, () => {
      const fonte = readFileSync(arquivo, "utf8");
      expect(
        fonte,
        "sem o portão, o número entra em dois escritórios e o webhook fica sem destino certo",
      ).toContain("canalConectadoEmOutroEscritorio");

      const portao = fonte.indexOf("canalConectadoEmOutroEscritorio");
      const insere = fonte.indexOf("insert(canaisIntegrados)");
      expect(insere).toBeGreaterThan(0);
      expect(portao, "conferir depois de inserir não impede nada").toBeLessThan(insere);
    });
  }

  it("o portão só barra canal CONECTADO de outro escritório", () => {
    const fonte = readFileSync(raiz("integracoes", "numero-whatsapp-unico.ts"), "utf8");
    // Número abandonado em outra conta (desconectado/erro/banido) precisa
    // liberar: é a migração de quem trocou de sistema, e barrar travaria
    // cliente novo na porta.
    expect(fonte).toContain('eq(canaisIntegrados.status, "conectado")');
    expect(fonte).toContain("ne(canaisIntegrados.escritorioId, escritorioId)");
  });
});

describe("roteamento não adivinha entre escritórios", () => {
  const FONTE = readFileSync(raiz("integracoes", "whatsapp-cloud-webhook.ts"), "utf8");
  const TRECHO = FONTE.slice(
    FONTE.indexOf("async function findCanalByPhoneNumberId"),
    FONTE.indexOf("async function findCanaisByWabaId"),
  );

  it("junta todos os candidatos em vez de devolver o primeiro", () => {
    expect(TRECHO).toContain("candidatos");
    expect(
      TRECHO.includes("candidatos.length === 0") && TRECHO.includes("candidatos.length === 1"),
      "devolver o primeiro que casa entrega a conversa ao escritório de menor id",
    ).toBe(true);
  });

  it("empate entre dois conectados não é roteado, e alerta", () => {
    expect(TRECHO).toContain('c.status === "conectado"');
    expect(
      TRECHO,
      "entregar conversa à banca errada não se desfaz — na dúvida, não entrega",
    ).toContain("whatsapp-numero-ambiguo");
    const alerta = TRECHO.indexOf("whatsapp-numero-ambiguo");
    const devolve = TRECHO.indexOf("return null;", alerta);
    expect(devolve, "o alerta precisa vir antes de desistir do roteamento").toBeGreaterThan(alerta);
  });
});
