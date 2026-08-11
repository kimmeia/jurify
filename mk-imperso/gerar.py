"""
Mockup em HTML da faixa de impersonação.

CSS compilado do próprio app, embutido no arquivo — abre em qualquer navegador
sem servidor e sem depender de nada externo.
"""
import pathlib

AQUI = pathlib.Path(__file__).parent
CSS = pathlib.Path("dist/public/assets/index-DIlzSGA2.css").read_text(encoding="utf-8")


def ico(d, tam=14):
    return (f'<svg width="{tam}" height="{tam}" viewBox="0 0 24 24" fill="none" class="shrink-0">'
            f'<path d="{d}" stroke="currentColor" stroke-width="2" stroke-linecap="round" '
            'stroke-linejoin="round"/></svg>')


D_CADEADO = "M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z"
D_OLHO = "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"
D_VOLTAR = "M19 12H5M11 18l-6-6 6-6"
D_RELOGIO = "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"
D_ESCUDO = "M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6z"


# ── A faixa atual, pra comparação ────────────────────────────────────────────
ATUAL = f"""
<div class="bg-amber-500 text-amber-950 px-4 py-2.5 flex items-center justify-between gap-3 border-b border-amber-600 shadow-md">
  <div class="flex items-center gap-2 text-sm font-medium">
    {ico(D_CADEADO, 16)}
    <span>Você está vendo o sistema como <strong>Bruno Boyadjian</strong> — toda ação é registrada em nome do admin original.</span>
  </div>
  <button class="bg-white hover:bg-amber-50 border border-amber-700 text-amber-950 h-8 text-xs font-medium rounded-md px-3 inline-flex items-center gap-1.5 shrink-0">
    {ico(D_VOLTAR, 13)} Sair da impersonação
  </button>
</div>
"""


# ── A faixa proposta ─────────────────────────────────────────────────────────
def proposta(nome="Bruno Boyadjian", escritorio="Boyadjian Advogados", restante="47 min"):
    return f"""
<div class="flex items-stretch border-b border-amber-300 bg-amber-50 dark:border-amber-900/70 dark:bg-amber-950/40">
  <!-- Faixa sólida estreita: o sinal de "atenção" fica aqui, e não no fundo
       inteiro. Some do caminho sem sumir do olho. -->
  <span class="w-1 shrink-0 bg-amber-500"></span>
  <!-- Uma linha só, sem quebra. Duas linhas devolveriam a altura que a faixa
       antiga tinha, que é justamente o problema. O que não couber some por
       ordem de importância — auditoria, depois escritório, depois o relógio. -->
  <div class="flex min-w-0 flex-1 flex-nowrap items-center gap-x-2.5 px-3 py-1.5">
    <span class="hidden shrink-0 items-center gap-1.5 rounded border border-amber-400/60 bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-amber-900 sm:inline-flex dark:border-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
      {ico(D_OLHO, 12)} Vendo como
    </span>
    <span class="flex min-w-0 flex-1 items-center gap-2">
      <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">BB</span>
      <span class="min-w-0 truncate text-[13px] font-semibold text-amber-950 dark:text-amber-100">{nome}</span>
      <span class="hidden min-w-0 truncate text-[11.5px] text-amber-800/70 lg:inline dark:text-amber-200/60">· {escritorio}</span>
    </span>
    <!-- A sessão morre em 1h e nada dizia isso. Descobrir pelo logout súbito no
         meio de uma conferência é a pior forma de ficar sabendo. -->
    <span class="hidden shrink-0 items-center gap-1.5 text-[11.5px] tabular-nums text-amber-800 md:inline-flex dark:text-amber-200/80">
      {ico(D_RELOGIO, 13)} expira em {restante}
    </span>
    <span class="hidden shrink-0 items-center gap-1.5 text-[11.5px] text-amber-800/80 xl:inline-flex dark:text-amber-200/70">
      {ico(D_ESCUDO, 13)} ações auditadas
    </span>
    <button class="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-amber-900 px-2.5 text-[12px] font-semibold text-amber-50 hover:bg-amber-950 dark:bg-amber-200 dark:text-amber-950 dark:hover:bg-amber-100">
      {ico(D_VOLTAR, 13)} Voltar ao admin
    </button>
  </div>
</div>
"""


def moldura(conteudo, escuro=False, altura="h-[190px]"):
    """App em miniatura: a faixa só se julga em proporção ao resto da tela."""
    cls = "dark" if escuro else ""
    return f"""
<div class="{cls} overflow-hidden rounded-md border">
  <div class="flex {altura} bg-background">
    <aside class="hidden w-[168px] shrink-0 flex-col gap-1 bg-sidebar p-2.5 sm:flex">
      <div class="mb-1.5 flex items-center gap-1.5 px-1">
        <span class="flex h-5 w-5 items-center justify-center rounded bg-violet-600 text-[9px] font-extrabold text-white">J.</span>
        <span class="text-[12px] font-bold text-sidebar-foreground">JuridFlow</span>
      </div>
      <span class="rounded bg-sidebar-accent px-2 py-1 text-[11px] text-sidebar-accent-foreground">Dashboard</span>
      <span class="px-2 py-1 text-[11px] text-sidebar-foreground/70">Movimentações</span>
      <span class="px-2 py-1 text-[11px] text-sidebar-foreground/70">Agenda</span>
      <span class="px-2 py-1 text-[11px] text-sidebar-foreground/70">Atendimento</span>
      <span class="px-2 py-1 text-[11px] text-sidebar-foreground/70">Clientes</span>
    </aside>
    <div class="flex min-w-0 flex-1 flex-col">
      {conteudo}
      <div class="flex-1 space-y-2 overflow-hidden p-3">
        <div class="h-4 w-40 rounded bg-muted"></div>
        <div class="grid grid-cols-3 gap-2">
          <div class="h-11 rounded-md border bg-card"></div>
          <div class="h-11 rounded-md border bg-card"></div>
          <div class="h-11 rounded-md border bg-card"></div>
        </div>
        <div class="h-16 rounded-md border bg-card"></div>
      </div>
    </div>
  </div>
</div>
"""


def secao(titulo, descricao, corpo):
    return f"""
<section class="space-y-2">
  <div>
    <h2 class="text-[15px] font-bold tracking-tight">{titulo}</h2>
    <p class="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{descricao}</p>
  </div>
  {corpo}
</section>
"""


PAGINA = f"""<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Faixa de impersonação — proposta</title>
<style>
{CSS}
</style>
<style>
  body {{ margin: 0; background: var(--background); }}
  .pagina {{ max-width: 1000px; margin: 0 auto; padding: 28px 20px 60px; }}
</style>
</head>
<body>
<div class="pagina space-y-8">

  <header>
    <h1 class="text-[24px] font-bold tracking-tight">Faixa de impersonação</h1>
    <p class="mt-1 text-[13px] leading-relaxed text-muted-foreground">
      Proposta de redesenho e correção do "sair". Renderizado com o CSS compilado do próprio app —
      o que estiver aqui é o que aparece na tela.
    </p>
  </header>

  {secao(
    "Hoje",
    "Faixa laranja sólida ocupando a largura toda, texto corrido de duas orações e um botão que "
    "desloga. Rouba a atenção permanentemente de uma informação que precisa ser lembrada, não gritada.",
    moldura(ATUAL),
  )}

  {secao(
    "Proposta — tema claro",
    "O sinal de alerta vira uma barra sólida estreita à esquerda; o fundo fica só tingido. Entra "
    "quem é a pessoa (avatar e escritório), quanto tempo resta de sessão, e o botão passa a dizer "
    "para onde leva.",
    moldura(proposta()),
  )}

  {secao(
    "Proposta — tema escuro",
    "Mesma faixa nos tokens escuros.",
    moldura(proposta(), escuro=True),
  )}

  {secao(
    "Perto do fim da sessão",
    "A impersonação dura 1 hora. Faltando 5 minutos o contador fica em destaque — hoje a sessão "
    "simplesmente cai, e a pessoa descobre no meio do que estava fazendo.",
    moldura(proposta(restante="4 min").replace(
      'text-[11.5px] tabular-nums text-amber-800 md:inline-flex dark:text-amber-200/80',
      'text-[11.5px] font-bold tabular-nums text-rose-700 md:inline-flex dark:text-rose-300'),
    ),
  )}

  <section class="space-y-3 rounded-md border bg-card p-4">
    <h2 class="text-[15px] font-bold tracking-tight">O que muda no comportamento</h2>

    <div class="space-y-3 text-[12.5px] leading-relaxed">
      <div class="flex gap-2.5">
        <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500"></span>
        <p>
          <b>"Sair" desloga hoje porque não há para onde voltar.</b> Ao entrar como alguém, o sistema
          <i>substitui</i> o cookie de sessão pelo token do usuário-alvo. A sessão do admin deixa de
          existir — o único rastro é o campo <code class="rounded bg-muted px-1">impersonatedBy</code>
          dentro do próprio token. Logout é literalmente a única saída que existe.
        </p>
      </div>
      <div class="flex gap-2.5">
        <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"></span>
        <p>
          <b>A correção.</b> Uma rota nova de encerramento lê o <code class="rounded bg-muted px-1">impersonatedBy</code>
          do token atual, confirma que aquele usuário <i>ainda</i> é admin, emite uma sessão nova
          para ele e devolve a pessoa em <code class="rounded bg-muted px-1">/admin</code>. Sem
          precisar guardar o token antigo em lugar nenhum.
        </p>
      </div>
      <div class="flex gap-2.5">
        <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"></span>
        <p>
          <b>A conferência que não pode faltar.</b> Se o admin foi rebaixado enquanto estava
          impersonando, sair <i>não</i> pode devolver os poderes. Por isso o cargo é verificado no
          momento da saída, e não confiado ao que estava valendo na entrada.
        </p>
      </div>
      <div class="flex gap-2.5">
        <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400"></span>
        <p>
          <b>Auditoria dos dois lados.</b> Hoje só a entrada é registrada. A saída passa a ser
          também — sem isso o log mostra quando alguém entrou numa conta e nunca quando saiu.
        </p>
      </div>
    </div>
  </section>

  <section class="space-y-2 rounded-md border border-dashed p-4">
    <h2 class="text-[13px] font-bold tracking-tight">Duas decisões suas</h2>
    <p class="text-[12.5px] leading-relaxed text-muted-foreground">
      <b class="text-foreground">1.</b> A faixa deve continuar fixa no topo ao rolar a página?
      Hoje ela é <code class="rounded bg-muted px-1">sticky</code>. Fixa é mais segura; solta devolve
      alguns pixels de altura. Minha recomendação é manter fixa — é um aviso de segurança.
    </p>
    <p class="text-[12.5px] leading-relaxed text-muted-foreground">
      <b class="text-foreground">2.</b> Quando a hora de sessão expirar sozinha, devolvo para
      <code class="rounded bg-muted px-1">/admin</code> ou para a tela de login? Recomendo
      <code class="rounded bg-muted px-1">/admin</code>, pelo mesmo motivo do botão.
    </p>
  </section>

</div>
</body>
</html>
"""

(AQUI / "faixa-impersonacao.html").write_text(PAGINA, encoding="utf-8")
print("gerado:", (AQUI / "faixa-impersonacao.html"))
