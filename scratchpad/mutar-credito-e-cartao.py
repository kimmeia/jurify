#!/usr/bin/env python3
"""Mutações da remoção da moeda "crédito" e do texto do cartão do Escala (13/09).

Cada entrada devolve ao código uma peça da moeda (ou quebra a distinção entre
crédito-moeda e crédito-no-sentido-financeiro) e diz qual amarra tem que ficar
vermelha.

Uso: python3 scratchpad/mutar-credito-e-cartao.py
"""
import io
import os
import shutil
import subprocess
import sys

AMARRA = "server/__tests__/credito-saiu-do-produto.test.ts"
CABECALHO = "server/__tests__/processos-cabecalho-enxuto.test.ts"
LIMITES = "server/__tests__/creditos-viram-limites.test.ts"

DB = "server/db.ts"
PROC = "server/routers/processos.ts"
ADMIN_SRV = "server/routers/admin.ts"
DASH = "server/routers/dashboard.ts"
CRONS = "server/_core/cron-jobs.ts"
CRONMON = "server/processos/cron-monitoramento.ts"
TELA = "client/src/pages/Processos.tsx"
GUARD = "client/src/components/SubscriptionGuard.tsx"
LAYOUT = "client/src/components/AppLayout.tsx"
DASHGERAL = "client/src/pages/dashboards/DashboardGeral.tsx"
ADMCLI = "client/src/pages/admin/AdminClients.tsx"
EDITOR = "client/src/pages/admin/AdminPlanoEditor.tsx"
BANCARIO = "client/src/pages/calculos/Bancario.tsx"
SHAREDLIM = "shared/limites-uso.ts"
MIG = "drizzle/0229_cartao_sem_ponto_da_equipe.sql"

# (nome, arquivo, de, para, teste)
MUTACOES = [
    ("a função volta a se chamar consumirCredito", DB,
     "export async function contarCalculoNoMes", "export async function consumirCredito", AMARRA),
    ("o cálculo para de conferir o teto do mês", DB,
     'const aval = await verificarUso(esc.escritorio.id, "calculo");', "const aval = { permitido: true };", AMARRA),
    ("a mensagem volta a mandar comprar crédito", "server/calculos/router-financiamento.ts",
     '"Você atingiu o limite de cálculos do seu plano neste mês. Fale com a gente pra liberar mais ou trocar de plano."',
     '"Seus créditos acabaram. Adquira mais créditos ou faça upgrade do seu plano."', AMARRA),
    ("o teto de cálculo deixa de sair do campo do plano", SHAREDLIM,
     'calculo: "creditosCalculosMes"', 'calculo: "maxResumosIaMes"', AMARRA),
    ("o painel volta a rotular o campo como crédito", EDITOR,
     'label="Cálculos por mês"', 'label="Créditos cálculo/mês"', AMARRA),

    ("a procedure de saldo volta ao router de processos", PROC,
     "export const processosRouter = router({",
     "export const processosRouter = router({\n  saldo: protectedProcedure.query(async () => ({ saldo: 0 })),", AMARRA),
    ("conceder créditos volta ao painel", ADMIN_SRV,
     "  aumentarLimiteDoMes: adminProcedure",
     "  concederCreditos: adminProcedure.mutation(async () => ({ ok: true })),\n\n  aumentarLimiteDoMes: adminProcedure", AMARRA),
    ("a procedure de créditos volta ao dashboard", DASH,
     "  usoDoMes: protectedProcedure",
     "  credits: protectedProcedure.query(async () => ({ creditsRemaining: 0 })),\n\n  usoDoMes: protectedProcedure", AMARRA),
    ("o substituto do teto some do router de processos", PROC,
     "consumirUso", "naoContaNada", AMARRA),
    ("o substituto de 'dar créditos' some do painel", ADMIN_SRV,
     "  aumentarLimiteDoMes: adminProcedure", "  aumentarLimiteDoMesRemovido: adminProcedure", AMARRA),

    ("o cron que pausa monitoramento por saldo volta", CRONMON,
     "/**\n * Cron de poll pra monitoramentos tipo \"novas_acoes\".",
     "export async function cobrarMonitoramentosMensais(): Promise<void> {\n  return;\n}\n\n/**\n * Cron de poll pra monitoramentos tipo \"novas_acoes\".", AMARRA),
    ("a agenda da cobrança volta aos crons", CRONS,
     "export function iniciarJobs() {",
     "export function iniciarJobs() {\n  // cobrarMonitoramentosMensais", AMARRA),
    ("o reset de cota mensal volta aos crons", CRONS,
     "export function iniciarJobs() {",
     "export function iniciarJobs() {\n  // resetCotaMensalEscritorios", AMARRA),
    ("a vaga do plano deixa de barrar monitoramento", PROC,
     "verificarLimiteMonitoramentos(", "naoVerificaVaga(", AMARRA),

    ("crédito volta a ser porta de acesso no guard", GUARD,
     "const hasAccess = !!subscription;",
     "const hasCredits = false;\n  const hasAccess = !!subscription || hasCredits;", AMARRA),
    ("crédito volta a destrancar o menu", LAYOUT,
     "const itemsLocked = isUser && subFetched && !hasSubscription;",
     "const hasCredits = false;\n  const itemsLocked = isUser && subFetched && !hasSubscription && !hasCredits;", AMARRA),

    ("o aviso de saldo baixo volta à tela de Processos", TELA,
     "      <Tabs value={tab} onValueChange={setTab}>",
     "      <span>Saldo baixo. Para comprar mais créditos, entre em contato.</span>\n      <Tabs value={tab} onValueChange={setTab}>", CABECALHO),
    ("o texto de custo em crédito volta à tela de Processos", TELA,
     "Consulta direta por número do processo", "Custo: 1 crédito — consulta direta", AMARRA),
    ("a barra de saldo volta ao Dashboard", DASHGERAL,
     "  const { data: r } = trpc.dashboard.resumoEscritorio.useQuery(undefined, {",
     "  const percentCreditos = 0;\n  const { data: r } = trpc.dashboard.resumoEscritorio.useQuery(undefined, {", AMARRA),
    ("o Dashboard perde o substituto (uso do mês)", DASHGERAL,
     "<UsoDoMes titulo=\"\" />", "<div />", AMARRA),
    ("conceder créditos volta à tela do painel", ADMCLI,
     "  const bloquearMut = trpc.admin.bloquearUsuario.useMutation({",
     "  const concederCreditos = 1;\n  const bloquearMut = trpc.admin.bloquearUsuario.useMutation({", AMARRA),
    ("o texto 'consome 1 crédito' volta ao cálculo bancário", BANCARIO,
     "Conta no limite de cálculos do mês", "Consome 1 crédito do seu plano", AMARRA),

    # A distinção que uma varredura cega destruiria.
    ("a varredura cega leva 'Crédito Pessoal' do módulo bancário junto", BANCARIO,
     'label: "Crédito Pessoal"', 'label: "Pessoal"', AMARRA),
    ("a varredura cega leva 'Cartão de crédito' do Financeiro junto",
     "client/src/pages/financeiro/FiltrosAtribuir.tsx",
     'label: "Cartão de crédito"', 'label: "Cartão"', AMARRA),

    ("a tabela de histórico é apagada por migration", MIG,
     "UPDATE planos", "DROP TABLE escritorio_creditos;\nUPDATE planos", LIMITES),
    ("a migration mexe na cesta do plano", MIG,
     "UPDATE planos\nSET features",
     "UPDATE planos SET modulos_liberados = JSON_ARRAY('dashboard');\nUPDATE planos\nSET features", AMARRA),
    ("a migration troca por posição em vez de por texto", MIG,
     "JSON_SEARCH(features, 'one', 'Comissões automáticas por colaborador e ponto da equipe')",
     "'$[2]'", AMARRA),
    ("o texto do Ponto volta ao cartão", MIG,
     "'Comissões automáticas por colaborador'\n    )",
     "'Comissões automáticas por colaborador e ponto da equipe'\n    )", AMARRA),
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
