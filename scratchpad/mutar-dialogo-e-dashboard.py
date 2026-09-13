#!/usr/bin/env python3
"""
Mutação das amarras do retorno do teste de uso do dono (13/09): o diálogo de
credencial que cabe na tela, o campo que pede só CPF, e o Dashboard que parou
de ensinar a usar.

Uso: python3 scratchpad/mutar-dialogo-e-dashboard.py
"""
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent

T_DIALOGO = "server/__tests__/dialogo-credencial-cabe-na-tela.test.ts"
T_PASSOS = "server/__tests__/primeiros-passos.test.ts"

PROCESSOS = "client/src/pages/Processos.tsx"
MANUAL = "client/src/pages/ajuda/tarefas.ts"
DASH = "client/src/pages/Dashboard.tsx"
AJUDA = "client/src/pages/Ajuda.tsx"

MUTACOES = [
    ("o diálogo perde o teto de altura (título sai da tela)",
     PROCESSOS,
     '<DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">',
     '<DialogContent className="max-w-md overflow-y-auto">',
     [T_DIALOGO]),
    ("o diálogo perde a rolagem (botões saem da tela)",
     PROCESSOS,
     '<DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">',
     '<DialogContent className="max-w-md max-h-[90vh]">',
     [T_DIALOGO]),
    ("o campo volta a pedir CPF ou OAB",
     PROCESSOS,
     "<Label>CPF *</Label>",
     "<Label>CPF ou OAB *</Label>",
     [T_DIALOGO]),
    ("o exemplo do campo volta a sugerir OAB",
     PROCESSOS,
     'placeholder="12345678900"',
     'placeholder="12345678900 ou SP123456"',
     [T_DIALOGO]),
    ("o manual e a tela voltam a discordar do rótulo",
     MANUAL,
     "informe «CPF» e «Senha»",
     "informe «CPF ou OAB» e «Senha»",
     [T_DIALOGO]),
    ("o card de ensinar volta pro Dashboard",
     DASH,
     "    return <DashboardComTabs setorTipoInicial={setorTipo} setorNome={setorNome} />;",
     "    return (<div className=\"space-y-4\">{isDono && <PrimeirosPassos />}<DashboardComTabs setorTipoInicial={setorTipo} setorNome={setorNome} /></div>);",
     [T_PASSOS]),
    ("o import do card volta pro Dashboard",
     DASH,
     'import DashboardProcessual from "./dashboards/DashboardProcessual";',
     'import DashboardProcessual from "./dashboards/DashboardProcessual";\nimport PrimeirosPassos from "./dashboards/PrimeirosPassos";',
     [T_PASSOS]),
    ("o conteúdo some da Central de ajuda junto (aí seria apagar, não remover da tela)",
     AJUDA,
     "      <PrimeirosPassosResumo />",
     "",
     [T_PASSOS]),
]


def roda(testes):
    r = subprocess.run(
        ["pnpm", "vitest", "run", *testes],
        cwd=RAIZ, capture_output=True, text=True,
    )
    return r.returncode == 0


def main():
    vivos = []
    for i, (rotulo, arquivo, de, para, testes) in enumerate(MUTACOES, 1):
        p = RAIZ / arquivo
        original = p.read_text()
        if de not in original:
            print(f"{i:2}. ⚠  ALVO NÃO ENCONTRADO — {rotulo} (em {arquivo})")
            vivos.append(rotulo)
            continue
        p.write_text(original.replace(de, para, 1))
        try:
            passou = roda(testes)
        finally:
            p.write_text(original)
        if passou:
            print(f"{i:2}. ✗  SOBREVIVEU — {rotulo}")
            vivos.append(rotulo)
        else:
            print(f"{i:2}. ✓  vermelho — {rotulo}")

    print()
    if vivos:
        print(f"{len(vivos)} de {len(MUTACOES)} mutações sobreviveram:")
        for v in vivos:
            print(f"  - {v}")
        sys.exit(1)
    print(f"Todas as {len(MUTACOES)} mutações ficaram vermelhas.")


if __name__ == "__main__":
    main()
