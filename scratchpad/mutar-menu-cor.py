#!/usr/bin/env python3
"""Quebra o código de propósito e confere que a amarra fica VERMELHA."""
import subprocess, pathlib, sys
RAIZ = pathlib.Path(".")
CSS = RAIZ/"client/src/index.css"; MJ = RAIZ/"client/src/components/MarcaJ.tsx"
MUT = [
 ("menu volta pro azul-ardosia antigo", CSS, "--sidebar: oklch(0.254 0.044 272);", "--sidebar: oklch(0.240 0.027 253);"),
 ("menu vira roxo cheio (o tom recusado)", CSS, "--sidebar: oklch(0.254 0.044 272);", "--sidebar: oklch(0.205 0.090 296);"),
 ("menu escuro vira roxo cheio", CSS, "--sidebar: oklch(0.222 0.034 271);", "--sidebar: oklch(0.205 0.090 296);"),
 ("menu fica cinza sem cor", CSS, "--sidebar: oklch(0.254 0.044 272);", "--sidebar: oklch(0.254 0.005 272);"),
 ("menu deixa de ser escuro", CSS, "--sidebar: oklch(0.254 0.044 272);", "--sidebar: oklch(0.400 0.044 272);"),
 ("superficie do item aberto sai do navy", CSS, "--sidebar-accent: oklch(0.304 0.052 271);", "--sidebar-accent: oklch(0.304 0.052 296);"),
 ("realce do item volta a azul", CSS, "--sidebar-primary: oklch(0.70 0.170 293);", "--sidebar-primary: oklch(0.707 0.100 250);"),
 ("violeta da marca escurece demais", CSS, "--marca-em-escuro: oklch(0.66 0.20 293);", "--marca-em-escuro: oklch(0.556 0.25 296);"),
 ("violeta da marca vira azul", CSS, "--marca-em-escuro: oklch(0.66 0.20 293);", "--marca-em-escuro: oklch(0.66 0.20 250);"),
 ("acao do conteudo vira violeta", CSS, "--primary: oklch(0.413 0.112 255);", "--primary: oklch(0.413 0.112 296);"),
 ("Jurid volta a cinza", MJ, 'tom === "sidebar" ? "text-white"', 'tom === "sidebar" ? "text-sidebar-foreground"'),
 ("acento da marca passa a vir do menu", MJ, 'tom === "sidebar" ? "text-marca-em-escuro"', 'tom === "sidebar" ? "text-sidebar-primary"'),
 ("acento da marca vira cor cravada", MJ, 'tom === "sidebar" ? "text-marca-em-escuro"', 'tom === "sidebar" ? "text-[#a584ff]"'),
]
falhas = []
for nome, arq, de, para in MUT:
    orig = arq.read_text(encoding="utf-8")
    if de not in orig:
        falhas.append(nome + ": trecho nao encontrado"); continue
    arq.write_text(orig.replace(de, para, 1), encoding="utf-8")
    r = subprocess.run(["pnpm","vitest","run","server/__tests__/menu-cor-da-logo.test.ts"],
                       capture_output=True, text=True)
    arq.write_text(orig, encoding="utf-8")
    vermelho = "failed" in r.stdout or r.returncode != 0
    print(("VERMELHO " if vermelho else "PASSOU!! ") + nome)
    if not vermelho: falhas.append(nome)
print()
print(("%d mutacao(oes) sobreviveram: " % len(falhas)) + "; ".join(falhas) if falhas else "todas as %d mutacoes ficaram vermelhas" % len(MUT))
sys.exit(1 if falhas else 0)
