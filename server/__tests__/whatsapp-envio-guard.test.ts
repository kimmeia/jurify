import { describe, it, expect, beforeEach } from "vitest";
import {
  detectarRestricaoMeta,
  verificarRateLimit,
  registrarDisparoRate,
  podeDispararTemplate,
  registrarFalhaTemplate,
  registrarSucessoTemplate,
  _resetRateLimit,
} from "../integracoes/whatsapp-envio-guard";

/**
 * Fake db mínimo: responde `select()` na ordem da fila (cada função do guard
 * faz 1 select por consulta) e captura os `set()` de `update()`. Ignora os
 * argumentos de tabela/where — só o formato das linhas importa aqui.
 */
function fakeDb(opts: { selectQueue?: any[][]; onUpdate?: (values: any) => void } = {}) {
  const queue = [...(opts.selectQueue ?? [])];
  function makeChain() {
    const rows = queue.length ? queue.shift()! : [];
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(rows),
    };
    return chain;
  }
  return {
    select: () => makeChain(),
    update: () => ({
      set: (values: any) => ({
        where: () => {
          opts.onUpdate?.(values);
          return Promise.resolve();
        },
      }),
    }),
  } as any;
}

describe("detectarRestricaoMeta", () => {
  it("detecta 131031 (conta bloqueada) — o erro do incidente", () => {
    const r = detectarRestricaoMeta("131031: Business account has been locked");
    expect(r).not.toBeNull();
    expect(r!.codigo).toBe(131031);
  });

  it("detecta 368 e 131048 (política / spam rate)", () => {
    expect(detectarRestricaoMeta("368: Temporarily blocked for policies violations")?.codigo).toBe(368);
    expect(detectarRestricaoMeta("131048: Spam rate limit hit")?.codigo).toBe(131048);
  });

  it("detecta por TEXTO mesmo sem código reconhecido", () => {
    expect(detectarRestricaoMeta("Business account has been locked")).not.toBeNull();
    expect(detectarRestricaoMeta("Sending spam")).not.toBeNull();
  });

  it("NÃO tripa em erros que não são restrição de conta", () => {
    expect(detectarRestricaoMeta("131026: Message undeliverable")).toBeNull();
    expect(detectarRestricaoMeta("131047: Re-engagement message")).toBeNull();
    expect(detectarRestricaoMeta("131049: healthy ecosystem")).toBeNull();
    expect(detectarRestricaoMeta("Telefone inválido")).toBeNull();
    expect(detectarRestricaoMeta(null)).toBeNull();
    expect(detectarRestricaoMeta("")).toBeNull();
  });
});

describe("rate limit (janela deslizante)", () => {
  beforeEach(() => _resetRateLimit());

  it("libera até o teto por minuto e bloqueia o excedente", () => {
    const t = 1_000_000;
    for (let i = 0; i < 10; i++) {
      expect(verificarRateLimit(1, t).ok).toBe(true);
      registrarDisparoRate(1, t);
    }
    expect(verificarRateLimit(1, t).ok).toBe(false); // 11º no mesmo minuto
  });

  it("a janela desliza: passado 1 minuto, libera de novo", () => {
    const t = 2_000_000;
    for (let i = 0; i < 10; i++) registrarDisparoRate(1, t);
    expect(verificarRateLimit(1, t).ok).toBe(false);
    expect(verificarRateLimit(1, t + 61_000).ok).toBe(true);
  });

  it("é isolado por canal", () => {
    const t = 3_000_000;
    for (let i = 0; i < 10; i++) registrarDisparoRate(1, t);
    expect(verificarRateLimit(1, t).ok).toBe(false);
    expect(verificarRateLimit(2, t).ok).toBe(true);
  });
});

describe("podeDispararTemplate", () => {
  beforeEach(() => _resetRateLimit());

  it("bloqueia quando o canal está restrito (disjuntor)", async () => {
    const db = fakeDb({ selectQueue: [[{ restrito: true, motivo: "131031: locked" }]] });
    const r = await podeDispararTemplate({ db, canalId: 1, agoraMs: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.tipo).toBe("restrito");
  });

  it("bloqueia quando estoura o rate limit", async () => {
    for (let i = 0; i < 10; i++) registrarDisparoRate(7, 1000);
    const db = fakeDb({ selectQueue: [[{ restrito: false }]] });
    const r = await podeDispararTemplate({ db, canalId: 7, agoraMs: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.tipo).toBe("rate");
  });

  it("bloqueia template automático pra estranho (sem inbound E sem cobrança)", async () => {
    // canal ok → inbound vazio → asaas vazio → sem consentimento
    const db = fakeDb({ selectQueue: [[{ restrito: false }], [], []] });
    const r = await podeDispararTemplate({ db, canalId: 3, contatoId: 5, exigirOptin: true, agoraMs: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.tipo).toBe("optin");
  });

  it("libera por opt-in user-initiated (contato já escreveu)", async () => {
    // canal ok → inbound encontrado (não chega a consultar asaas)
    const db = fakeDb({ selectQueue: [[{ restrito: false }], [{ id: 1 }]] });
    const r = await podeDispararTemplate({ db, canalId: 3, contatoId: 5, exigirOptin: true, agoraMs: 1000 });
    expect(r.ok).toBe(true);
  });

  it("libera template UTILITY por relação transacional (cliente Asaas) mesmo sem inbound", async () => {
    // canal ok → inbound vazio → é cliente com cobrança Asaas → consentimento
    const db = fakeDb({ selectQueue: [[{ restrito: false }], [], [{ id: 99 }]] });
    const r = await podeDispararTemplate({ db, canalId: 3, contatoId: 5, exigirOptin: true, agoraMs: 1000 });
    expect(r.ok).toBe(true);
  });

  it("não exige opt-in quando exigirOptin é falso (envio manual)", async () => {
    const db = fakeDb({ selectQueue: [[{ restrito: false }]] });
    const r = await podeDispararTemplate({ db, canalId: 3, contatoId: 5, agoraMs: 1000 });
    expect(r.ok).toBe(true);
  });
});

describe("registrarFalhaTemplate (tripa o disjuntor)", () => {
  it("marca o canal como restrito quando o erro é de restrição", async () => {
    let captured: any = null;
    const db = fakeDb({ onUpdate: (v) => (captured = v) });
    const tripou = await registrarFalhaTemplate({ db, canalId: 1, erro: "131031: Business account has been locked" });
    expect(tripou).toBe(true);
    expect(captured.restritoMeta).toBe(true);
    expect(captured.restritoMotivo).toContain("131031");
  });

  it("NÃO tripa em erro comum de entrega", async () => {
    let called = false;
    const db = fakeDb({ onUpdate: () => (called = true) });
    const tripou = await registrarFalhaTemplate({ db, canalId: 1, erro: "131026: Message undeliverable" });
    expect(tripou).toBe(false);
    expect(called).toBe(false);
  });

  it("no-op sem canalId", async () => {
    const db = fakeDb();
    expect(await registrarFalhaTemplate({ db, canalId: undefined, erro: "131031: locked" })).toBe(false);
  });
});

describe("registrarSucessoTemplate (rearma o disjuntor)", () => {
  beforeEach(() => _resetRateLimit());

  it("registra o disparo e limpa a restrição do canal", async () => {
    let captured: any = null;
    const db = fakeDb({ onUpdate: (v) => (captured = v) });
    await registrarSucessoTemplate({ db, canalId: 9, agoraMs: 5000 });
    expect(captured.restritoMeta).toBe(false);
    // disparo entrou no rate limit
    expect(verificarRateLimit(9, 5000)).toBeTruthy();
  });
});
