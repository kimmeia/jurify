#!/usr/bin/env python3
import subprocess, shutil, sys, os
R="/home/user/jurify"; C="client/src/pages/Configuracoes.tsx"; M="client/src/components/logos-marcas.tsx"
MUT=[
 (C,'logo: <LogoWhatsApp className="h-8 w-8" />','logo: "💬"',"volta o emoji do WhatsApp"),
 (C,'logo: <LogoInstagram className="h-8 w-8" />','logo: "📸"',"volta o emoji do Instagram"),
 (C,'logo: <LogoOpenAI className="h-7 w-7" />','logo: "🤖"',"volta o emoji do ChatGPT"),
 (C,'Ou cadastrar WhatsApp Cloud manualmente (avançado)','Ou cadastrar manualmente',"muda o texto do caminho manual"),
 (C,'onClick={() => setManualWhatsappOpen(true)}','onClick={() => {}}',"tira o clique do caminho manual"),
 (C,'border bg-card flex items-center justify-center text-2xl shadow-sm','bg-gradient-to-br from-success to-success flex items-center justify-center text-2xl shadow-md',"volta o ladrilho degrade por cima da marca"),
 (M,'fill="#25D366"','fill="currentColor"',"marca com a cor do tema"),
 (M,'fill="url(#marca-instagram)"','fill="#E4405F"',"Instagram chapado, sem o degrade"),
]
T=["server/__tests__/logos-reais-nas-integracoes.test.ts"]
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
