import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAdminContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "admin-user",
    email: "admin@example.com",
    name: "Admin User",
    loginMethod: "google",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function createClientContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 2,
    openId: "client-user",
    email: "client@example.com",
    name: "Client User",
    loginMethod: "google",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function createUnauthContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describe("admin.stats", () => {
  it("returns stats for admin user", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const stats = await caller.admin.stats();

    expect(stats).toHaveProperty("totalClients");
    expect(stats).toHaveProperty("activeSubscriptions");
    expect(stats).toHaveProperty("trialingSubscriptions");
    expect(stats).toHaveProperty("mrr");
    expect(stats).toHaveProperty("conversionRate");
    expect(stats).toHaveProperty("newClientsThisMonth");
    expect(stats).toHaveProperty("planBreakdown");
    expect(stats.planBreakdown).toHaveProperty("iniciante");
    expect(stats.planBreakdown).toHaveProperty("profissional");
    expect(stats.planBreakdown).toHaveProperty("escritorio");
    expect(typeof stats.totalClients).toBe("number");
    expect(typeof stats.mrr).toBe("number");
    expect(typeof stats.conversionRate).toBe("number");
  });

  it("rejects non-admin user from accessing stats", async () => {
    const ctx = createClientContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.admin.stats()).rejects.toThrow();
  });

  it("rejects unauthenticated user from accessing stats", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.admin.stats()).rejects.toThrow();
  });
});

describe("admin.allUsers", () => {
  it("returns paginated users list for admin", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.allUsers();

    // Novo shape: { itens, total } pra UI paginar (era array antes).
    expect(result).toHaveProperty("itens");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.itens)).toBe(true);
    expect(typeof result.total).toBe("number");
  });

  it("rejects non-admin user", async () => {
    const ctx = createClientContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.admin.allUsers()).rejects.toThrow();
  });
});

describe("admin.recentUsers", () => {
  it("returns recent users for admin", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const recent = await caller.admin.recentUsers();

    expect(Array.isArray(recent)).toBe(true);
  });

  it("rejects non-admin user", async () => {
    const ctx = createClientContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.admin.recentUsers()).rejects.toThrow();
  });
});

describe("admin.recentSubscriptions", () => {
  it("returns recent subscriptions for admin", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const recent = await caller.admin.recentSubscriptions();

    expect(Array.isArray(recent)).toBe(true);
  });

  it("rejects non-admin user", async () => {
    const ctx = createClientContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.admin.recentSubscriptions()).rejects.toThrow();
  });
});

describe("admin.allSubscriptions", () => {
  it("returns paginated subscriptions list for admin", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.allSubscriptions();

    expect(result).toHaveProperty("itens");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.itens)).toBe(true);
  });

  it("rejects non-admin user", async () => {
    const ctx = createClientContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.admin.allSubscriptions()).rejects.toThrow();
  });
});

describe("subscription.plans", () => {
  it("returns available plans (public)", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    const plans = await caller.subscription.plans();

    expect(Array.isArray(plans)).toBe(true);
    expect(plans.length).toBe(3);
    expect(plans[0]).toHaveProperty("id");
    expect(plans[0]).toHaveProperty("name");
    expect(plans[0]).toHaveProperty("priceMonthly");
    expect(plans[0]).toHaveProperty("priceYearly");
    expect(plans[0]).toHaveProperty("features");
  });
});

describe("auth.me", () => {
  it("returns user for authenticated context", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const me = await caller.auth.me();

    expect(me).not.toBeNull();
    expect(me?.role).toBe("admin");
    expect(me?.email).toBe("admin@example.com");
  });

  it("returns null for unauthenticated context", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    const me = await caller.auth.me();

    expect(me).toBeNull();
  });
});
