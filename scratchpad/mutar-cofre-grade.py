#!/usr/bin/env python3
import subprocess, shutil, sys, os
R = "/home/user/jurify"
G = "client/src/components/GradeTribunais.tsx"
P = "client/src/pages/Processos.tsx"
MUT = [
 (G, "grid-cols-[repeat(auto-fill,minmax(186px,1fr))]", "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3", "volta a grade de 3 colunas empilhadas"),
 (G, " [&>*]:min-w-0", "", "tira o min-w-0 dos itens"),
 (G, "grid-cols-[repeat(auto-fill,minmax(186px,1fr))]", "flex flex-col", "troca a grade por pilha"),
 (P, 'c.sistema === SISTEMA_NACIONAL ? "md:col-span-2 lg:col-span-3" : ""', '""', "cartao nacional volta a 1/3 da largura"),
 (G, "{erro}\n                      </pre>", "{/* cru removido */}\n                      </pre>", "some com o texto cru do erro"),
 (G, "const r = resumirErroCofre(erro);", "const r = null;", "deixa de resumir o erro"),
]
T = ["server/__tests__/telas-cabem-no-celular.test.ts", "server/__tests__/cofre-erros.test.ts"]
falhas = 0
for arq, de, para, nome in MUT:
    p = os.path.join(R, arq); shutil.copy(p, p + ".bak")
    src = open(p, encoding="utf8").read()
    if de not in src:
        print(f"PULOU (não achou) · {nome}"); falhas += 1; os.remove(p + ".bak"); continue
    open(p, "w", encoding="utf8").write(src.replace(de, para, 1))
    r = subprocess.run(["pnpm", "vitest", "run", *T], cwd=R, capture_output=True, text=True)
    shutil.move(p + ".bak", p)
    print(("SOBREVIVEU · " if r.returncode == 0 else "morreu     · ") + nome)
    if r.returncode == 0: falhas += 1
print(f"\n{len(MUT)-falhas}/{len(MUT)} mutações vermelhas")
sys.exit(1 if falhas else 0)
