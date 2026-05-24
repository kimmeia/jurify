/**
 * Regressão do fix #1 — autenticação do SSE `/api/events`.
 *
 * Antes, a rota lia `userId` da query string SEM autenticar. Como os IDs são
 * sequenciais, qualquer um abria /api/events?userId=N e recebia em tempo real
 * as notificações de outro usuário (mensagens, leads, movimentações de
 * processo) — vazamento entre escritórios / LGPD. Agora o usuário vem do
 * cookie de sessão (sdk.authenticateRequest) e o `userId` da query é ignorado.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const authenticateRequest = vi.fn();
vi.mock("./sdk", () => ({ sdk: { authenticateRequest } }));

const { registrarSSE, emitirNotificacao } = await import("./sse-notifications");

/** Captura o handler registrado em GET /api/events. */
function captureHandler(): (req: any, res: any) => Promise<void> {
  let handler: any;
  registrarSSE({ get: (_p: string, h: any) => { handler = h; } } as any);
  return handler;
}

function makeRes() {
  const res: any = {
    statusCode: 0,
    status: vi.fn(function (c: number) { res.statusCode = c; return res; }),
    json: vi.fn(),
    writeHead: vi.fn(),
    write: vi.fn(),
  };
  return res;
}

function makeReq(cookie?: string) {
  const handlers: Record<string, () => void> = {};
  return {
    headers: cookie ? { cookie } : {},
    query: { userId: "999" }, // tenta forjar OUTRO usuário pela query
    on: (ev: string, cb: () => void) => { handlers[ev] = cb; },
    _close: () => handlers["close"]?.(),
  } as any;
}

beforeEach(() => authenticateRequest.mockReset());

describe("SSE /api/events — autenticação (fix vazamento entre contas)", () => {
  it("sem sessão válida → 401 e NÃO abre o stream", async () => {
    // Sessão ausente/ inválida: authenticateRequest não devolve um usuário.
    // O handler cai no catch (seja por throw, seja por user.id de undefined)
    // e responde 401 sem abrir o stream. Usamos resolve(undefined) em vez de
    // reject pra não criar promise rejeitada que o harness do vitest marca
    // como órfã (falso-positivo) — o caminho do catch é o mesmo.
    authenticateRequest.mockReturnValue(Promise.resolve(undefined));

    const handler = captureHandler();
    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.writeHead).not.toHaveBeenCalled(); // stream não foi aberto
  });

  it("autenticado → abre stream e o `userId` da query é IGNORADO", async () => {
    // Sessão (cookie) resolve pro usuário 42. A query pede userId=999.
    authenticateRequest.mockReturnValue(Promise.resolve({ id: 42 }));
    const handler = captureHandler();
    const req = makeReq("session=abc");
    const res = makeRes();
    await handler(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ "Content-Type": "text/event-stream" }),
    );
    const writesAposConectar = res.write.mock.calls.length; // heartbeat inicial

    // Notificação pro 999 (o da query forjada) NÃO chega nesta conexão...
    emitirNotificacao(999, { tipo: "info", titulo: "t", mensagem: "m" });
    expect(res.write.mock.calls.length).toBe(writesAposConectar);

    // ...mas a do 42 (id real da sessão) chega → conexão chaveada pela sessão.
    emitirNotificacao(42, { tipo: "info", titulo: "t", mensagem: "m" });
    expect(res.write.mock.calls.length).toBe(writesAposConectar + 1);

    req._close(); // dispara cleanup (clearInterval do heartbeat)
  });
});
