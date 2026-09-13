#!/usr/bin/env python3
"""Mutações: cada uma quebra o conserto e o teste TEM que ficar vermelho."""
import subprocess, shutil, sys, os

R = "/home/user/jurify"
MUT = [
  ("client/src/pages/Dashboard.tsx",
   "rounded-none border-0 border-b-2 border-transparent",
   "rounded-none border-b-2 border-transparent",
   "volta a borda de 1px nos quatro lados (o retângulo)"),
  ("client/src/pages/Dashboard.tsx",
   "data-[state=active]:border-b-foreground",
   "data-[state=active]:border-foreground",
   "pinta os quatro lados no estado ativo"),
  ("client/src/pages/Dashboard.tsx",
   "border-0 border-b-2 border-transparent",
   "border-0 border-transparent",
   "apaga o sublinhado da aba ativa"),
  ("client/src/pages/dashboards/DashboardComercial.tsx",
   'if (data.modo === "gestor" && !data.totais) {',
   'if (false && data.modo === "gestor" && !data.totais) {',
   "desliga a guarda do gestor sem totais"),
  ("client/src/pages/dashboards/DashboardComercial.tsx",
   '<Aviso texto=\'Nenhum colaborador está em um setor do tipo "Comercial" ainda. Crie o setor em Configurações → Equipe e vincule quem vende: os números aparecem aqui em seguida.\' />',
   '<div />',
   "troca o aviso por tela vazia"),
]
TESTES = ["server/__tests__/telas-cabem-no-celular.test.ts",
          "server/__tests__/painel-comercial-sem-setor.test.ts"]

falhas = 0
for arq, de, para, nome in MUT:
    p = os.path.join(R, arq)
    shutil.copy(p, p + ".bak")
    src = open(p, encoding="utf8").read()
    if de not in src:
        print(f"PULOU (não achou) · {nome}"); falhas += 1
        os.remove(p + ".bak"); continue
    open(p, "w", encoding="utf8").write(src.replace(de, para, 1))
    r = subprocess.run(["pnpm", "vitest", "run", *TESTES], cwd=R, capture_output=True, text=True)
    shutil.move(p + ".bak", p)
    if r.returncode == 0:
        print(f"SOBREVIVEU · {nome}"); falhas += 1
    else:
        print(f"morreu     · {nome}")
print(f"\n{len(MUT) - falhas}/{len(MUT)} mutações vermelhas")
sys.exit(1 if falhas else 0)
