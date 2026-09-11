#!/usr/bin/env python3
"""Confere a amarra da escala por mutação: quebra o código de propósito e
exige que `escala-tipografica.test.ts` fique VERMELHO em cada caso.

Teste que passa não prova nada; teste que fica vermelho quando o código
quebra, sim. Uso: python3 scratchpad/mockup-tipografia/mutar-escala.py
"""
import subprocess, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
TESTE = "server/__tests__/escala-tipografica.test.ts"

MUTACOES = [
    ("client/src/pages/Processos.tsx",
     'className="text-micro text-muted-foreground font-mono"',
     'className="text-[9px] text-muted-foreground font-mono"',
     "tamanho solto volta na tela migrada"),
    ("client/src/index.css", "--text-micro: 11px;", "--text-micro: 9px;",
     "degrau furando o piso de 11px"),
    ("client/src/index.css", "--text-apoio: 11.5px;", "--text-removido: 11.5px;",
     "degrau some do @theme"),
    ("client/src/pages/Processos.tsx",
     'rounded text-micro font-semibold bg-warning-bg text-warning-fg',
     'rounded text-micro font-semibold uppercase bg-warning-bg text-warning-fg',
     "selo da lista volta para caixa alta"),
    ("client/src/pages/Agenda.tsx", 'className="text-pagina',
     'className="text-[27px]', "título de página volta a tamanho solto"),
]

falhas = []
for rel, de, para, desc in MUTACOES:
    p = RAIZ / rel
    original = p.read_text(encoding="utf-8")
    if de not in original:
        falhas.append(f"ALVO NÃO ENCONTRADO: {desc} ({rel})")
        continue
    p.write_text(original.replace(de, para, 1), encoding="utf-8")
    try:
        r = subprocess.run(["pnpm", "vitest", "run", TESTE], cwd=RAIZ,
                           capture_output=True, text=True)
        vermelho = r.returncode != 0
    finally:
        p.write_text(original, encoding="utf-8")
    print(f"{'VERMELHO ok' if vermelho else 'VERDE  ►  FURO'}  {desc}")
    if not vermelho:
        falhas.append(desc)

print()
if falhas:
    print("A amarra NÃO pega:", *falhas, sep="\n  - ")
    sys.exit(1)
print(f"{len(MUTACOES)} mutações, todas vermelhas.")
