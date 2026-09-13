#!/usr/bin/env python3
"""Mutações de `cor-do-menu.test.ts`: quebra a cor do menu de cada jeito
plausível e exige que o teste fique VERMELHO. Cor não quebra build nem
typecheck — se a amarra não acusa, ela não guarda nada."""
import subprocess, sys
from pathlib import Path

RAIZ = Path("/home/user/jurify")
CSS = RAIZ / "client/src/index.css"

MUTACOES = [
    ("tema claro volta pro roxo da logo",
     "  --sidebar: #07060f;\n  --sidebar-foreground: oklch(0.855",
     "  --sidebar: oklch(0.205 0.045 296);\n  --sidebar-foreground: oklch(0.855"),
    ("tema escuro diverge do claro",
     "  /* O mesmo fundo do tema claro: o menu é o mesmo objeto nos dois temas. */\n  --sidebar: #07060f;",
     "  --sidebar: oklch(0.165 0.038 296);"),
    ("alguém copia a transparência do Devular no tema claro",
     "  --sidebar: #07060f;\n  --sidebar-foreground: oklch(0.855",
     "  --sidebar: rgba(7,6,15,.8);\n  --sidebar-foreground: oklch(0.855"),
    ("cor quase certa, mas não a da marca",
     "  --sidebar: #07060f;\n  --sidebar-foreground: oklch(0.855",
     "  --sidebar: #0a0912;\n  --sidebar-foreground: oklch(0.855"),
    ("item ativo some no fundo do menu",
     "  --sidebar-accent: oklch(0.305 0.062 296);",
     "  --sidebar-accent: #07060f;"),
    ("texto do menu escurece e some",
     "  --sidebar-foreground: oklch(0.855 0.020 290);",
     "  --sidebar-foreground: oklch(0.30 0.020 290);"),
]


def roda():
    r = subprocess.run(
        ["npx", "vitest", "run", "server/__tests__/cor-do-menu.test.ts",
         "server/__tests__/menu-cor-da-logo.test.ts"],
        cwd=RAIZ, capture_output=True, text=True)
    return r.returncode != 0


vivas = []
for nome, de, para in MUTACOES:
    original = CSS.read_text(encoding="utf8")
    if de not in original:
        print(f"?? {nome}: âncora não encontrada")
        vivas.append(nome)
        continue
    CSS.write_text(original.replace(de, para, 1), encoding="utf8")
    vermelho = roda()
    CSS.write_text(original, encoding="utf8")
    print(("ok   " if vermelho else "VIVA ") + nome)
    if not vermelho:
        vivas.append(nome)

print(f"\n{len(MUTACOES) - len(vivas)}/{len(MUTACOES)} vermelhas")
sys.exit(1 if vivas else 0)
