#!/usr/bin/env python3
"""Mutações de `central-de-ajuda.test.ts`: quebra o manual de cada jeito que
ele poderia mentir (rota errada, botão inventado, print que não existe,
Central atrás do porteiro, botão Ajuda sumido, segunda lista de tarefas…) e
exige que o teste fique VERMELHO. Aplica → roda → restaura, uma por vez."""
import subprocess, sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
C = RAIZ / "client/src"
T = C / "pages/ajuda/tarefas.ts"
LAYOUT = C / "components/AppLayout.tsx"
APP = C / "App.tsx"
PAG = C / "pages/ajuda/AjudaTarefa.tsx"
HOME = C / "pages/Ajuda.tsx"
CONF = C / "pages/Configuracoes.tsx"
PROC = C / "pages/Processos.tsx"
SEED = RAIZ / "scratchpad/estudo-telas/povoar.sql"

MUTACOES = [
    ("rota de «Abrir a tela» que não existe no App.tsx", T,
     'rota: "/processos?tab=movimentacoes"', 'rota: "/processoss?tab=movimentacoes"'),
    ("rota com ?tab= que a tela não lê", T,
     'abrirTela: { rota: "/financeiro", rotulo: "Financeiro" }',
     'abrirTela: { rota: "/financeiro?tab=cobrancas", rotulo: "Financeiro" }'),
    ("rótulo inventado no passo (botão que a tela não tem)", T,
     "«Cadastrar e testar login»", "«Testar login»"),
    ("rótulo inventado no «se não deu certo»", T,
     "clique em «Validar» na credencial", "clique em «Testar login» na credencial"),
    ("print referenciado que não existe", T,
     '"/ajuda/vigiar-processo-2.png"', '"/ajuda/vigiar-processo-9.png"'),
    ("tarefa ligada que não existe", T,
     '"descobrir-acoes-novas-cpf", "cadastrar-cliente"', '"descobrir-acoes-novas", "cadastrar-cliente"'),
    ("tarefa completa com campo obrigatório vazio", T,
     'tempo: "5 min"', 'tempo: ""'),
    ("uma das cinco vira «em breve»", T,
     'id: "convidar-equipe",\n    titulo: "Convidar alguém e dar permissões",\n    grupo: "Gestão",',
     'id: "convidar-equipe",\n    titulo: "Convidar alguém e dar permissões",\n    grupo: "Gestão",\n    emBreve: true as const,'),
    ("grupos fora da ordem do menu", T,
     '["Dia a dia", "Carteira", "Ferramentas", "Gestão"]', '["Dia a dia", "Carteira", "Gestão", "Ferramentas"]'),
    ("botão Ajuda sem o ícone", LAYOUT,
     '<CircleHelp className="h-3.5 w-3.5 shrink-0" />\n                <span className="group-data-[collapsible=icon]:hidden">Ajuda</span>',
     '<span className="group-data-[collapsible=icon]:hidden">Ajuda</span>'),
    ("botão Ajuda passa a bloquear quem não tem plano", LAYOUT,
     'onClick={() => setLocation("/ajuda")}\n                title="Central de ajuda"',
     'onClick={() => navigateOrBlock("/ajuda")}\n                title="Central de ajuda"'),
    ("botão Ajuda removido do rodapé", LAYOUT,
     'aria-label="Ajuda"', 'aria-label="Ajudar"'),
    ("modo atendimento (celular) joga /ajuda de volta", LAYOUT,
     ' || location.startsWith("/ajuda");', ';'),
    ("item Ajuda removido do menu do avatar (celular)", LAYOUT,
     '<DropdownMenuItem onClick={() => setLocation("/ajuda")} className="cursor-pointer">\n'
     '                    <CircleHelp className="mr-2 h-4 w-4" />\n'
     '                    <span>Ajuda</span>\n'
     '                  </DropdownMenuItem>\n', ''),
    ("/ajuda atrás do porteiro de módulo e da guarda de assinatura", APP,
     '<Route path="/ajuda">\n        <ClientAreaSoTermos>\n          <Ajuda />\n        </ClientAreaSoTermos>',
     '<Route path="/ajuda">\n        <ClientArea>\n          <Ajuda />\n        </ClientArea>'),
    ("/ajuda/:tarefa atrás do porteiro", APP,
     '<Route path="/ajuda/:tarefa">\n        <ClientAreaSoTermos>',
     '<Route path="/ajuda/:tarefa">\n        <ClientArea>'),
    ("/ajuda volta pro ClientAreaNoGuard (sem o gate dos Termos)", APP,
     '<Route path="/ajuda">\n        <ClientAreaSoTermos>\n          <Ajuda />\n        </ClientAreaSoTermos>',
     '<Route path="/ajuda">\n        <ClientAreaNoGuard>\n          <Ajuda />\n        </ClientAreaNoGuard>'),
    ("/ajuda/:tarefa volta pro ClientAreaNoGuard", APP,
     '<Route path="/ajuda/:tarefa">\n        <ClientAreaSoTermos>\n          <AjudaTarefa />\n        </ClientAreaSoTermos>',
     '<Route path="/ajuda/:tarefa">\n        <ClientAreaNoGuard>\n          <AjudaTarefa />\n        </ClientAreaNoGuard>'),
    ("ClientAreaSoTermos sem o TermosGate", APP,
     "    <AppLayout>\n      <TermosGate />\n      {children}\n    </AppLayout>",
     "    <AppLayout>\n      {children}\n    </AppLayout>"),
    ("ClientAreaSoTermos ganha a guarda de assinatura", APP,
     "      <TermosGate />\n      {children}\n    </AppLayout>",
     "      <TermosGate />\n      <SubscriptionGuard>{children}</SubscriptionGuard>\n    </AppLayout>"),
    ("«?» de Processos aponta pra tarefa «em breve»", C / "pages/Processos.tsx",
     'tarefa="vigiar-processo"', 'tarefa="mover-caso-kanban"'),
    ("«?» sumiu do Financeiro", C / "pages/Financeiro.tsx",
     '<AjudaDaTela tarefa="cobrar-cliente" />', ''),
    ("«?» sem link pra tarefa", C / "components/AjudaDaTela.tsx",
     "href={`/ajuda/${tarefa}`}", "href={`/ajuda`}"),
    ("static de produção volta a redirecionar /ajuda pra /ajuda/", RAIZ / "server/_core/vite.ts",
     "express.static(distPath, { redirect: false })", "express.static(distPath)"),
    ("número do WhatsApp cravado na Central", HOME,
     "https://wa.me/${whatsapp}", "https://wa.me/5585991080343"),
    ("segunda lista de tarefas fora de tarefas.ts", HOME,
     "export default function Ajuda() {",
     'const TAREFAS_LOCAL = [{ titulo: "Vigiar um processo" }];\nexport default function Ajuda() {'),
    ("hook depois do return antecipado (React #310)", PAG,
     '  const contratados = useModulosContratados();\n  const tarefa = tarefaPorId(params.tarefa ?? "");\n\n  if (!tarefa) return <TarefaNaoEncontrada />;',
     '  const tarefa = tarefaPorId(params.tarefa ?? "");\n\n  if (!tarefa) return <TarefaNaoEncontrada />;\n  const contratados = useModulosContratados();'),
    ("aviso de módulo definido mas não renderizado", PAG,
     "{semModulo && <AvisoModulo modulos={modulosDaTela} />}", ""),
    ("aviso de módulo vira bloqueio (sai antes dos passos)", PAG,
     "const semModulo = modulosDaTela.length > 0 && !contratoLibera(contratados, modulosDaTela);",
     "const semModulo = modulosDaTela.length > 0 && !contratoLibera(contratados, modulosDaTela);\n"
     "  if (semModulo) return <AvisoModulo modulos={modulosDaTela} />;"),
    ("gate da página ignora a régua da rota (volta ao `modulo` solto)", PAG,
     "const modulosDaTela = modulosQueLiberam(tarefa);",
     "const modulosDaTela = tarefa.modulo ? [tarefa.modulo] : [];"),
    ("modulosQueLiberam ignora o ModuloGuard (cadastrar-cliente 'bloqueado' no só-processos)", T,
     "return modulosDaRota(t.abrirTela.rota) ?? (t.modulo ? [t.modulo] : []);",
     "return t.modulo ? [t.modulo] : [];"),
    ("modulosQueLiberam ignora o módulo declarado (WhatsApp sem aviso em plano sem atendimento)", T,
     "return modulosDaRota(t.abrirTela.rota) ?? (t.modulo ? [t.modulo] : []);",
     "return modulosDaRota(t.abrirTela.rota) ?? [];"),
    ("`modulo` da tarefa que não libera a rota dela (cadastrar-cliente → financeiro)", T,
     'modulo: "clientes",', 'modulo: "financeiro",'),
    ("`modulo` da tarefa de rota sem regra trocado (conectar-whatsapp → financeiro)", T,
     'modulo: "atendimento",', 'modulo: "financeiro",'),
    # ── o que a revisão pegou ──
    ("link da home leva ao GRUPO (todas caem em «Esta tarefa não existe»)", HOME,
     "href={`/ajuda/${tarefa.id}`}", "href={`/ajuda/${tarefa.grupo}`}"),
    ("link de «Tarefas ligadas» leva ao grupo", PAG,
     "href={`/ajuda/${t.id}`}", "href={`/ajuda/${t.grupo}`}"),
    ("?tab= com valor que a tela não tem (Processos cai em «central» em silêncio)", T,
     'rota: "/processos?tab=movimentacoes"', 'rota: "/processos?tab=movimentacoess"'),
    ("«Ver meu plano» aponta pra aba que não existe", PAG,
     'setLocation("/configuracoes?tab=meu-plano")', 'setLocation("/configuracoes?tab=plano")'),
    ("«Ver meu plano» aponta pra rota que não existe", PAG,
     'setLocation("/configuracoes?tab=meu-plano")', 'setLocation("/configuracao?tab=meu-plano")'),
    ("print nunca renderizado (os PNG viram peso morto)", PAG,
     "{(passo.print || i === 0) && <Print src={passo.print} alt={`Tela real: ${passo.titulo}`} />}",
     "{false && <Print src={passo.print} alt={`Tela real: ${passo.titulo}`} />}"),
    ("<img> do print sem o src", PAG,
     "      src={src}\n      alt={alt}", "      src={alt}\n      alt={alt}"),
    ("chip «vídeo: em breve» removido do cabeçalho", PAG,
     '              <span className="inline-flex items-center gap-1.5">\n'
     '                <Clapperboard className="h-3.5 w-3.5" />\n'
     '                vídeo:\n'
     '                <Badge variant="secondary" className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">em breve</Badge>\n'
     '              </span>\n', ''),
    ("chip de vídeo vira link", PAG,
     '                vídeo:\n                <Badge', '                <Link href="/ajuda">vídeo:</Link>\n                <Badge'),
    ("«?» de Canais volta pro banner", CONF,
     '          <h3 className="text-base font-bold tracking-tight flex items-center gap-1.5">\n'
     '            Canais de comunicação\n'
     '            <AjudaDaTela tarefa="conectar-whatsapp" />\n'
     '          </h3>',
     '          <h3 className="text-base font-bold tracking-tight">Canais de comunicação</h3>'),
    ("manual volta a prometer «sem risco de banimento»", T,
     "com 1 clique — sem copiar tokens. Respeite", "com 1 clique — sem copiar tokens e sem risco de banimento. Respeite"),
    ("passo 2 de «Vigiar» cita rótulo que o diálogo de CNJ não tem", T,
     "oferece o botão de avisar quando o tribunal chegar", "oferece «Avisar quando chegar»"),
    ("botão do diálogo de CNJ perde a sigla (e o manual fica falando de outro botão)", PROC,
     "Avisar quando o {tribunalForaDaCobertura.sigla} chegar", "Avisar quando chegar"),
    ("rótulo citado que só existe em comentário", PROC,
     '"Cadastrar e testar login"', '"Cadastrar e testar" /* Cadastrar e testar login */'),
    ("seed dos prints com o número real de volta", SEED,
     "telefoneContato='(85) 99999-0001'", "telefoneContato='(85) 99796-5706'"),
]


def roda():
    r = subprocess.run(
        ["npx", "vitest", "run", "server/__tests__/central-de-ajuda.test.ts"],
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
    try:
        vermelho = roda()
    finally:
        arq.write_text(original, encoding="utf8")
    print(("ok " if vermelho else "VIVA ") + nome)
    if not vermelho:
        vivas.append(nome)

print(f"\n{len(MUTACOES) - len(vivas)}/{len(MUTACOES)} vermelhas")
sys.exit(1 if vivas else 0)
