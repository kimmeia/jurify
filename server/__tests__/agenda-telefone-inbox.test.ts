/**
 * Telefone do compromisso → conversa no Inbox.
 *
 * O número na agenda abria o WhatsApp Web numa aba nova; o dono pediu que
 * levasse pro atendimento dentro do sistema, onde está o histórico.
 *
 * O que estes testes travam:
 *  1. A comparação de telefone. O mesmo número aparece digitado de três jeitos
 *     (agenda sem o nono dígito, WhatsApp com código do país, ficha com
 *     máscara). Errar aqui abre "nova conversa" pra quem já tem conversa —
 *     ou pior, joga o atendente na conversa de outra pessoa.
 *  2. As duas rotas. Com cliente vinculado usa a que já existia; sem ele, a
 *     nova por telefone. Foi rota fechada por dedução que derrubou o link de
 *     assinatura em agosto, então aqui elas ficam amarradas.
 *  3. O WhatsApp Web não foi removido — mudou de lugar.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { chaveTelefoneBR, mesmoTelefone } from "../../shared/telefone";

function ler(rel: string) {
  return fs.readFileSync(path.resolve(__dirname, "../../", rel), "utf-8");
}

describe("comparação de telefone entre fontes que digitam diferente", () => {
  it("o caso real: agenda sem o nono dígito × contato com código do país", () => {
    // "8597965706" foi o que apareceu no compromisso do print de 01/09.
    expect(mesmoTelefone("8597965706", "5585997965706")).toBe(true);
  });

  it("máscara da ficha casa com dígitos crus", () => {
    expect(mesmoTelefone("(85) 99796-5706", "8597965706")).toBe(true);
    expect(mesmoTelefone("+55 85 99796-5706", "85997965706")).toBe(true);
  });

  it("números diferentes NÃO casam", () => {
    expect(mesmoTelefone("8597965706", "8597965707")).toBe(false);
    // Mesmo número, DDD diferente: é outra pessoa.
    expect(mesmoTelefone("8597965706", "1197965706")).toBe(false);
  });

  it("55 no começo é código do país só quando sobra número nacional", () => {
    // DDD 55 é Santa Maria (RS). Cortar cegamente transformaria o gaúcho
    // em outro número.
    expect(chaveTelefoneBR("5599796570")).toBe("5599796570");
    expect(chaveTelefoneBR("5585997965706")).toBe("8597965706");
  });

  it("o nono dígito só é descartado quando é mesmo um 9", () => {
    expect(chaveTelefoneBR("85897965706")).toBeNull();
  });

  it("o que não dá pra reconhecer devolve null em vez de chutar", () => {
    expect(chaveTelefoneBR("97965706")).toBeNull();  // sem DDD
    expect(chaveTelefoneBR("123")).toBeNull();
    expect(chaveTelefoneBR("")).toBeNull();
    expect(chaveTelefoneBR(null)).toBeNull();
  });

  it("vazio nunca casa com vazio", () => {
    expect(mesmoTelefone("", "")).toBe(false);
    expect(mesmoTelefone(null, undefined)).toBe(false);
    expect(mesmoTelefone("   ", "")).toBe(false);
  });

  it("sem formato reconhecível dos dois lados, só igualdade literal", () => {
    expect(mesmoTelefone("97965706", "97965706")).toBe(true);
    expect(mesmoTelefone("97965706", "97965707")).toBe(false);
  });
});

describe("as duas rotas do clique no telefone", () => {
  const agenda = ler("client/src/pages/Agenda.tsx");
  const atendimento = ler("client/src/pages/Atendimento.tsx");

  it("com cliente vinculado usa a rota que já existia", () => {
    const bloco = agenda.slice(agenda.indexOf("export function caminhoConversaDoEvento"));
    expect(bloco).toMatch(/if \(ev\.contatoId\) return `\/atendimento\?contatoId=\$\{ev\.contatoId\}`/);
  });

  it("sem cliente vinculado, cai na rota por telefone", () => {
    const bloco = agenda.slice(agenda.indexOf("export function caminhoConversaDoEvento"));
    expect(bloco).toMatch(/return `\/atendimento\?telefone=\$\{tel\}`/);
  });

  it("sem número nenhum não navega pra lugar nenhum", () => {
    const bloco = agenda.slice(agenda.indexOf("export function caminhoConversaDoEvento"));
    expect(bloco).toMatch(/if \(!tel\) return null/);
    expect(agenda).toMatch(/if \(destino\) window\.location\.assign\(destino\)/);
  });

  it("o Atendimento realmente lê o parâmetro novo", () => {
    // A rota só existe de verdade quando as duas pontas concordam. Foi
    // exatamente a ponta que ninguém conferiu que quebrou a assinatura pública.
    expect(atendimento).toMatch(/p\.get\("telefone"\)/);
    expect(atendimento).toMatch(/mesmoTelefone\(c\.contatoTelefone, telefoneUrl\)/);
  });

  it("sem conversa com aquele número, abre o diálogo preenchido", () => {
    const bloco = atendimento.slice(
      atendimento.indexOf("if (contatoUrlConsumido || !telefoneUrl"),
    );
    const corpo = bloco.slice(0, bloco.indexOf("}, [telefoneUrl"));
    expect(corpo).toMatch(/setPreencherConversa\(\{ telefone: telefoneUrl \}\)/);
    expect(corpo).toMatch(/setShowIniciar\(true\)/);
  });

  it("o parâmetro é consumido uma vez só", () => {
    const bloco = atendimento.slice(
      atendimento.indexOf("if (contatoUrlConsumido || !telefoneUrl"),
    );
    const corpo = bloco.slice(0, bloco.indexOf("}, [telefoneUrl"));
    // Sem isso, o diálogo reabriria a cada re-render da lista de conversas.
    expect(corpo).toMatch(/setContatoUrlConsumido\(true\)/);
    expect(corpo).toMatch(/searchParams\.delete\("telefone"\)/);
  });
});

describe("o WhatsApp Web não foi removido", () => {
  const agenda = ler("client/src/pages/Agenda.tsx");

  it("continua nas duas telas que mostram o telefone", () => {
    // Regra do dono: nada sai sem autorização expressa. O atalho mudou de
    // lugar (virou ícone ao lado), não desapareceu. O link é montado por
    // `telefoneParaWaMe` — o `wa.me/55` fixo prefixava 55 em número que já
    // vinha com o 55 do WhatsApp (wa.me/555585…).
    const links = agenda.match(/href=\{telefoneParaWaMe\(String\(/g) ?? [];
    expect(links.length).toBe(2);
  });

  it("o número em si passou a abrir o atendimento", () => {
    const chamadas = agenda.match(/irParaConversa\(/g) ?? [];
    // Uma definição + os dois lugares que renderizam o telefone.
    expect(chamadas.length).toBeGreaterThanOrEqual(3);
  });
});
