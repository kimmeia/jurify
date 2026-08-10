"""
Mockups dos três painéis setoriais na linguagem já aprovada no Geral.

As classes são as MESMAS do app — o Tailwind do projeto varre esta pasta, então
o CSS compilado que a página carrega é o CSS de verdade. O que for aprovado aqui
transfere pro componente sem tradução.
"""
import pathlib

AQUI = pathlib.Path(__file__).parent


def seta(cor="currentColor"):
    return ('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" class="shrink-0">'
            f'<path d="M5 12h13M13 6l6 6-6 6" stroke="{cor}" stroke-width="2" '
            'stroke-linecap="round" stroke-linejoin="round"/></svg>')


def ico(d, extra=""):
    return (f'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" class="{extra}">'
            f'<path d="{d}" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" '
            'stroke-linejoin="round"/></svg>')


D_ALERTA = "M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"
D_ALVO = "M12 3a9 9 0 1 0 9 9M12 8a4 4 0 1 0 4 4M12 12l9-9"
D_APERTO = "M11 17 9 15M6 10l3-3 4 4 3-3 3 3v4l-4 4-4-4"
D_RELOGIO = "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"
D_CHECK = "M5 13l4 4L19 7"
D_PESSOAS = "M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9.5 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8z"
D_DINHEIRO = "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"
D_CALEND = "M8 2v4M16 2v4M3 9h18M5 5h14v16H5z"

AVATAR = ["#7c3aed", "#0891b2", "#eda100", "#1baf7a", "#e87ba4", "#eb6834"]


def pagina(titulo, corpo):
    return f"""<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>{titulo}</title>
<link rel="stylesheet" href="app.css">
<style>body{{margin:0}} .palco{{padding:20px;background:var(--background)}}</style>
</head>
<body><div class="palco"><div class="space-y-3.5">
{corpo}
</div></div></body>
</html>
"""


def topo(titulo, sub, acao="Ver relatórios"):
    return f"""  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0">
      <h1 class="text-[22px] font-bold tracking-tight leading-tight">{titulo}</h1>
      <p class="mt-0.5 text-[12.5px] text-muted-foreground"><span class="tabular-nums">{sub}</span></p>
    </div>
    <button class="inline-flex h-8 items-center gap-1 rounded-md border px-3 text-[12px] font-medium">
      {acao} {seta()}
    </button>
  </div>"""


def acao_card(icone, valor, label, critico=False):
    if critico:
        return f"""      <button class="flex items-center gap-3 rounded-md border border-rose-200 bg-rose-50 px-3.5 py-3 text-left transition-colors dark:border-rose-900 dark:bg-rose-950/30">
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">{ico(icone)}</span>
        <span class="min-w-0">
          <span class="block text-[19px] font-bold leading-none tabular-nums text-rose-700 dark:text-rose-300">{valor}</span>
          <span class="mt-1 block text-[11.5px] leading-tight text-rose-800/80 dark:text-rose-200/80">{label}</span>
        </span>
        <span class="ml-auto shrink-0 text-rose-500">{seta()}</span>
      </button>"""
    return f"""      <button class="flex items-center gap-3 rounded-md border bg-card px-3.5 py-3 text-left transition-colors">
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">{ico(icone)}</span>
        <span class="min-w-0">
          <span class="block text-[19px] font-bold leading-none tabular-nums">{valor}</span>
          <span class="mt-1 block text-[11.5px] leading-tight text-muted-foreground">{label}</span>
        </span>
        <span class="ml-auto shrink-0 text-muted-foreground/50">{seta()}</span>
      </button>"""


def faixa_acoes(cards):
    cols = {2: "sm:grid-cols-2", 3: "sm:grid-cols-2 xl:grid-cols-3", 4: "sm:grid-cols-2 xl:grid-cols-4"}[len(cards)]
    return f'  <div class="grid gap-2.5 {cols}">\n' + "\n".join(cards) + "\n  </div>"


def badge(texto, tom="ok"):
    tons = {
        "ok": "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
        "ruim": "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300",
        "neutro": "border-border bg-muted text-muted-foreground",
    }
    return (f'<span class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 '
            f'text-[11.5px] font-bold {tons[tom]}">{texto}</span>')


def sub_numero(label, valor, hint="", tag="", ruim=False):
    cor = " text-rose-700 dark:text-rose-400" if ruim else ""
    tag_html = f' {tag}' if tag else ""
    hint_html = f'\n        <p class="mt-0.5 text-[10.5px] text-muted-foreground/80">{hint}</p>' if hint else ""
    return f"""      <div class="px-4 py-3">
        <p class="flex items-center gap-1.5 text-[11px] text-muted-foreground">{label}{tag_html}</p>
        <p class="mt-1 text-[19px] font-bold tracking-tight tabular-nums{cor}">{valor}</p>{hint_html}
      </div>"""


def bloco_principal(rotulo, valor, badge_html, miolo, subs):
    return f"""    <div class="overflow-hidden rounded-md border bg-card">
      <div class="flex flex-wrap items-end justify-between gap-3 px-4 pt-4">
        <div>
          <p class="text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">{rotulo}</p>
          <p class="mt-1.5 text-[34px] font-bold leading-none tracking-tight tabular-nums">{valor}</p>
        </div>
        {badge_html}
      </div>
{miolo}
      <div class="grid divide-y border-t sm:grid-cols-3 sm:divide-x sm:divide-y-0">
{subs}
      </div>
    </div>"""


def barra_meta(pct, ritmo, legenda_esq, legenda_dir):
    """Barra com marcador de referência.

    O marcador é o que transforma "78% da meta" em informação: 78% no dia 10 é
    ótimo, 78% no dia 28 é problema. O anel do hero antigo não dizia nada disso
    — mostrava o mesmo desenho bonito nos dois casos.

    O rótulo do marcador vive na legenda, e não flutuando sobre a barra: solto
    ali em cima ele batia no badge do canto quando a referência ficava perto do
    fim, e um rótulo que às vezes colide é pior que um rótulo fixo.
    """
    return f"""      <div class="px-4 pb-4 pt-4">
        <div class="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
          <div class="h-full rounded-full" style="width:{pct}%;background:var(--viz-1)"></div>
          <span class="absolute inset-y-0 w-px bg-foreground/60" style="left:{ritmo}%"></span>
        </div>
        <div class="mt-2.5 flex items-center justify-between text-[11px] text-muted-foreground">
          <span class="flex items-center gap-1.5"><span class="inline-block h-3 w-px bg-foreground/60"></span>{legenda_esq}</span>
          <span>{legenda_dir}</span>
        </div>
      </div>"""


def lista_card(titulo, sub, acao, linhas, rodape="", altura_travada=False):
    corpo = "\n".join(linhas)
    rodape_html = ""
    if rodape:
        rodape_html = f"""
      <div class="mt-auto flex items-center justify-between border-t px-4 py-2.5 text-[11px] text-muted-foreground">{rodape}</div>"""
    sub_html = f'\n          <p class="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>' if sub else ""
    acao_html = ""
    if acao:
        acao_html = (f'<button class="flex shrink-0 items-center gap-1 pt-0.5 text-[11.5px] font-semibold '
                     f'text-violet-600 dark:text-violet-400">{acao} {seta()}</button>')
    classe = "flex min-h-0 flex-col overflow-hidden rounded-md border bg-card" + (" h-full" if altura_travada else "")
    rolagem = " min-h-0 flex-1 overflow-y-auto" if altura_travada else ""
    return f"""    <div class="{classe}">
      <div class="flex items-start justify-between gap-2 px-4 pt-3.5">
        <div class="min-w-0">
          <p class="text-sm font-bold leading-tight">{titulo}</p>{sub_html}
        </div>
        {acao_html}
      </div>
      <div class="flex flex-col px-2 pb-2 pt-1{rolagem}">
{corpo}
      </div>{rodape_html}
    </div>"""


def iniciais(nome):
    return "".join(p[0] for p in nome.split()[:2]).upper()


def linha_rank(pos, nome, detalhe, pct, i, selo="", pct_ruim=False, sem_meta=False):
    """Linha do ranking: barra larga o bastante pra comparar de relance.

    A barra é o dado; o número ao lado é a leitura exata. Estreita demais ela
    vira enfeite — todo mundo parece igual e sobra um vão branco no meio da
    linha.
    """
    cor_pct = "text-rose-600 dark:text-rose-400" if pct_ruim else ("text-emerald-600 dark:text-emerald-400" if pct >= 100 else "")
    cor_barra = "var(--viz-2)" if pct_ruim else "var(--viz-1)"
    pos_html = (f'<span class="w-4 shrink-0 text-center text-[11px] font-bold tabular-nums text-muted-foreground/70">{pos}</span>'
                if pos else "")
    if sem_meta:
        # Sem meta cadastrada não é "0% da meta" — é ausência de referência.
        # Mostrar 0% acusa a pessoa por uma configuração que ninguém fez.
        barra = '<span class="block h-1.5 w-full rounded-full bg-muted"></span>'
        valor = "—"
        cor_pct = "text-muted-foreground"
    else:
        barra = (f'<span class="block h-1.5 w-full overflow-hidden rounded-full bg-muted">'
                 f'<span class="block h-full rounded-full" style="width:{min(pct,100)}%;background:{cor_barra}"></span></span>')
        valor = f"{str(pct).replace('.', ',')}%"
    return f"""        <button class="flex items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-accent">
          {pos_html}
          <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style="background:{AVATAR[i % len(AVATAR)]}">{iniciais(nome)}</span>
          <span class="w-[260px] shrink-0">
            <span class="flex items-center gap-1.5"><span class="truncate text-[12.5px] font-semibold">{nome}</span>{selo}</span>
            <span class="mt-0.5 block truncate text-[10.5px] text-muted-foreground">{detalhe}</span>
          </span>
          <span class="min-w-0 flex-1">{barra}</span>
          <span class="w-[52px] shrink-0 text-right text-[12px] font-bold tabular-nums {cor_pct}">{valor}</span>
        </button>"""


def linha_valor(nome, detalhe, valor, rodape_valor, i):
    """Linha de devedor: o valor é o dado, e valor não vira barra de porcentagem.

    A barra do ranking compara % contra uma meta. Aqui não há meta — transformar
    reais em "100%, 68%, 51%" inventa uma escala que o número não tem.
    """
    return f"""        <button class="flex items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-accent">
          <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style="background:{AVATAR[i % len(AVATAR)]}">{iniciais(nome)}</span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[12.5px] font-semibold">{nome}</span>
            <span class="mt-0.5 block truncate text-[10.5px] text-muted-foreground">{detalhe}</span>
          </span>
          <span class="shrink-0 text-right">
            <span class="block text-[13.5px] font-bold tabular-nums text-rose-700 dark:text-rose-400">{valor}</span>
            <span class="mt-0.5 block text-[10px] text-muted-foreground">{rodape_valor}</span>
          </span>
        </button>"""


def selo(texto, tom):
    tons = {
        "ok": "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
        "ruim": "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300",
        "neutro": "border-border bg-muted text-muted-foreground",
    }
    return f'<span class="shrink-0 rounded border px-1 text-[9px] font-bold uppercase {tons[tom]}">{texto}</span>'


def linha_num(label, valor, hint="", ruim=False):
    cor = " text-rose-700 dark:text-rose-400" if ruim else ""
    return f"""        <div class="flex items-baseline justify-between gap-2 rounded-lg px-2 py-2">
          <span class="min-w-0">
            <span class="block text-[12px]">{label}</span>
            <span class="mt-0.5 block text-[10.5px] text-muted-foreground">{hint}</span>
          </span>
          <span class="shrink-0 text-[18px] font-bold tabular-nums{cor}">{valor}</span>
        </div>"""


# ═══════════════════════════════════════════════════════════════════════════
# COMERCIAL
# ═══════════════════════════════════════════════════════════════════════════

comercial = "\n".join([
    topo("Painel Comercial", "Visão gestor · 01 de ago. a 10 de ago."),
    faixa_acoes([
        acao_card(D_ALERTA, "2", "abaixo de 40% da meta", critico=True),
        acao_card(D_ALVO, "1", "colaborador sem meta definida"),
        acao_card(D_APERTO, "9", "contratos fechados sem pagamento"),
    ]),
    """  <div class="grid gap-3.5 lg:grid-cols-3">
    <div class="lg:col-span-2">""",
    bloco_principal(
        "Progresso da meta do time",
        '78,4<span class="text-[22px]">%</span>',
        badge("Acima do ritmo do mês", "ok"),
        barra_meta(78.4, 32.3, "ritmo esperado a esta altura do mês: 32%",
                   "<b class=\"text-foreground\">78,4%</b> da meta do time"),
        "\n".join([
            sub_numero("Contratos fechados", "47", "9 ainda sem pagamento"),
            sub_numero("Contratos pagos", "38", "no período"),
            sub_numero("Conversão", "80,9%", "pagos sobre fechados",
                       tag='<span class="rounded border border-emerald-200 bg-emerald-50 px-1.5 text-[10px] font-bold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">boa</span>'),
        ]),
    ),
    """    </div>
    <div class="relative min-h-0">
      <div class="lg:absolute lg:inset-0">""",
    lista_card("Como está o time", "6 pessoas no setor comercial", "", [
        linha_num("Bateram a meta", "2", "100% ou mais"),
        linha_num("No caminho", "2", "entre 40% e 99%"),
        linha_num("Precisam de atenção", "2", "abaixo de 40% ou sem meta", ruim=True),
    ], rodape="<span>Ordenado por % da meta</span><span>Atualiza a cada minuto</span>", altura_travada=True),
    """      </div>
    </div>
    <div class="lg:col-span-3">""",
    lista_card("Ranking do time comercial", "Só quem é do setor Comercial aparece aqui", "Ver equipe", [
        linha_rank(1, "Camila Duarte", "18 fechados · 16 pagos", 128.5, 0, selo("top", "ok")),
        linha_rank(2, "Rafael Nogueira", "12 fechados · 10 pagos", 104.0, 1, selo("meta", "ok")),
        linha_rank(3, "Priscila Matos", "9 fechados · 7 pagos", 72.6, 2),
        linha_rank(4, "Diego Albuquerque", "5 fechados · 3 pagos", 41.2, 3),
        linha_rank(5, "Larissa Prado", "2 fechados · 1 pago", 18.9, 4, selo("atenção", "ruim"), pct_ruim=True),
        linha_rank(6, "Marcos Vinícius", "1 fechado · 1 pago", 0, 5, selo("sem meta", "neutro"), sem_meta=True),
    ], rodape="<span>6 colaboradores · 47 fechados · 38 pagos</span><span class='font-semibold text-rose-600 dark:text-rose-400'>2 abaixo de 40%</span>"),
    """    </div>
  </div>""",
])

# ═══════════════════════════════════════════════════════════════════════════
# OPERACIONAL
# ═══════════════════════════════════════════════════════════════════════════

operacional = "\n".join([
    topo("Painel Operacional", "Visão gestor · 01 de ago. a 10 de ago."),
    faixa_acoes([
        acao_card(D_ALERTA, "14", "tarefas atrasadas", critico=True),
        acao_card(D_CALEND, "6", "compromissos atrasados"),
        acao_card(D_PESSOAS, "3", "pessoas com 3+ atrasos"),
    ]),
    """  <div class="grid gap-3.5 lg:grid-cols-3">
    <div class="lg:col-span-2">""",
    bloco_principal(
        "Entregue no prazo — setor operacional",
        '86,2<span class="text-[22px]">%</span>',
        badge("14 em atraso agora", "ruim"),
        barra_meta(86.2, 90, "piso aceitável do setor: 90%",
                   "<b class=\"text-foreground\">86,2%</b> entregue no prazo"),
        "\n".join([
            sub_numero("Em aberto", "42", "28 no prazo · 14 atrasadas"),
            sub_numero("Entregues no prazo", "118", "no período"),
            sub_numero("Entregues fora do prazo", "19", "13,9% das entregas", ruim=True),
        ]),
    ),
    """    </div>
    <div class="relative min-h-0">
      <div class="lg:absolute lg:inset-0">""",
    lista_card("Meu mês", "Você, dentro do setor", "", [
        linha_num("Minha taxa no prazo", "91,3%", "setor está em 86,2%"),
        linha_num("Minhas tarefas em aberto", "7", "2 vencem hoje"),
        linha_num("Minhas atrasadas", "1", "há 3 dias", ruim=True),
    ], rodape="<span>Compromissos hoje: 4</span><span>1 atrasado</span>", altura_travada=True),
    """      </div>
    </div>
    <div class="lg:col-span-3">""",
    lista_card("Ranking de produção", "Quem tem atraso aparece primeiro — é o que precisa de ação", "Ver equipe", [
        linha_rank("", "Ana Beatriz Ramos", "5 atrasadas · 9 no prazo · 21 entregues", 61.8, 0, selo("5 atrasos", "ruim"), pct_ruim=True),
        linha_rank("", "Tiago Fernandes", "4 atrasadas · 6 no prazo · 17 entregues", 68.0, 1, selo("4 atrasos", "ruim"), pct_ruim=True),
        linha_rank("", "Juliana Castro", "3 atrasadas · 5 no prazo · 24 entregues", 79.4, 2, selo("3 atrasos", "ruim"), pct_ruim=True),
        linha_rank("", "Bruno Sales", "1 atrasada · 4 no prazo · 26 entregues", 92.1, 3),
        linha_rank("", "Helena Vasques", "0 atrasada · 4 no prazo · 30 entregues", 100.0, 4, selo("top", "ok")),
    ], rodape="<span>5 colaboradores · 137 entregas no período</span><span class='font-semibold text-rose-600 dark:text-rose-400'>14 atrasadas</span>"),
    """    </div>
  </div>""",
])

# ═══════════════════════════════════════════════════════════════════════════
# FINANCEIRO
# ═══════════════════════════════════════════════════════════════════════════

grafico_financeiro = """      <div class="px-2 pt-3">
        <div class="flex items-center justify-end gap-3.5 px-2 pb-1 text-[10.5px] text-muted-foreground">
          <span class="flex items-center gap-1.5"><span class="h-[3px] w-3.5 rounded-full" style="background:var(--viz-1)"></span>Recebido</span>
          <span class="flex items-center gap-1.5"><span class="h-[3px] w-3.5 rounded-full" style="background:var(--viz-2)"></span>Vencido</span>
        </div>
        <div class="h-[168px]">
          <svg width="100%" height="168" viewBox="0 0 880 168" preserveAspectRatio="none" style="overflow:visible">
            <g font-size="10" fill="var(--muted-foreground)" text-anchor="end">
              <text x="34" y="14">24k</text><text x="34" y="52">18k</text>
              <text x="34" y="90">12k</text><text x="34" y="128">6k</text><text x="34" y="160">0</text>
            </g>
            <g stroke="var(--border)" stroke-width="1">
              <line x1="38" y1="10" x2="880" y2="10"/><line x1="38" y1="48" x2="880" y2="48"/>
              <line x1="38" y1="86" x2="880" y2="86"/><line x1="38" y1="124" x2="880" y2="124"/>
              <line x1="38" y1="156" x2="880" y2="156"/>
            </g>
            <path d="M50,150 C140,150 160,90 230,88 C310,86 330,140 400,138 C470,136 490,60 560,66 C640,72 660,120 730,128 C800,136 830,20 870,16"
                  fill="none" stroke="var(--viz-1)" stroke-width="2"/>
            <path d="M50,156 C140,156 160,140 230,142 C310,144 330,150 400,148 C470,146 490,128 560,132 C640,136 660,150 730,150 C800,150 830,138 870,140"
                  fill="none" stroke="var(--viz-2)" stroke-width="2" stroke-dasharray="4 3"/>
          </svg>
        </div>
      </div>"""

financeiro = "\n".join([
    topo("Painel Financeiro", "Receita do escritório · 01 de ago. a 10 de ago."),
    faixa_acoes([
        acao_card(D_ALERTA, "23", "clientes com cobrança vencida", critico=True),
        acao_card(D_RELOGIO, "47", "cobranças vencidas no período"),
    ]),
    """  <div class="grid gap-3.5 lg:grid-cols-3">
    <div class="lg:col-span-2">""",
    bloco_principal(
        "Recebido no período",
        "R$ 66.172,58",
        badge("Saldo positivo", "ok"),
        grafico_financeiro,
        "\n".join([
            sub_numero("A receber, em dia", "R$ 230.310,34", "184 cobranças a vencer"),
            sub_numero("Vencido no período", "R$ 15.733,00", "23 clientes no período", ruim=True,
                       tag='<span class="rounded border border-rose-200 bg-rose-50 px-1.5 text-[10px] font-bold text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">19%</span>'),
            sub_numero("Ticket médio recebido", "R$ 1.418,55", "47 pagamentos no período"),
        ]),
    ),
    """    </div>
    <div class="relative min-h-0">
      <div class="lg:absolute lg:inset-0">""",
    lista_card("Maiores valores em aberto", "Não filtrado por setor", "Ver todos", [
        linha_valor("Construtora Vale Verde", "4 vencidas · a mais antiga há 62 dias", "R$ 4.820,00", "em aberto", 0),
        linha_valor("Maria Aparecida Nunes", "3 vencidas · a mais antiga há 41 dias", "R$ 3.270,00", "em aberto", 1),
        linha_valor("Transportes Boa Sorte", "2 vencidas · a mais antiga há 28 dias", "R$ 2.450,00", "em aberto", 2),
        linha_valor("João Batista Ferreira", "2 vencidas · a mais antiga há 17 dias", "R$ 1.890,00", "em aberto", 3),
        linha_valor("Clínica São Rafael", "1 vencida · há 9 dias", "R$ 1.300,00", "em aberto", 4),
    ], rodape="<span>5 de 23 clientes</span><span class='font-semibold text-rose-600 dark:text-rose-400'>R$ 13.730,00 nos cinco</span>",
        altura_travada=True),
    """      </div>
    </div>
    <div class="lg:col-span-3">
      <div class="overflow-hidden rounded-md border bg-card">
        <div class="px-4 pt-3.5">
          <p class="text-sm font-bold leading-tight">Inadimplência por cliente</p>
          <p class="mt-0.5 text-[11px] text-muted-foreground">Cliente inadimplente = com ao menos uma cobrança vencida no período.</p>
        </div>
        <div class="px-4 pb-4 pt-4">
          <div class="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div class="h-full rounded-full" style="width:19%;background:var(--viz-2)"></div>
          </div>
        </div>
        <div class="grid divide-y border-t sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div class="px-4 py-3">
            <p class="text-[11px] text-muted-foreground">Com cobrança vencida</p>
            <p class="mt-1 text-[19px] font-bold tracking-tight tabular-nums text-rose-700 dark:text-rose-400">23</p>
            <p class="mt-0.5 text-[10.5px] text-muted-foreground/80">clientes no período</p>
          </div>
          <div class="px-4 py-3">
            <p class="text-[11px] text-muted-foreground">Total com cobrança</p>
            <p class="mt-1 text-[19px] font-bold tracking-tight tabular-nums">121</p>
            <p class="mt-0.5 text-[10.5px] text-muted-foreground/80">base de comparação</p>
          </div>
          <div class="px-4 py-3">
            <p class="text-[11px] text-muted-foreground">Inadimplência por cliente</p>
            <p class="mt-1 text-[19px] font-bold tracking-tight tabular-nums">19,0%</p>
            <p class="mt-0.5 text-[10.5px] text-muted-foreground/80">23 de 121</p>
          </div>
        </div>
      </div>
    </div>
  </div>""",
])

for nome, corpo, titulo in [
    ("comercial", comercial, "Painel Comercial"),
    ("operacional", operacional, "Painel Operacional"),
    ("financeiro", financeiro, "Painel Financeiro"),
]:
    (AQUI / f"{nome}.html").write_text(pagina(titulo, corpo), encoding="utf-8")
    print("gerado", nome)
