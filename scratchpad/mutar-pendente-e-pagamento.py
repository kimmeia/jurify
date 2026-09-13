#!/usr/bin/env python3
"""Mutações das duas entregas de 13/09 a partir dos prints do dono:
a Central escondendo movimentação pendente, e o cliente em teste sem como pagar.

Cada entrada quebra UMA decisão e diz qual amarra tem que ficar vermelha.
Mutação que sobrevive = amarra que não amarra nada.

Uso: python3 scratchpad/mutar-pendente-e-pagamento.py
"""
import io
import subprocess
import sys

CENTRAL = "server/__tests__/central-nao-esconde-pendente.test.ts"
PAGAR = "server/__tests__/pagar-o-plano-em-teste.test.ts"
GRUPOS = "server/processos/central-grupos.test.ts"

ROUTER = "server/processos/router-movimentacoes.ts"
CONTADOR = "server/processos/contador-movimentacoes.ts"
TELA = "client/src/pages/Movimentacoes.tsx"
PLANOS = "client/src/pages/Plans.tsx"
LAYOUT = "client/src/components/AppLayout.tsx"

MUTACOES = [
    # ── a Central não esconde pendente ──────────────────────────────────────
    ("volta a ordenar só por data (o bug do print)", ROUTER,
     ".orderBy(asc(eventosProcesso.lido), desc(eventosProcesso.dataEvento))",
     ".orderBy(desc(eventosProcesso.dataEvento))", CENTRAL),
    ("ordena por lido DECRESCENTE (resolvida primeiro)", ROUTER,
     ".orderBy(asc(eventosProcesso.lido), desc(eventosProcesso.dataEvento))",
     ".orderBy(desc(eventosProcesso.lido), desc(eventosProcesso.dataEvento))", CENTRAL),
    ("ordena depois de cortar (ordem inútil)", ROUTER,
     "        .orderBy(asc(eventosProcesso.lido), desc(eventosProcesso.dataEvento))\n        .limit(limite);",
     "        .limit(limite)\n        .orderBy(asc(eventosProcesso.lido), desc(eventosProcesso.dataEvento));",
     CENTRAL),
    ("o teto some (conserto pelo lado errado)", ROUTER,
     "limite: z.number().int().min(1).max(200).default(80)",
     "limite: z.number().int().min(1).max(200).default(100000)", CENTRAL),
    ("a contagem do período passa a contar a página", ROUTER,
     "      const aResolverPeriodo = Number(totalJanela?.aResolver ?? 0);",
     "      const aResolverPeriodo = rows.filter((r) => !r.lido).length;", CENTRAL),
    ("a contagem do período não é entregue à triagem", ROUTER,
     "        { aResolver: aResolverPeriodo, resolvidas: resolvidasPeriodo },",
     "        undefined,", CENTRAL),
    ("triar zera a janela quando o caller não passa nada", ROUTER,
     "      aResolver: janela?.aResolver ?? aResolver,",
     "      aResolver: janela?.aResolver ?? 0,", GRUPOS),
    ("o contador do badge ganha teto (os dois voltam a discordar)", CONTADOR,
     "    .where(\n      and(",
     "    .limit(80)\n    .where(\n      and(", CENTRAL),
    ("o contador para de filtrar não lidas", CONTADOR,
     "        eq(eventosProcesso.lido, false),", "", CENTRAL),
    ("o texto do vazio volta a contar a página", TELA,
     "    tipo === \"todos\" && !busca ? (jan?.noPeriodo ?? 0) : (data?.total ?? 0);",
     "    data?.total ?? 0;", CENTRAL),
    ("'nada no período' volta a se decidir pela página", TELA,
     "    : (data?.janela.noPeriodo ?? 0) === 0",
     "    : (data?.total ?? 0) === 0", CENTRAL),
    ("o rótulo de Resolvidas volta a ser o da página", TELA,
     "  const resolvidasRotulo = tipo === \"todos\" ? (jan?.resolvidas ?? 0) : contagem.resolvidas;",
     "  const resolvidasRotulo = contagem.resolvidas;", CENTRAL),
    ("o aviso de página cortada some", TELA,
     "      {faltamNaLista > 0 && (", "      {false && (", CENTRAL),
    ("o aviso ignora o filtro de tipo e passa a mentir", TELA,
     "    isLoading || tipo !== \"todos\" || busca ? 0 : Math.max(0, noEstadoAtual - itens.length);",
     "    isLoading ? 0 : Math.max(0, noEstadoAtual - itens.length);", CENTRAL),
    ("número negativo vira aviso", TELA,
     "Math.max(0, noEstadoAtual - itens.length)", "(noEstadoAtual - itens.length)", CENTRAL),

    # ── pagar o plano em teste ──────────────────────────────────────────────
    ("o botão de pagar some do bloco do plano", PLANOS,
     '                    id="adicionar-pagamento"\n', "", PAGAR),
    ("o botão de pagar aparece também fora do teste", PLANOS,
     "{emTeste && !sobConsultaAtual && !emCarencia && (",
     "{!sobConsultaAtual && !emCarencia && (", PAGAR),
    ("o botão de pagar aparece em plano sob consulta", PLANOS,
     "{emTeste && !sobConsultaAtual && !emCarencia && (",
     "{emTeste && !emCarencia && (", PAGAR),
    ("pagar leva pro plano errado", PLANOS,
     "onClick={() => currentPlanId && handleSelectPlan(currentPlanId)}",
     'onClick={() => handleSelectPlan("escala")}', PAGAR),
    ("o botão ignora cobrança indisponível", PLANOS,
     "                    disabled={loadingPlan !== null || billingOk === false}",
     "                    disabled={loadingPlan !== null}", PAGAR),
    ("pagamento em andamento volta a oferecer pagar de novo", PLANOS,
     '                      ? "Ver o pagamento"\n                      : "Adicionar pagamento"}',
     '                      ? "Adicionar pagamento"\n                      : "Adicionar pagamento"}',
     PAGAR),
    ("o cartão do plano atual volta a travar no teste", PLANOS,
     "const podePagarOTeste = isCurrentPlan && isTrial && !sobConsulta;",
     "const podePagarOTeste = false;", PAGAR),
    ("o disabled do cartão volta à regra antiga", PLANOS,
     "                  travadoPorSerOAtual ||",
     "                  (isCurrentPlan && !podeFecharValor) ||", PAGAR),
    ("o rótulo do cartão volta à regra antiga", PLANOS,
     "                ) : travadoPorSerOAtual ? (",
     "                ) : isCurrentPlan && !podeFecharValor ? (", PAGAR),
    ("o rótulo 'Continuar com este plano' some", PLANOS,
     'if (isCurrentPlan && isTrial) buttonLabel = "Continuar com este plano";',
     'if (isCurrentPlan && isTrial) buttonLabel = "Plano Atual";', PAGAR),
    ("o cursor segue dizendo 'não clique'", PLANOS,
     '${travadoPorSerOAtual ? "cursor-default" : ""}', "cursor-default", PAGAR),
    ("a faixa volta a navegar às cegas (o clique morto do print)", LAYOUT,
     "onClick={() => (sobConsulta ? abrirConversa() : irPagar())}",
     'onClick={() => (sobConsulta ? abrirConversa() : setLocation("/configuracoes?tab=meu-plano"))}',
     PAGAR),
    ("a faixa não procura mais o botão de pagar", LAYOUT,
     '    const alvo = document.getElementById("adicionar-pagamento");',
     "    const alvo = null as HTMLElement | null;", PAGAR),
    ("a faixa não leva o foco pro botão", LAYOUT,
     "      alvo.focus({ preventScroll: true });", "", PAGAR),
    ("na mesma tela sem botão, volta ao não-evento", LAYOUT,
     '    if (local.startsWith("/configuracoes")) {\n      // Mesma tela, aba certa, e o botão ainda não pintou (troca de aba ou\n      // plano ainda carregando): recarrega em vez de fingir que navegou.\n      window.location.assign(destino);\n      return;\n    }\n',
     "", PAGAR),
    ("plano sob consulta passa a cair no checkout", LAYOUT,
     "onClick={() => (sobConsulta ? abrirConversa() : irPagar())}",
     "onClick={() => irPagar()}", PAGAR),
]


def rodar(teste: str) -> bool:
    r = subprocess.run(["pnpm", "vitest", "run", teste], capture_output=True, text=True, cwd=".")
    return r.returncode == 0


def main() -> int:
    sobreviventes = []
    for i, (nome, arquivo, de, para, teste) in enumerate(MUTACOES, 1):
        original = io.open(arquivo, encoding="utf-8").read()
        if de not in original:
            print(f"[{i:2}/{len(MUTACOES)}] ⚠ TRECHO NÃO ENCONTRADO — {nome} ({arquivo})")
            sobreviventes.append(nome + " (trecho não encontrado)")
            continue
        if original.count(de) != 1:
            print(f"[{i:2}/{len(MUTACOES)}] ⚠ TRECHO AMBÍGUO ({original.count(de)}×) — {nome}")
            sobreviventes.append(nome + " (trecho ambíguo)")
            continue
        io.open(arquivo, "w", encoding="utf-8").write(original.replace(de, para))
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
