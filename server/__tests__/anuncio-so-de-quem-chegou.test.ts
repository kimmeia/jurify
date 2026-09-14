/**
 * Origem de anúncio só de quem CHEGOU pelo anúncio.
 *
 * O que motivou, medido em produção em 14/09: o dono digitou uma mensagem à
 * mão, de um número que já conversava com o escritório, e ela apareceu como
 * vinda de anúncio. Não era invenção nossa — o `source_url` do criativo veio
 * junto, e nós não fabricamos URL. A Meta anexa o bloco `referral` também a
 * mensagens de quem já tinha conversa aberta por uma thread que um dia veio
 * de campanha, inclusive meses depois.
 *
 * Havia um segundo caminho, esse do nosso lado: quando a ficha magra do
 * WhatsApp é absorvida por um cadastro que já existia ("cadastro reconhecido"),
 * o `contatoId` troca DEPOIS de o sinal de "contato novo" ser definido — e o
 * cliente antigo era carimbado como lead recém-chegado.
 *
 * A regra: grava só quando o contato nasce daquela mensagem. Perde-se o
 * re-clique real de cliente antigo; não se afirma o que não aconteceu. Entre
 * as duas, a segunda é a que estraga relatório e decisão de verba.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { registrarOrigemAnuncioSeAusente } from "../integracoes/whatsapp-origem-anuncio";

const raiz = join(__dirname, "..", "..");
const handler = readFileSync(join(raiz, "server", "integracoes", "whatsapp-handler.ts"), "utf8");
const migration = readFileSync(
  join(raiz, "drizzle", "0233_origem_anuncio_so_de_quem_chegou.sql"), "utf8");

const REFERRAL = {
  sourceId: "120210000000000111",
  sourceType: "ad",
  sourceUrl: "https://fb.me/abc",
  titulo: "Seu imóvel foi a leilão?",
  corpo: "Conheça seus direitos.",
  midiaTipo: "video",
  imagemUrl: "", videoUrl: "", thumbnailUrl: "", ctwaClid: "ARabc",
};

/** Banco falso que registra os UPDATE tentados. */
function fakeDb(origemAtual: string | null) {
  const updates: any[] = [];
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: async () => [{ atual: origemAtual }],
    update: () => chain,
    set: (v: any) => { updates.push(v); return chain; },
  };
  // `.where()` do update precisa resolver; no select ele é encadeado.
  chain.where = () => ({ ...chain, then: (r: any) => r(undefined) });
  return { db: chain, updates };
}

describe("quem é carimbado", () => {
  it("contato NOVO: grava a origem", async () => {
    const { db, updates } = fakeDb(null);
    await registrarOrigemAnuncioSeAusente(db, 1, REFERRAL as any, 1_700_000_000_000, true);
    expect(updates).toHaveLength(1);
    expect(updates[0].origemAnuncio).toContain("120210000000000111");
  });

  it("contato que JÁ EXISTIA: não grava, mesmo com referral legítimo da Meta", async () => {
    const { db, updates } = fakeDb(null);
    await registrarOrigemAnuncioSeAusente(db, 1, REFERRAL as any, 1_700_000_000_000, false);
    expect(updates).toHaveLength(0);
  });

  it("caller antigo (sem o sinal) continua gravando — nada quebra em silêncio", async () => {
    // `undefined` não é "não é novo": só `false` barra. Um caller que ainda não
    // passa o sinal precisa se comportar como antes, não parar de registrar.
    const { db, updates } = fakeDb(null);
    await registrarOrigemAnuncioSeAusente(db, 1, REFERRAL as any, 1_700_000_000_000);
    expect(updates).toHaveLength(1);
  });

  it("first-touch continua valendo: contato que já tem origem não é sobrescrito", async () => {
    const { db, updates } = fakeDb(JSON.stringify({ sourceId: "outro" }));
    await registrarOrigemAnuncioSeAusente(db, 1, REFERRAL as any, 1_700_000_000_000, true);
    expect(updates).toHaveLength(0);
  });

  it("falha de banco não derruba o atendimento, mas fica registrada", async () => {
    const quebrado: any = {
      select: () => quebrado, from: () => quebrado, where: () => quebrado,
      limit: async () => { throw new Error("Unknown column 'origemAnuncio'"); },
    };
    await expect(
      registrarOrigemAnuncioSeAusente(quebrado, 1, REFERRAL as any, 1, true),
    ).resolves.toBeUndefined();
  });
});

describe("o handler sabe quando o contato deixou de ser novo", () => {
  it("a unificação com cadastro existente derruba o sinal de contato novo", () => {
    // Sem isto, a ficha magra criada agora e absorvida por um cliente de meses
    // atrás continuaria valendo como "lead novo" — é exatamente o caso que o
    // dono viu, com o selo "cadastro reconhecido" na conversa.
    const i = handler.indexOf("if (rec.contatoId && rec.contatoId !== contatoId)");
    expect(i).toBeGreaterThan(0);
    const bloco = handler.slice(i, i + 600);
    expect(bloco).toContain("contatoFoiCriado = false");
  });

  it("o sinal chega na gravação da origem", () => {
    expect(handler).toMatch(
      /registrarOrigemAnuncioSeAusente\(db, contatoId, msg\.referral, msg\.timestamp \* 1000, contatoFoiCriado\)/,
    );
  });

  it("a unificação roda ANTES da gravação — senão o sinal chega tarde", () => {
    const iUnificacao = handler.indexOf("reconhecerCadastroNaEntrada");
    const iOrigem = handler.indexOf("registrarOrigemAnuncioSeAusente");
    expect(iUnificacao).toBeGreaterThan(0);
    expect(iOrigem).toBeGreaterThan(iUnificacao);
  });
});

describe("limpeza do que foi carimbado errado", () => {
  it("apaga SÓ as duas colunas da origem", () => {
    expect(migration).toMatch(/UPDATE contatos/);
    expect(migration).toContain("origemAnuncio = NULL");
    expect(migration).toContain("origemAnuncioEm = NULL");
    // Nenhum DELETE, nenhuma outra tabela: o histórico não se toca.
    expect(migration).not.toMatch(/\bDELETE\b/i);
    expect(migration).not.toMatch(/\bDROP\b/i);
  });

  it("o critério é a data — origem gravada depois da criação do contato", () => {
    expect(migration).toMatch(/origemAnuncioEm\s*>\s*createdAtContato \+ INTERVAL 5 MINUTE/);
  });

  it("não toca em contato sem origem", () => {
    expect(migration).toContain("origemAnuncio IS NOT NULL");
    expect(migration).toContain("origemAnuncioEm IS NOT NULL");
  });
});
