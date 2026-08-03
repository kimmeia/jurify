/**
 * Testes — busca de conversas do Inbox acontece no BANCO.
 *
 * Bug protegido: o Inbox carregava as N conversas mais recentes
 * (`ORDER BY ultimaMensagemAt DESC LIMIT 300`) e filtrava o texto digitado
 * em memória, no navegador. Conversa fora desse corte de recência era
 * invisível pra busca — exatamente as antigas, e piorando conforme chegavam
 * conversas novas. Buscar o número do cliente simplesmente não achava nada.
 *
 * Contrato agora:
 *  - `busca` vira condição SQL (nome + telefone do contato)
 *  - com `busca`, arquivadas ENTRAM no resultado (a conversa antiga costuma
 *    estar arquivada; a UI marca com badge)
 *  - sem `busca`, nada muda: vistas padrão seguem excluindo arquivadas
 *  - telefone casa por variantes BR e por telefone secundário/anterior
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let capturedWhere: unknown[] = [];

function makeSelectBuilder() {
  const b: any = {
    from: () => b,
    innerJoin: () => b,
    where: (w: unknown) => {
      capturedWhere.push(w);
      return b;
    },
    groupBy: () => b,
    orderBy: () => b,
    limit: () => Promise.resolve([]),
    then: (r: (v: unknown) => unknown) => r([]),
  };
  return b;
}

const mockDb = { select: () => ({ from: () => makeSelectBuilder() }) };
vi.mock("../db", () => ({ getDb: async () => mockDb }));

const { listarConversas } = await import("../escritorio/db-crm");

/** Achata a árvore do objeto SQL do drizzle em texto pesquisável. */
function achatar(node: any, out: string[] = [], seen = new Set<any>()): string[] {
  if (node == null) return out;
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  if (typeof node === "number" || typeof node === "boolean") {
    out.push(String(node));
    return out;
  }
  if (typeof node !== "object") return out;
  if (seen.has(node)) return out;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const n of node) achatar(n, out, seen);
    return out;
  }
  if (typeof node.name === "string") out.push(node.name);
  for (const chave of ["queryChunks", "value", "left", "right", "conditions"]) {
    if (chave in node) achatar(node[chave], out, seen);
  }
  return out;
}

const whereTexto = () => achatar(capturedWhere).join(" ").toLowerCase();

beforeEach(() => {
  capturedWhere = [];
});

describe("listarConversas — busca vai pro banco", () => {
  it("sem busca: mantém o filtro de arquivadas (vista padrão inalterada)", async () => {
    await listarConversas(1, {});
    expect(whereTexto()).toContain("is null");
    expect(whereTexto()).toContain("arquivadaemconv");
  });

  it("com busca por nome: gera condição SQL no nome do contato", async () => {
    await listarConversas(1, { busca: "Castelina" });
    const t = whereTexto();
    expect(t).toContain("nome");
    expect(t).toContain("%castelina%");
  });

  it("com busca: arquivadas ENTRAM (não filtra arquivada_em is null)", async () => {
    await listarConversas(1, { busca: "8599998888" });
    expect(whereTexto()).not.toContain("arquivadaemconv");
  });

  it("pasta Arquivadas + busca: continua só arquivadas", async () => {
    await listarConversas(1, { arquivadas: true, busca: "8599998888" });
    expect(whereTexto()).toContain("arquivadaemconv");
    expect(whereTexto()).toContain("is not null");
  });

  it("busca por telefone cobre secundário e anterior (número trocado)", async () => {
    await listarConversas(1, { busca: "85999998888" });
    const t = whereTexto();
    expect(t).toContain("telefonessecundarios");
    expect(t).toContain("telefonesanteriores");
  });

  it("busca por telefone gera variantes BR (com/sem o 9 antecipado)", async () => {
    await listarConversas(1, { busca: "5585999998888" });
    const t = whereTexto();
    // A variante sem o "9" precisa estar entre os padrões procurados.
    expect(t).toContain("%558599998888%");
  });

  it("termo com máscara é normalizado pra dígitos", async () => {
    await listarConversas(1, { busca: "(85) 99999-8888" });
    expect(whereTexto()).toContain("%85999998888%");
  });

  it("busca só de espaços é ignorada (não vira condição nem solta arquivadas)", async () => {
    await listarConversas(1, { busca: "   " });
    expect(whereTexto()).toContain("arquivadaemconv");
  });
});
