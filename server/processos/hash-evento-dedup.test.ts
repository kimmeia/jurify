/**
 * Regressão do fix #3 — hashEvento normalizado + migração preguiçosa.
 *
 * Antes, a versão de hashEvento do cron NÃO normalizava (só `join("|")` +
 * sha256). A mesma movimentação re-renderizada pelo PJe com diferença
 * cosmética nos 200 primeiros chars (espaço duplo, acento, maiúscula) gerava
 * hash diferente → entrava como "nova" (movimentação + notificação
 * duplicada). Agora `hashEvento` delega pra versão normalizada de
 * parser-utils, e `resolverDedupMovimentacao` migra preguiçosamente os
 * eventos gravados sob o hash legado pra não floodar após o deploy.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

// cron-monitoramento importa CUSTOS do router + adapters + cofre + sse no
// load. Mockamos pra carregar o módulo isolado (mesmo padrão do cron test).
vi.mock("../routers/processos", () => ({
  CUSTOS: { monitorar_pessoa_mes: 15, monitorar_processo_mes: 2, consulta_cnj: 1 },
}));
vi.mock("./adapters/pje-tjce", () => ({
  consultarTjce: vi.fn(),
  consultarTjcePorCpf: vi.fn(),
}));
vi.mock("../escritorio/cofre-helpers", () => ({ recuperarSessao: vi.fn() }));
vi.mock("../_core/sse-notifications", () => ({ emitirNotificacao: vi.fn() }));
vi.mock("../db", () => ({ getDb: vi.fn(async () => null) }));

const { hashEvento, resolverDedupMovimentacao } = await import("./cron-monitoramento");
const { hashEvento: hashEventoNorm } = await import(
  "../../scripts/spike-motor-proprio/lib/parser-utils"
);

/** Hash legado (sem normalização) — como o cron computava antes do fix. */
function hashLegado(componentes: string[]): string {
  return crypto.createHash("sha256").update(componentes.join("|")).digest("hex");
}

const CNJ = "0001234-56.2024.8.06.0001";
const DATA = "2026-05-07T14:23:00";

describe("hashEvento — normalização (fix FP de re-render)", () => {
  it("colapsa variações cosméticas (acento/caixa/espaço duplo) no MESMO hash", () => {
    const original = hashEvento(["movimentacao", CNJ, DATA, "Decisão  Proferida"]);
    const reRender = hashEvento(["movimentacao", CNJ, DATA, "decisao proferida"]);
    expect(reRender).toBe(original);
  });

  it("difere quando o conteúdo semântico difere de verdade", () => {
    const a = hashEvento(["movimentacao", CNJ, DATA, "Despacho"]);
    const b = hashEvento(["movimentacao", CNJ, DATA, "Sentença"]);
    expect(a).not.toBe(b);
  });

  it("delega para a versão normalizada de parser-utils", () => {
    const comps = ["movimentacao", CNJ, DATA, "Á É Í intimação"];
    expect(hashEvento(comps)).toBe(hashEventoNorm(comps));
  });

  it("é IDÊNTICO ao hash legado para nova_acao (sem texto livre a normalizar)", () => {
    // ["nova_acao", monId, cnj] não tem acento/caixa/espaço → migração
    // não muda nada. Garante que a dedup de novas ações não regrediu.
    const comps = ["nova_acao", "42", CNJ];
    expect(hashEvento(comps)).toBe(hashLegado(comps));
  });
});

describe("resolverDedupMovimentacao — migração preguiçosa do hash legado", () => {
  let updates: Array<Record<string, unknown>>;
  let selectResult: unknown[];

  function makeDb() {
    const selBuilder: any = {
      from: () => selBuilder,
      where: () => selBuilder,
      limit: async () => selectResult,
    };
    return {
      select: () => selBuilder,
      update: () => ({
        set: (set: Record<string, unknown>) => ({
          where: () => {
            updates.push(set);
            return Promise.resolve([{ affectedRows: 1 }]);
          },
        }),
      }),
    } as any;
  }

  beforeEach(() => {
    updates = [];
    selectResult = [];
  });

  it("sem registro legado → jaConhecida=false e nenhum UPDATE", async () => {
    const db = makeDb();
    selectResult = []; // nada gravado sob o hash legado
    const r = await resolverDedupMovimentacao(db, 1, CNJ, DATA, "Decisão Proferida");
    expect(r.jaConhecida).toBe(false);
    expect(r.dedup).toBe(hashEvento(["movimentacao", CNJ, DATA, "Decisão Proferida"]));
    expect(updates).toHaveLength(0);
  });

  it("com registro legado → migra (UPDATE pro hash novo) e retorna jaConhecida=true", async () => {
    const db = makeDb();
    selectResult = [{ id: 99 }]; // existe um evento sob o hash legado
    const r = await resolverDedupMovimentacao(db, 1, CNJ, DATA, "Decisão Proferida");
    expect(r.jaConhecida).toBe(true);
    expect(updates).toHaveLength(1);
    // Migra o registro antigo pro hash normalizado (idempotência futura).
    expect(updates[0].hashDedup).toBe(r.dedup);
  });

  it("texto sem nada a normalizar (legado == novo) → não consulta nem migra", async () => {
    const db = makeDb();
    selectResult = [{ id: 1 }]; // mesmo que houvesse, não deve ser usado
    // Tudo minúsculo, sem acento, sem espaço extra, sem 'T' de ISO →
    // hashLegado === hashNovo, então o atalho evita o SELECT/UPDATE.
    const r = await resolverDedupMovimentacao(db, 1, "x", "d", "despacho");
    expect(r.jaConhecida).toBe(false);
    expect(updates).toHaveLength(0);
  });
});
