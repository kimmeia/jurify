/**
 * Testes — rate limit middleware
 */

import { describe, it, expect, vi } from "vitest";
import { rateLimit } from "../_core/rate-limit";

function mockReq(ip = "1.2.3.4") {
  return { ip, socket: { remoteAddress: ip } } as any;
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
  };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: unknown) => {
    res.body = body;
    return res;
  };
  res.setHeader = (k: string, v: string) => {
    res.headers[k] = v;
  };
  return res;
}

describe("rate-limit", () => {
  it("permite requisições dentro do limite", () => {
    const mw = rateLimit({ name: "test-ok", max: 3 });
    const next = vi.fn();
    for (let i = 0; i < 3; i++) {
      const res = mockRes();
      mw(mockReq("10.0.0.1"), res, next);
    }
    expect(next).toHaveBeenCalledTimes(3);
  });

  it("bloqueia ao exceder o limite e retorna 429", () => {
    const mw = rateLimit({ name: "test-block", max: 2 });
    const next = vi.fn();
    const ip = "10.0.0.2";

    mw(mockReq(ip), mockRes(), next);
    mw(mockReq(ip), mockRes(), next);
    const res = mockRes();
    mw(mockReq(ip), res, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(429);
    expect(res.headers["Retry-After"]).toBeDefined();
  });

  it("limites são isolados por nome", () => {
    const mw1 = rateLimit({ name: "iso-1", max: 1 });
    const mw2 = rateLimit({ name: "iso-2", max: 1 });
    const next = vi.fn();
    const ip = "10.0.0.3";

    mw1(mockReq(ip), mockRes(), next);
    mw2(mockReq(ip), mockRes(), next); // outro bucket — passa
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("IPs diferentes têm contadores independentes", () => {
    const mw = rateLimit({ name: "test-multi-ip", max: 1 });
    const next = vi.fn();
    mw(mockReq("1.1.1.1"), mockRes(), next);
    mw(mockReq("2.2.2.2"), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });
});
