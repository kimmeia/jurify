#!/usr/bin/env python3
import subprocess, shutil, sys, os
R="/home/user/jurify"; D="client/src/pages/Dashboard.tsx"; C="client/src/pages/dashboards/common.tsx"
FIN="client/src/pages/dashboards/DashboardFinanceiro.tsx"; COM="client/src/pages/dashboards/DashboardComercial.tsx"
MUT=[
 (D,'<div className="flex flex-wrap items-end gap-x-4 gap-y-2 border-b">','<div className="flex flex-wrap items-end gap-x-4 gap-y-2">',"tira a linha da fileira"),
 (D,'<BuscaDoTopo className="mb-2 w-full sm:w-auto" />','',"tira a busca da linha das abas"),
 (D,'className="mb-2 w-full sm:w-auto"','className="mb-2"',"busca deixa de ocupar a linha no celular"),
 (D,'<BuscaJaNoTopo.Provider value>','<BuscaJaNoTopo.Provider value={false}>',"deixa as duas buscas aparecerem"),
 (C,'{!buscaLaEmCima && <BuscaDoTopo />}','<BuscaDoTopo />',"PainelTopo volta a desenhar a sua busca sempre"),
 (C,'const buscaLaEmCima = useContext(BuscaJaNoTopo);','const buscaLaEmCima = false;',"ignora o aviso da regua de abas"),
 (FIN,'{/* A faixa de cartões de ação saiu daqui a pedido do dono (13/09).','{/* x */}<FaixaAcoes><AcaoCard /></FaixaAcoes>{/*',"cartoes voltam no Financeiro"),
 (COM,'{/* A faixa de cartões de ação saiu daqui a pedido do dono (13/09,','{/* x */}<AcaoCard />{/*',"cartao volta no Comercial"),
]
T=["server/__tests__/telas-cabem-no-celular.test.ts"]
falhas=0
for arq,de,para,nome in MUT:
    p=os.path.join(R,arq); shutil.copy(p,p+".bak")
    src=open(p,encoding="utf8").read()
    if de not in src:
        print(f"PULOU (não achou) · {nome}"); falhas+=1; os.remove(p+".bak"); continue
    open(p,"w",encoding="utf8").write(src.replace(de,para,1))
    r=subprocess.run(["pnpm","vitest","run",*T],cwd=R,capture_output=True,text=True)
    shutil.move(p+".bak",p)
    print(("SOBREVIVEU · " if r.returncode==0 else "morreu     · ")+nome)
    if r.returncode==0: falhas+=1
print(f"\n{len(MUT)-falhas}/{len(MUT)} mutações vermelhas")
sys.exit(1 if falhas else 0)
