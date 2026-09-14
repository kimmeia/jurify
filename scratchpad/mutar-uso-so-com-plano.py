#!/usr/bin/env python3
"""Mutações do porteiro do plano (13/09): "só libere o uso após escolha do plano/teste".

Cada entrada desarma uma peça do porteiro — ou fura a exceção que precisa
continuar passando (admin, impersonação, indeterminação, o caminho da própria
tela de pagamento) — e diz qual amarra tem que ficar vermelha.

Uso: python3 scratchpad/mutar-uso-so-com-plano.py
"""
import io
import os
import shutil
import subprocess
import sys

AMARRA = "server/__tests__/uso-so-com-plano.test.ts"
MODULOS = "server/__tests__/modulos-contratacao.test.ts"

GATE = "server/_core/gate-assinatura.ts"
TRPC = "server/_core/trpc.ts"
LISTA = "shared/acesso-sem-plano.ts"
LAYOUT = "client/src/components/AppLayout.tsx"
GUARD = "client/src/components/SubscriptionGuard.tsx"
SUB = "server/routers/subscription.ts"

# (nome, arquivo, de, para, teste)
MUTACOES = [
    # ── o porteiro em si ────────────────────────────────────────────────────
    ("o porteiro sai da corrente do protectedProcedure", TRPC,
     ".use(requirePlanoEscolhido)\n", "", AMARRA),
    ("o porteiro de módulo sai da corrente (o vizinho continua protegido)", TRPC,
     ".use(requireModuloContratado);", ";", MODULOS),
    ("o middleware deixa de chamar o gate", TRPC,
     "await conferirPlanoDoPath({", "await Promise.resolve({", AMARRA),
    ("a impersonação deixa de chegar ao gate (dono perde a conta do cliente)", TRPC,
     "impersonado: Boolean(ctx.user.impersonatedBy),", "impersonado: false,", AMARRA),

    # ── a decisão ──────────────────────────────────────────────────────────
    ("o gate deixa de recusar quem não tem plano", GATE,
     "if (tem !== false) return;", "if (true) return;", AMARRA),
    ("a recusa vira fail-open ao contrário: indeterminação bloqueia", GATE,
     "if (tem !== false) return;", "if (tem === true) return;", AMARRA),
    ("o gate confere plano até no caminho de escolher plano", GATE,
     "if (!precisaDePlano(args.path)) return;", "if (false) return;", AMARRA),
    ("o admin da plataforma passa a ser barrado", GATE,
     'if (args.role === "admin") return;', 'if (args.role === "nunca") return;', AMARRA),
    ("a impersonação passa a ser barrada", GATE,
     "if (args.impersonado) return;", "if (false) return;", AMARRA),
    ("o motivo da recusa muda (o client não reconhece mais)", GATE,
     "cause: { motivo: MOTIVO_SEM_PLANO },", "cause: { motivo: \"outro\" },", AMARRA),
    ("a recusa deixa de ser FORBIDDEN", GATE,
     'code: "FORBIDDEN",', 'code: "BAD_REQUEST",', AMARRA),

    # ── a régua é a mesma da tela ──────────────────────────────────────────
    # Ancorado no import: a 1ª ocorrência do nome no arquivo é o comentário que
    # explica a decisão, e mutar o comentário não muda o comportamento.
    ("o gate passa a usar régua própria em vez da da tela", GATE,
     'const { getActiveSubscriptionComHeranca } = await import("../db");\n    const sub = await getActiveSubscriptionComHeranca(userId);',
     'const { getUserSubscriptions } = await import("../db");\n    const sub = await getUserSubscriptions(userId);', AMARRA),
    ("erro de banco deixa de liberar (deixa de ser fail-open)", GATE,
     "  } catch {\n    return null;\n  }", "  } catch {\n    return false;\n  }", AMARRA),
    ("assinatura ausente deixa de bloquear", GATE,
     "if (!sub) return false;", "if (!sub) return true;", AMARRA),

    # ── o cache ────────────────────────────────────────────────────────────
    ("o cache passa a guardar o NÃO (quem começa o teste leva recusa por 30s)", GATE,
     "    if (!sub) return false;",
     "    if (!sub) {\n      cacheSim.set(userId, agora + TTL_MS);\n      return false;\n    }", AMARRA),
    ("o cache do SIM deixa de existir (2 consultas por chamada)", GATE,
     "    cacheSim.set(userId, agora + TTL_MS);\n    return true;", "    return true;", AMARRA),
    ("o cache deixa de ser por usuário", GATE,
     "  const validoAte = cacheSim.get(userId);", "  const validoAte = [...cacheSim.values()][0];", AMARRA),
    ("o cache ignora a validade (plano vencido segue passando pra sempre)", GATE,
     "if (validoAte != null && validoAte > agora) return true;", "if (validoAte != null) return true;", AMARRA),

    # ── a lista de quem responde sem plano ─────────────────────────────────
    ("o produto entra na lista dos liberados", LISTA,
     '  "auth",', '  "auth",\n  "clientes",', AMARRA),
    ("a tela do plano sai da lista (a pessoa fica trancada fora do pagamento)", LISTA,
     '  "subscription",\n', "", AMARRA),
    ("Configurações sai da lista (a tela onde o Meu plano mora não renderiza)", LISTA,
     '  "configuracoes",\n', "", AMARRA),
    ("os cargos saem da lista (Configurações pede ao montar)", LISTA,
     '  "permissoes",\n', "", AMARRA),
    ("o aceite dos termos sai da lista", LISTA,
     '  "termos",\n', "", AMARRA),
    ("a Central de ajuda sai da lista (ela vive fora do guard de assinatura)", LISTA,
     '  "ajuda",\n', "", AMARRA),
    ("a decisão vira fail-open: namespace não declarado passa", LISTA,
     "  return !LIBERADOS.has(ns);", "  return false;", AMARRA),
    ("a lista passa a liberar tudo", LISTA,
     "  return !LIBERADOS.has(ns);", "  return LIBERADOS.has(ns);", AMARRA),
    ("um namespace fantasma entra na lista (rename de router passa batido)", LISTA,
     '  "auth",', '  "auth",\n  "namespaceQueNaoExisteMais",', AMARRA),

    # ── o menu para de bater na porta fechada ──────────────────────────────
    ("o menu volta a contar badge sem plano (403 em loop)", LAYOUT,
     "const contadoresLiberados = !isUser || hasSubscription;",
     "const contadoresLiberados = true;", AMARRA),
    ("só duas das três contagens param", LAYOUT,
     "  const { data: contConversas } = (trpc as any).crm?.contarConversas?.useQuery?.(undefined, {\n    refetchInterval: 2 * 60_000,\n    retry: false,\n    enabled: contadoresLiberados,\n  }) ?? { data: null };",
     "  const { data: contConversas } = (trpc as any).crm?.contarConversas?.useQuery?.(undefined, {\n    refetchInterval: 2 * 60_000,\n    retry: false,\n  }) ?? { data: null };", AMARRA),
    ("a contagem da agenda perde a conferência do contrato", LAYOUT,
     'enabled: contadoresLiberados && contratoLibera(modulosContratados, ["agenda"])',
     "enabled: contadoresLiberados", AMARRA),
    ("a tela volta a liberar sem assinatura", GUARD,
     "const hasAccess = !!subscription;", "const hasAccess = true;", AMARRA),
    # A linha aparece 3× no arquivo — sem o cabeçalho da procedure a mutação
    # cai na vizinha e o literal de `current` fica de pé.
    ("subscription.current passa a usar outra régua", SUB,
     "current: protectedProcedure.query(async ({ ctx }) => {\n    const sub = await getActiveSubscriptionComHeranca(ctx.user.id);",
     "current: protectedProcedure.query(async ({ ctx }) => {\n    const sub = await getActiveSubscription(ctx.user.id);", AMARRA),
]


def rodar(teste: str) -> bool:
    r = subprocess.run(["pnpm", "vitest", "run", teste], capture_output=True, text=True, cwd=".")
    return r.returncode == 0


def main() -> int:
    sobreviventes = []
    for i, (nome, arquivo, de, para, teste) in enumerate(MUTACOES, 1):
        if not os.path.exists(arquivo):
            print(f"[{i:2}/{len(MUTACOES)}] ⚠ ARQUIVO NÃO EXISTE — {nome} ({arquivo})")
            sobreviventes.append(nome + " (arquivo não existe)")
            continue
        original = io.open(arquivo, encoding="utf-8").read()
        if de not in original:
            print(f"[{i:2}/{len(MUTACOES)}] ⚠ TRECHO NÃO ENCONTRADO — {nome} ({arquivo})")
            sobreviventes.append(nome + " (trecho não encontrado)")
            continue
        io.open(arquivo, "w", encoding="utf-8").write(original.replace(de, para, 1))
        try:
            passou = rodar(teste)
        finally:
            io.open(arquivo, "w", encoding="utf-8").write(original)
        if passou:
            print(f"[{i:2}/{len(MUTACOES)}] ✗ SOBREVIVEU — {nome}")
            sobreviventes.append(nome)
        else:
            print(f"[{i:2}/{len(MUTACOES)}] ✓ vermelho — {nome}")

    print()
    if sobreviventes:
        print(f"{len(sobreviventes)} sobreviveram:")
        for s in sobreviventes:
            print(f"  - {s}")
        return 1
    print(f"todas as {len(MUTACOES)} mutações ficaram vermelhas")
    return 0


if __name__ == "__main__":
    sys.exit(main())
