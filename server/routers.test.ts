import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

type CookieCall = {
  name: string;
  options: Record<string, unknown>;
};

function createUserContext(
  role: "user" | "admin" = "user",
  overrides?: Partial<AuthenticatedUser>
): { ctx: TrpcContext; clearedCookies: CookieCall[] } {
  const clearedCookies: CookieCall[] = [];

  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-openid",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role,
    asaasCustomerId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };

  return { ctx, clearedCookies };
}

function createAnonymousContext(): { ctx: TrpcContext } {
  const ctx: TrpcContext = {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
  return { ctx };
}

describe("auth.me", () => {
  it("returns null for unauthenticated users", async () => {
    const { ctx } = createAnonymousContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).toBeNull();
  });

  it("returns user data for authenticated users", async () => {
    const { ctx } = createUserContext("user");
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).not.toBeNull();
    expect(result?.email).toBe("test@example.com");
    expect(result?.role).toBe("user");
  });

  it("returns admin user data for admin users", async () => {
    const { ctx } = createUserContext("admin");
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).not.toBeNull();
    expect(result?.role).toBe("admin");
  });
});

describe("auth.logout", () => {
  it("clears the session cookie and reports success", async () => {
    const { ctx, clearedCookies } = createUserContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.name).toBe(COOKIE_NAME);
  });
});

describe("subscription.plans", () => {
  it("returns available plans", async () => {
    const { ctx } = createAnonymousContext();
    const caller = appRouter.createCaller(ctx);
    const plans = await caller.subscription.plans();
    expect(plans).toHaveLength(3);
    expect(plans[0].id).toBe("iniciante");
    expect(plans[1].id).toBe("profissional");
    expect(plans[2].id).toBe("escritorio");
  });

  it("plans have required fields", async () => {
    const { ctx } = createAnonymousContext();
    const caller = appRouter.createCaller(ctx);
    const plans = await caller.subscription.plans();
    for (const plan of plans) {
      expect(plan).toHaveProperty("id");
      expect(plan).toHaveProperty("name");
      expect(plan).toHaveProperty("description");
      expect(plan).toHaveProperty("features");
      expect(plan).toHaveProperty("priceMonthly");
      expect(plan).toHaveProperty("priceYearly");
      expect(plan).toHaveProperty("currency");
      expect(plan.currency).toBe("brl");
      expect(plan.priceMonthly).toBeGreaterThan(0);
      expect(plan.priceYearly).toBeGreaterThan(0);
      expect(plan.features.length).toBeGreaterThan(0);
    }
  });

  it("profissional plan is marked as popular", async () => {
    const { ctx } = createAnonymousContext();
    const caller = appRouter.createCaller(ctx);
    const plans = await caller.subscription.plans();
    const profissional = plans.find((p) => p.id === "profissional");
    expect(profissional?.popular).toBe(true);
  });
});

describe("subscription.current", () => {
  it("requires authentication", async () => {
    const { ctx } = createAnonymousContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.subscription.current()).rejects.toThrow();
  });
});

describe("admin.stats", () => {
  it("rejects non-admin users", async () => {
    const { ctx } = createUserContext("user");
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.stats()).rejects.toThrow();
  });

  it("rejects unauthenticated users", async () => {
    const { ctx } = createAnonymousContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.stats()).rejects.toThrow();
  });
});

describe("admin.users", () => {
  it("rejects non-admin users", async () => {
    const { ctx } = createUserContext("user");
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.users()).rejects.toThrow();
  });
});

describe("admin.updateUserRole", () => {
  it("rejects non-admin users", async () => {
    const { ctx } = createUserContext("user");
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.admin.updateUserRole({ userId: 1, role: "admin" })
    ).rejects.toThrow();
  });
});

describe("subscription.createCheckout", () => {
  it("requires authentication", async () => {
    const { ctx } = createAnonymousContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.subscription.createCheckout({
        planId: "basic",
        interval: "monthly",
      })
    ).rejects.toThrow();
  });
});
