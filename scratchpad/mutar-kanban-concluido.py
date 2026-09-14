#!/usr/bin/env python3
import subprocess, shutil, sys, os
R="/home/user/jurify"
F="server/escritorio/kanban-filtros.ts"; RK="server/escritorio/router-kanban.ts"
M="drizzle/0231_kanban_concluido_em.sql"; B="client/src/pages/kanban/filtros-bar.tsx"
MUT=[
 (F,'const coluna = porConclusao ? kanbanCards.concluidoEm : kanbanCards.createdAt;','const coluna = kanbanCards.createdAt;',"filtro ignora a data de conclusao"),
 (F,'const coluna = porConclusao ? kanbanCards.concluidoEm : kanbanCards.createdAt;','const coluna = kanbanCards.concluidoEm;',"filtro usa conclusao ate quando pediram criacao"),
 (F,'if (porConclusao && (filtros.dataInicio || filtros.dataFim)) {','if (false) {',"card sem data de conclusao deixa de ser excluido"),
 (F,'const porConclusao = filtros.campoData === "concluido";','const porConclusao = true;',"campoData deixa de decidir"),
 (RK,'const concluidoEm = destino.tipo === "conclusao" ? new Date() : null;','const concluidoEm = destino.tipo === "conclusao" ? new Date() : undefined;',"sair da conclusao nao limpa a data"),
 (RK,'ordem: ordemFinal, atrasado, concluidoEm }','ordem: ordemFinal, atrasado }',"o UPDATE do mover perde o campo"),
 (RK,'concluidoEm: colunaAlvo.tipo === "conclusao" ? new Date() : null,','',"criarCard deixa de gravar"),
 (RK,'select({ id: kanbanColunas.id, tipo: kanbanColunas.tipo })','select({ id: kanbanColunas.id })',"coluna alvo do criarCard perde o tipo"),
 (RK,'" (por conclusão)" : " (por criação)"','"" : ""',"PDF deixa de dizer qual data"),
 (M,'MAX(m.createdAtKMov)','MIN(m.createdAtKMov)',"passado usa a PRIMEIRA conclusao"),
 (M,'SET c.concluidoEmKCard = NULL','SET c.concluidoEmKCard = c.createdAtKCard',"zeragem vira preenchimento"),
 (M,'SET c.concluidoEmKCard = c.createdAtKCard\nWHERE kc.tipoKC = \'conclusao\' AND c.concluidoEmKCard IS NULL;','SET c.concluidoEmKCard = NULL\nWHERE kc.tipoKC = \'conclusao\' AND c.concluidoEmKCard IS NULL;',"card sem historico fica de fora"),
 (B,'campoData: temPeriodo && campoLocal === "concluido" ? "concluido" : undefined','campoData: campoLocal === "concluido" ? "concluido" : undefined',"grava campoData sem periodo"),
 (B,'<SelectItem value="concluido">Conclusão do card</SelectItem>','',"tira a opcao da tela"),
]
T=["server/__tests__/kanban-filtro-concluido-em.test.ts"]
falhas=0
for arq,de,para,nome in MUT:
    p=os.path.join(R,arq); shutil.copy(p,p+".bak")
    src=open(p,encoding="utf8").read()
    if de not in src:
        print(f"PULOU (nao achou) · {nome}"); falhas+=1; os.remove(p+".bak"); continue
    open(p,"w",encoding="utf8").write(src.replace(de,para,1))
    r=subprocess.run(["pnpm","vitest","run",*T],cwd=R,capture_output=True,text=True)
    shutil.move(p+".bak",p)
    print(("SOBREVIVEU · " if r.returncode==0 else "morreu     · ")+nome)
    if r.returncode==0: falhas+=1
print(f"\n{len(MUT)-falhas}/{len(MUT)} mutacoes vermelhas")
sys.exit(1 if falhas else 0)
