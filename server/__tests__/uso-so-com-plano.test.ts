/**
 * "Quero que só libere o uso após escolha do plano/teste" — dono, 13/09/2026.
 *
 * O que existia antes era um desenho: o `SubscriptionGuard` redirecionava no
 * navegador e a API respondia tudo, porque o porteiro de módulos é fail-open e
 * lê "sem assinatura" como "não sei". Agora `protectedProcedure` passa por
 * `requirePlanoEscolhido`.
 *
 * A régua de quem tem acesso NÃO mudou — é a mesma
 * `getActiveSubscriptionComHeranca` que a tela já consultava. Os testes abaixo
 * guardam três coisas, nessa ordem de importância:
 *   1. sem plano, o que é o produto recusa; o que serve pra escolher plano,
 *      não (senão a pessoa fica trancada fora da própria tela de pagamento);
 *   2. o "não" nunca é cacheado — quem acabou de clicar em "Testar grátis"
 *      não pode levar recusa nos 30s seguintes;
 *   3. indeterminação nossa (banco fora) libera, como o resto da casa.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MENSAGEM_SEM_PLANO,
  MOTIVO_SEM_PLANO,
  NAMESPACES_LIBERADOS_SEM_PLANO,
  precisaDePlano,
} from "../../shared/acesso-sem-plano";

const raiz = join(__dirname, "..", "..");
const ler = (p: string) => readFileSync(join(raiz, p), "utf8");

/** Namespaces reais do appRouter, lidos do fonte (mesma técnica do teste de módulos). */
function namespacesDoAppRouter(): string[] {
  const fonte = ler("server/routers.ts");
  const corpo = fonte.slice(fonte.indexOf("export const appRouter = router({"));
  return [...corpo.matchAll(/^  (\w+):/gm)].map((m) => m[1]);
}

// A consulta de assinatura é injetada por mock: o gate a importa de "../db"
// dinamicamente, então o módulo real (drizzle, PLANS) nem carrega aqui.
const assinaturaFake = vi.fn();
vi.mock("../db", () => ({
  getActiveSubscriptionComHeranca: (uid: number) => assinaturaFake(uid),
}));

import { conferirPlanoDoPath, invalidarCacheGateAssinatura, temPlanoVigente } from "../_core/gate-assinatura";

const SEM_PLANO = { path: "clientes.listar", userId: 7, role: "user", impersonado: false };

async function recusa(args: Parameters<typeof conferirPlanoDoPath>[0]) {
  try {
    await conferirPlanoDoPath(args);
    return null;
  } catch (err: any) {
    return err;
  }
}

beforeEach(() => {
  invalidarCacheGateAssinatura();
  assinaturaFake.mockReset();
});

describe("a lista de quem responde sem plano", () => {
  it("o produto exige plano", () => {
    for (const path of [
      "clientes.listar",
      "processos.listar",
      "crm.listarConversas",
      "financeiro.resumo",
      "agenda.contadores",
      "kanban.listarFunis",
      "relatorios.comercialDashboard",
      "assinaturas.listarPorCliente",
      "dashboard.usoDoMes",
      "jurisia.perguntar",
      "upload.assinar",
    ]) {
      expect(precisaDePlano(path), `${path} devia exigir plano`).toBe(true);
    }
  });

  it("o caminho pra escolher o plano NÃO exige plano", () => {
    // Sem estes, a pessoa fica trancada fora da tela onde se paga: o "Meu
    // plano" mora dentro de Configurações, que pede escritório e cargos ao
    // montar. Foi o bug que ele relatou em 13/09 ("clico e não acontece nada").
    for (const path of [
      "auth.me",
      "auth.logout",
      "termos.status",
      "termos.aceitar",
      "subscription.current",
      "subscription.plans",
      "subscription.trialDisponivel",
      "subscription.iniciarTrial",
      "subscription.createCheckout",
      "configuracoes.meuEscritorio",
      "configuracoes.criarEscritorio",
      "configuracoes.listarSetores",
      "permissoes.listarCargos",
      "permissoes.minhasPermissoes",
      "notificacoes.listar",
      "push.registrar",
      "ajuda.primeirosPassos",
    ]) {
      expect(precisaDePlano(path), `${path} não pode exigir plano`).toBe(false);
    }
  });

  it("namespace que ninguém declarou EXIGE plano (deny-by-default)", () => {
    // O oposto do fail-open do porteiro de módulos, de propósito: tela nova
    // que nasce sem porteiro entregaria o produto de graça.
    expect(precisaDePlano("moduloNovoQueNinguemDeclarou.listar")).toBe(true);
    expect(precisaDePlano("")).toBe(true);
  });

  it("a lista não tem namespace fantasma (pega rename de router)", () => {
    // Router renomeado deixaria o nome velho liberado e o novo bloqueado — o
    // onboarding quebraria em silêncio.
    const reais = namespacesDoAppRouter();
    expect(reais.length).toBeGreaterThan(50);
    const fantasmas = NAMESPACES_LIBERADOS_SEM_PLANO.filter((ns) => !reais.includes(ns));
    expect(fantasmas, `liberados mas fora do appRouter: ${fantasmas.join(", ")}`).toEqual([]);
  });
});

describe("o porteiro decide", () => {
  it("sem assinatura, o produto recusa com o motivo legível", async () => {
    assinaturaFake.mockResolvedValue(null);
    const err = await recusa(SEM_PLANO);
    expect(err?.code).toBe("FORBIDDEN");
    expect(err?.message).toBe(MENSAGEM_SEM_PLANO);
    expect((err?.cause as any)?.motivo).toBe(MOTIVO_SEM_PLANO);
  });

  it("com assinatura (teste, cortesia ou paga) passa", async () => {
    assinaturaFake.mockResolvedValue({ id: 1, status: "trialing" });
    expect(await recusa(SEM_PLANO)).toBeNull();
  });

  it("indeterminado (banco fora) passa — fail-open", async () => {
    assinaturaFake.mockRejectedValue(new Error("DB fora"));
    expect(await temPlanoVigente(7)).toBeNull();
    expect(await recusa(SEM_PLANO)).toBeNull();
  });

  it("admin da plataforma passa sem nem consultar", async () => {
    assinaturaFake.mockResolvedValue(null);
    expect(await recusa({ ...SEM_PLANO, role: "admin" })).toBeNull();
    expect(assinaturaFake).not.toHaveBeenCalled();
  });

  it("impersonação passa sem consultar — é o dono olhando a conta SEM plano", async () => {
    assinaturaFake.mockResolvedValue(null);
    expect(await recusa({ ...SEM_PLANO, impersonado: true })).toBeNull();
    expect(assinaturaFake).not.toHaveBeenCalled();
  });

  it("path liberado não custa consulta nenhuma", async () => {
    assinaturaFake.mockResolvedValue(null);
    expect(await recusa({ ...SEM_PLANO, path: "subscription.plans" })).toBeNull();
    expect(assinaturaFake).not.toHaveBeenCalled();
  });
});

describe("o cache guarda o SIM e nunca o NÃO", () => {
  it("quem tem plano consulta uma vez por janela", async () => {
    assinaturaFake.mockResolvedValue({ id: 1, status: "active" });
    await conferirPlanoDoPath(SEM_PLANO);
    await conferirPlanoDoPath(SEM_PLANO);
    await conferirPlanoDoPath({ ...SEM_PLANO, path: "processos.listar" });
    expect(assinaturaFake).toHaveBeenCalledTimes(1);
  });

  it("quem NÃO tem é re-consultado a cada chamada", async () => {
    // O motivo é o clique em "Testar grátis": com o "não" em cache por 30s, a
    // primeira tela depois de começar o teste viria recusada.
    assinaturaFake.mockResolvedValue(null);
    await recusa(SEM_PLANO);
    await recusa(SEM_PLANO);
    expect(assinaturaFake).toHaveBeenCalledTimes(2);

    assinaturaFake.mockResolvedValue({ id: 2, status: "trialing" });
    expect(await recusa(SEM_PLANO)).toBeNull();
  });

  it("o SIM vence — plano que caiu volta a ser conferido na janela seguinte", async () => {
    // Sem validade, a primeira resposta "tem plano" valeria pra sempre no
    // processo: assinatura cancelada seguiria abrindo o app até reiniciar.
    vi.useFakeTimers();
    try {
      assinaturaFake.mockResolvedValue({ id: 1, status: "active" });
      await conferirPlanoDoPath(SEM_PLANO);
      await conferirPlanoDoPath(SEM_PLANO);
      expect(assinaturaFake).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(31_000);
      assinaturaFake.mockResolvedValue(null);
      const err = await recusa(SEM_PLANO);
      expect(assinaturaFake).toHaveBeenCalledTimes(2);
      expect(err?.code).toBe("FORBIDDEN");
    } finally {
      vi.useRealTimers();
    }
  });

  it("o SIM é por usuário — o plano de um não abre a conta do outro", async () => {
    assinaturaFake.mockImplementation(async (uid: number) => (uid === 7 ? { id: 1, status: "active" } : null));
    expect(await recusa(SEM_PLANO)).toBeNull();
    const err = await recusa({ ...SEM_PLANO, userId: 8 });
    expect(err?.code).toBe("FORBIDDEN");
  });
});

describe("fiação — o porteiro está na corrente e usa a régua da tela", () => {
  it("protectedProcedure passa por requirePlanoEscolhido", () => {
    const trpc = ler("server/_core/trpc.ts");
    expect(trpc).toContain("const requirePlanoEscolhido = t.middleware");
    // A CHAMADA, não o nome: o import deixa o literal de pé e o mutante que
    // troca só a chamada passava.
    expect(trpc).toContain("await conferirPlanoDoPath({");
    expect(trpc).toContain(".use(requirePlanoEscolhido)");
    // A exceção da impersonação tem que CHEGAR no gate: sem este argumento o
    // dono olhando a conta do cliente levaria recusa.
    expect(trpc).toContain("impersonado: Boolean(ctx.user.impersonatedBy)");
  });

  it("servidor e tela decidem acesso pela MESMA função", () => {
    // Ancorado no import E na chamada: o nome aparece no comentário que
    // explica a decisão, e conferir o arquivo inteiro reprovava o registro.
    const gate = ler("server/_core/gate-assinatura.ts");
    expect(gate).toContain('const { getActiveSubscriptionComHeranca } = await import("../db");');
    expect(gate).toContain("await getActiveSubscriptionComHeranca(userId);");
    // Em subscription.ts a linha aparece 3×; sem o cabeçalho da procedure o
    // mutante trocava a régua de `current` e o literal ficava de pé nas outras.
    expect(ler("server/routers/subscription.ts")).toContain(
      "current: protectedProcedure.query(async ({ ctx }) => {\n    const sub = await getActiveSubscriptionComHeranca(ctx.user.id);",
    );
    expect(ler("client/src/components/SubscriptionGuard.tsx")).toContain("const hasAccess = !!subscription;");
  });

  it("o menu para de contar badge sem plano (403 em loop na tela do plano)", () => {
    const layout = ler("client/src/components/AppLayout.tsx");
    expect(layout).toContain("const contadoresLiberados = !isUser || hasSubscription;");
    // As TRÊS: movimentações, agenda e conversas. Contar importa — parar duas
    // e deixar uma batendo de 2 em 2 minutos é o mesmo 403 em loop.
    expect((layout.match(/enabled: contadoresLiberados/g) || []).length).toBe(3);
    expect(layout).toContain("enabled: contadoresLiberados && contratoLibera(modulosContratados, [\"agenda\"])");
  });
});
