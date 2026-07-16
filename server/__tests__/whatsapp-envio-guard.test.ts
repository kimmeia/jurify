import { describe, it, expect, beforeEach } from "vitest";
import {
  detectarRestricaoMeta,
  verificarRateLimit,
  registrarDisparoRate,
  podeDispararTemplate,
  podeEnviar,
  registrarFalhaTemplate,
  registrarSucessoTemplate,
  registrarSucessoEnvio,
  limiteDiarioPorTier,
  verificarLimiteDiario,
  bucketDia,
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
    // canal ok → sem opt-out → inbound vazio → asaas vazio → sem consentimento
    const db = fakeDb({ selectQueue: [[{ restrito: false }], [{ optOut: false }], [], []] });
    const r = await podeDispararTemplate({ db, canalId: 3, contatoId: 5, exigirOptin: true, agoraMs: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.tipo).toBe("optin");
  });

  it("libera por opt-in user-initiated (contato já escreveu)", async () => {
    // canal ok → sem opt-out → inbound encontrado (não consulta asaas)
    const db = fakeDb({ selectQueue: [[{ restrito: false }], [{ optOut: false }], [{ id: 1 }]] });
    const r = await podeDispararTemplate({ db, canalId: 3, contatoId: 5, exigirOptin: true, agoraMs: 1000 });
    expect(r.ok).toBe(true);
  });

  it("libera template UTILITY por relação transacional (cliente Asaas) mesmo sem inbound", async () => {
    // canal ok → sem opt-out → inbound vazio → cliente Asaas → consentimento
    const db = fakeDb({ selectQueue: [[{ restrito: false }], [{ optOut: false }], [], [{ id: 99 }]] });
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

describe("teto diário por tier (anti-ban)", () => {
  it("mapeia o messaging tier da Meta no teto por 24h", () => {
    expect(limiteDiarioPorTier("TIER_250")).toBe(250);
    expect(limiteDiarioPorTier("TIER_1K")).toBe(1_000);
    expect(limiteDiarioPorTier("TIER_10K")).toBe(10_000);
    expect(limiteDiarioPorTier("TIER_UNLIMITED")).toBe(Number.POSITIVE_INFINITY);
    // Sem tier conhecido = número novo/não sincronizado: assume o teto real
    // de número não verificado (250), não 1K — regressão do 2º ban.
    expect(limiteDiarioPorTier(null)).toBe(250);
    expect(limiteDiarioPorTier("xpto")).toBe(250);
  });

  it("bloqueia quando o contador do dia atinge o teto do tier", () => {
    const t = Date.parse("2026-07-14T10:00:00Z");
    const hoje = bucketDia(t);
    expect(verificarLimiteDiario({ disparosDia: 250, disparosDiaEm: hoje, tier: "TIER_250" }, t).ok).toBe(false);
    expect(verificarLimiteDiario({ disparosDia: 249, disparosDiaEm: hoje, tier: "TIER_250" }, t).ok).toBe(true);
  });

  it("zera na virada do dia (bucket diferente conta como 0)", () => {
    const t = Date.parse("2026-07-14T10:00:00Z");
    // contador cheio, mas de ONTEM → hoje começa do zero
    expect(verificarLimiteDiario({ disparosDia: 999, disparosDiaEm: "2026-07-13", tier: "TIER_250" }, t).ok).toBe(true);
  });

  it("tier ilimitado nunca bloqueia por volume", () => {
    const t = Date.parse("2026-07-14T10:00:00Z");
    expect(verificarLimiteDiario({ disparosDia: 999_999, disparosDiaEm: bucketDia(t), tier: "TIER_UNLIMITED" }, t).ok).toBe(true);
  });
});

describe("podeEnviar — proativo vs. resposta", () => {
  beforeEach(() => _resetRateLimit());

  it("proativo é bloqueado ao estourar o teto diário", async () => {
    const t = Date.parse("2026-07-14T10:00:00Z");
    const db = fakeDb({ selectQueue: [[{ restrito: false, disparosDia: 250, disparosDiaEm: bucketDia(t), tier: "TIER_250" }]] });
    const r = await podeEnviar({ db, canalId: 1, proativo: true, agoraMs: t });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.tipo).toBe("diario");
  });

  it("resposta (não-proativo) IGNORA teto de volume, mas respeita o disjuntor", async () => {
    const t = Date.parse("2026-07-14T10:00:00Z");
    // Mesmo com o dia estourado, resposta manual/auto-reply passa (não conta volume).
    const db1 = fakeDb({ selectQueue: [[{ restrito: false, disparosDia: 9999, disparosDiaEm: bucketDia(t), tier: "TIER_250" }]] });
    expect((await podeEnviar({ db: db1, canalId: 1, proativo: false, agoraMs: t })).ok).toBe(true);
    // Mas conta restrita bloqueia TUDO, inclusive resposta.
    const db2 = fakeDb({ selectQueue: [[{ restrito: true, motivo: "131031" }]] });
    const r = await podeEnviar({ db: db2, canalId: 1, proativo: false, agoraMs: t });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.tipo).toBe("restrito");
  });
});

describe("podeEnviar — opt-out do contato", () => {
  beforeEach(() => _resetRateLimit());

  it("bloqueia proativo pra contato que pediu SAIR", async () => {
    // canal ok → contato com optOut=true
    const db = fakeDb({ selectQueue: [[{ restrito: false }], [{ optOut: true }]] });
    const r = await podeEnviar({ db, canalId: 1, contatoId: 5, proativo: true, agoraMs: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.tipo).toBe("optout");
  });

  it("resposta manual (não-proativo) NÃO é afetada pelo opt-out", async () => {
    const db = fakeDb({ selectQueue: [[{ restrito: false }]] });
    const r = await podeEnviar({ db, canalId: 1, contatoId: 5, proativo: false, agoraMs: 1000 });
    expect(r.ok).toBe(true);
  });

  it("proativo pra contato SEM opt-out segue normal", async () => {
    // canal ok → optOut false → (sem exigirOptin) libera
    const db = fakeDb({ selectQueue: [[{ restrito: false }], [{ optOut: false }]] });
    const r = await podeEnviar({ db, canalId: 1, contatoId: 5, proativo: true, agoraMs: 1000 });
    expect(r.ok).toBe(true);
  });
});

describe("registrarSucessoEnvio — contagem só no proativo", () => {
  beforeEach(() => _resetRateLimit());

  it("proativo entra no rate limit; resposta não", async () => {
    const db = fakeDb();
    await registrarSucessoEnvio({ db, canalId: 20, proativo: true, agoraMs: 1000 });
    expect(verificarRateLimit(20, 1000).ok).toBe(true); // registrado (ainda sob o teto)
    // 9 restantes no minuto → 10 no total → bloqueia o 11º
    for (let i = 0; i < 9; i++) await registrarSucessoEnvio({ db, canalId: 20, proativo: true, agoraMs: 1000 });
    expect(verificarRateLimit(20, 1000).ok).toBe(false);

    // Resposta não conta no rate limit.
    await registrarSucessoEnvio({ db, canalId: 21, proativo: false, agoraMs: 1000 });
    expect(verificarRateLimit(21, 1000).ok).toBe(true);
  });
});
