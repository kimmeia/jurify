#!/usr/bin/env python3
"""Mutações de `telas-cabem-no-celular.test.ts`: quebra cada conserto de
largura e exige que o teste fique VERMELHO. Teste de texto que não acusa a
remoção da classe que ele diz guardar não guarda nada."""
import subprocess, sys
from pathlib import Path

RAIZ = Path("/home/user/jurify")
P = RAIZ / "client/src/pages"

MUTACOES = [
    ("Dashboard: tira sem rolagem", P / "Dashboard.tsx",
     'className="inline-flex max-w-full overflow-x-auto rounded-md border bg-muted p-1.5"',
     'className="inline-flex rounded-md border bg-muted p-1.5"'),
    ("Dashboard: tira sem max-w-full", P / "Dashboard.tsx",
     "inline-flex max-w-full overflow-x-auto rounded-md",
     "inline-flex overflow-x-auto rounded-md"),
    ("Financeiro: régua sem rolagem", P / "Financeiro.tsx",
     "inline-flex max-w-full overflow-x-auto gap-1 rounded-xl",
     "inline-flex max-w-full gap-1 rounded-xl"),
    ("Financeiro: régua sem max-w-full", P / "Financeiro.tsx",
     "inline-flex max-w-full overflow-x-auto gap-1 rounded-xl",
     "inline-flex overflow-x-auto gap-1 rounded-xl"),
    ("Financeiro: KPI volta a 2 colunas no celular", P / "Financeiro.tsx",
     "grid-cols-1 sm:grid-cols-2", "grid-cols-2"),
    ("Financeiro: tabela sem moldura que role", P / "Financeiro.tsx",
     '<div className="border rounded-lg overflow-x-auto">',
     '<div className="border rounded-lg">'),
    ("Processos: ações sem quebra", P / "Processos.tsx",
     'className="flex items-center gap-2 flex-wrap justify-end"',
     'className="flex items-center gap-2 shrink-0"'),
    ("Tarefas: filtros sem quebra", P / "Tarefas.tsx",
     'className="flex gap-2 items-center flex-wrap"',
     'className="flex gap-2 items-center"'),
    ("Tarefas: grupo de filtros sem quebra própria", P / "Tarefas.tsx",
     'className="flex flex-wrap gap-1 max-w-full"',
     'className="flex gap-1"'),
    ("Tarefas: linha de apoio volta a se sobrepor", P / "Tarefas.tsx",
     'className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground mt-0.5"',
     'className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5"'),
    ("Acordos: grid sem coluna no celular", P / "Acordos.tsx",
     'className="grid gap-3.5 grid-cols-1 lg:grid-cols-3"',
     'className="grid gap-3.5 lg:grid-cols-3"'),
    ("Acordos: item sem min-w-0", P / "Acordos.tsx",
     'className="lg:col-span-2 min-w-0"', 'className="lg:col-span-2"'),
    ("Agenda: pílula sem largura da calha", P / "Agenda.tsx",
     "-translate-y-1/2 w-12 flex flex-col items-center",
     "-translate-y-1/2 flex flex-col items-center"),
    ("Agenda: pílula volta a uma linha", P / "Agenda.tsx",
     "w-12 flex flex-col items-center leading-tight",
     "w-12 flex items-center leading-tight"),
    ("Movimentações: coluna do nome volta a 220px fixos", P / "Movimentacoes.tsx",
     'className="w-[220px] lg:w-[300px] xl:w-[380px] shrink-0 min-w-0"',
     'className="w-[220px] shrink-0 min-w-0"'),
]

def roda():
    r = subprocess.run(
        ["npx", "vitest", "run", "server/__tests__/telas-cabem-no-celular.test.ts"],
        cwd=RAIZ, capture_output=True, text=True)
    return r.returncode != 0

vivas = []
for nome, arq, de, para in MUTACOES:
    original = arq.read_text(encoding="utf8")
    if de not in original:
        print(f"?? {nome}: âncora não encontrada — mutação inválida")
        vivas.append(nome)
        continue
    arq.write_text(original.replace(de, para, 1), encoding="utf8")
    vermelho = roda()
    arq.write_text(original, encoding="utf8")
    print(("ok " if vermelho else "VIVA ") + nome)
    if not vermelho:
        vivas.append(nome)

print(f"\n{len(MUTACOES) - len(vivas)}/{len(MUTACOES)} vermelhas")
sys.exit(1 if vivas else 0)
