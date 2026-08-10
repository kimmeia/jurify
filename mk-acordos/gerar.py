"""
Mockup do módulo Acordos na linguagem já aprovada nos painéis.

Classes reais do app, CSS compilado do projeto — o que for aprovado transfere
pro componente sem tradução.
"""
import pathlib

AQUI = pathlib.Path(__file__).parent
AVATAR = ["#7c3aed", "#0891b2", "#eda100", "#1baf7a", "#e87ba4", "#eb6834"]


def seta():
    return ('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" class="shrink-0">'
            '<path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" '
            'stroke-linecap="round" stroke-linejoin="round"/></svg>')


def ico(d):
    return (f'<svg width="16" height="16" viewBox="0 0 24 24" fill="none">'
            f'<path d="{d}" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" '
            'stroke-linejoin="round"/></svg>')


D_ALERTA = "M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"
D_RELOGIO = "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z"
D_DINHEIRO = "M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"
D_APERTO = "M11 17 9 15M6 10l3-3 4 4 3-3 3 3v4l-4 4-4-4"


def pagina(titulo, corpo):
    return f"""<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>{titulo}</title>
<link rel="stylesheet" href="app.css">
<style>body{{margin:0}}.palco{{padding:20px;background:var(--background)}}</style>
</head><body><div class="palco"><div class="space-y-3.5">
{corpo}
</div></div></body></html>
"""


def iniciais(nome):
    return "".join(p[0] for p in nome.split()[:2]).upper()


def acao_card(icone, valor, label, critico=False):
    if critico:
        return f"""      <button class="flex items-center gap-3 rounded-md border border-rose-200 bg-rose-50 px-3.5 py-3 text-left dark:border-rose-900 dark:bg-rose-950/30">
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">{ico(icone)}</span>
        <span class="min-w-0"><span class="block text-[19px] font-bold leading-none tabular-nums text-rose-700 dark:text-rose-300">{valor}</span>
        <span class="mt-1 block text-[11.5px] leading-tight text-rose-800/80 dark:text-rose-200/80">{label}</span></span>
        <span class="ml-auto shrink-0 text-rose-500">{seta()}</span>
      </button>"""
    return f"""      <button class="flex items-center gap-3 rounded-md border bg-card px-3.5 py-3 text-left">
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">{ico(icone)}</span>
        <span class="min-w-0"><span class="block text-[19px] font-bold leading-none tabular-nums">{valor}</span>
        <span class="mt-1 block text-[11.5px] leading-tight text-muted-foreground">{label}</span></span>
        <span class="ml-auto shrink-0 text-muted-foreground/50">{seta()}</span>
      </button>"""


def sub_numero(label, valor, hint="", ruim=False):
    cor = " text-rose-700 dark:text-rose-400" if ruim else ""
    h = f'\n        <p class="mt-0.5 text-[10.5px] text-muted-foreground/80">{hint}</p>' if hint else ""
    return f"""      <div class="px-4 py-3">
        <p class="flex items-center gap-1.5 text-[11px] text-muted-foreground">{label}</p>
        <p class="mt-1 text-[19px] font-bold tracking-tight tabular-nums{cor}">{valor}</p>{h}
      </div>"""


def termometro(pct, cobrando=True, largura="w-full"):
    """A régua da negociação, sem gradiente decorativo.

    O gradiente rosa→verde do módulo atual não codifica nada: ele é fixo e só o
    marcador se move, então a cor mente sobre o estado. Aqui a barra pinta o
    trecho percorrido, e a cor sai do quão perto da meta a proposta está.
    """
    cor = "var(--viz-3)" if pct >= 85 else ("var(--viz-4)" if pct >= 40 else "var(--viz-2)")
    return f"""<span class="{largura} block">
              <span class="relative block h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <span class="block h-full rounded-full" style="width:{max(3, min(100, pct))}%;background:{cor}"></span>
              </span>
            </span>"""


def selo(texto, tom):
    tons = {
        "ok": "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
        "ruim": "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300",
        "aviso": "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
        "info": "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300",
        "neutro": "border-border bg-muted text-muted-foreground",
    }
    return f'<span class="shrink-0 rounded border px-1.5 py-px text-[9.5px] font-bold uppercase {tons[tom]}">{texto}</span>'


def linha_acordo(i, cliente, processo, contraria, pct, proposta, meta, vez, parado, resp, status_selo, alerta=False):
    fundo = " bg-rose-50/40 dark:bg-rose-950/10" if alerta else ""
    return f"""        <button class="grid w-full grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.1fr)] items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-accent{fundo}">
          <span class="flex min-w-0 items-center gap-2.5">
            <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style="background:{AVATAR[i % len(AVATAR)]}">{iniciais(cliente)}</span>
            <span class="min-w-0">
              <span class="block truncate text-[12.5px] font-semibold">{cliente}</span>
              <span class="mt-0.5 block truncate text-[10.5px] text-muted-foreground">vs {contraria}{f' · {processo}' if processo else ''}</span>
            </span>
          </span>
          <span class="min-w-0">
            {termometro(pct)}
            <span class="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
              <span class="tabular-nums">{proposta}</span><span class="tabular-nums">meta {meta}</span>
            </span>
          </span>
          <span class="min-w-0">
            <span class="block truncate text-[11.5px] font-semibold">{vez}</span>
            <span class="mt-0.5 block truncate text-[10.5px] {'text-rose-600 dark:text-rose-400 font-semibold' if alerta else 'text-muted-foreground'}">{parado}</span>
          </span>
          <span class="flex min-w-0 items-center justify-end gap-2">
            <span class="truncate text-[10.5px] text-muted-foreground">{resp}</span>
            {status_selo}
          </span>
        </button>"""


# ═══════════════════════════════════════════════════════════════════════════
# TELA 1 — Lista
# ═══════════════════════════════════════════════════════════════════════════

lista = f"""  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0">
      <h1 class="text-[22px] font-bold leading-tight tracking-tight">Acordos</h1>
      <p class="mt-0.5 text-[12.5px] text-muted-foreground">Negociações extrajudiciais do escritório · agosto de 2026</p>
    </div>
    <div class="flex items-center gap-2">
      <button class="inline-flex h-8 items-center rounded-md border px-3 text-[12px] font-medium">Exportar</button>
      <button class="inline-flex h-8 items-center gap-1.5 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white">+ Novo acordo</button>
    </div>
  </div>

  <div class="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
{acao_card(D_ALERTA, "4", "parados há mais de 15 dias", critico=True)}
{acao_card(D_RELOGIO, "7", "esperando resposta nossa")}
{acao_card(D_DINHEIRO, "2", "fechados sem cobrança gerada")}
  </div>

  <div class="grid gap-3.5 lg:grid-cols-3">
    <div class="lg:col-span-2">
      <div class="overflow-hidden rounded-md border bg-card">
        <div class="flex flex-wrap items-end justify-between gap-3 px-4 pt-4">
          <div>
            <p class="text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Em negociação agora</p>
            <p class="mt-1.5 text-[34px] font-bold leading-none tracking-tight tabular-nums">R$ 487.300,00</p>
          </div>
          <span class="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11.5px] font-bold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">18 acordos abertos</span>
        </div>
        <div class="px-4 pb-4 pt-5">
          <p class="mb-2 text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Como esse valor está dividido</p>
          <span class="flex h-2.5 overflow-hidden rounded-full bg-muted">
            <span class="block h-full" style="width:44%;background:var(--viz-4)"></span>
            <span class="block h-full" style="width:56%;background:var(--viz-1)"></span>
          </span>
          <div class="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full" style="background:var(--viz-4)"></span>R$ 214.400,00 em 11 negociando</span>
            <span class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full" style="background:var(--viz-1)"></span>R$ 272.900,00 em 7 com proposta enviada</span>
          </div>
        </div>
        <div class="grid divide-y border-t sm:grid-cols-3 sm:divide-x sm:divide-y-0">
{sub_numero("Fechado no mês", "R$ 128.400,00", "6 acordos fechados")}
{sub_numero("Taxa de fechamento", "67%", "6 fechados · 3 cancelados no mês")}
{sub_numero("Desconto médio", "-18,2%", "sobre o valor pretendido")}
        </div>
      </div>
    </div>

    <div class="relative min-h-0">
      <div class="lg:absolute lg:inset-0">
        <div class="flex h-full min-h-0 flex-col overflow-hidden rounded-md border bg-card">
          <div class="flex items-start justify-between gap-2 px-4 pt-3.5">
            <div class="min-w-0">
              <p class="text-sm font-bold leading-tight">De quem é a vez</p>
              <p class="mt-0.5 text-[11px] text-muted-foreground">Quem deve o próximo movimento</p>
            </div>
          </div>
          <div class="flex min-h-0 flex-1 flex-col px-2 pb-2 pt-1">
            <div class="flex items-baseline justify-between gap-2 rounded-lg px-2 py-2">
              <span class="min-w-0"><span class="block text-[12px]">Esperando eles</span>
              <span class="mt-0.5 block text-[10.5px] text-muted-foreground">proposta nossa no ar</span></span>
              <span class="shrink-0 text-[18px] font-bold tabular-nums">7</span>
            </div>
            <div class="flex items-baseline justify-between gap-2 rounded-lg px-2 py-2">
              <span class="min-w-0"><span class="block text-[12px]">Esperando nós</span>
              <span class="mt-0.5 block text-[10.5px] text-muted-foreground">contraproposta sem resposta</span></span>
              <span class="shrink-0 text-[18px] font-bold tabular-nums text-rose-700 dark:text-rose-400">7</span>
            </div>
            <div class="flex items-baseline justify-between gap-2 rounded-lg px-2 py-2">
              <span class="min-w-0"><span class="block text-[12px]">Sem movimento</span>
              <span class="mt-0.5 block text-[10.5px] text-muted-foreground">nenhuma tratativa há 15+ dias</span></span>
              <span class="shrink-0 text-[18px] font-bold tabular-nums text-rose-700 dark:text-rose-400">4</span>
            </div>
          </div>
          <div class="mt-auto flex items-center justify-between border-t px-4 py-2.5 text-[11px] text-muted-foreground">
            <span>18 acordos abertos</span><span class="font-semibold text-rose-600 dark:text-rose-400">11 travados</span>
          </div>
        </div>
      </div>
    </div>

    <div class="lg:col-span-3">
      <div class="flex min-h-0 flex-col overflow-hidden rounded-md border bg-card">
        <div class="flex flex-wrap items-center justify-between gap-2 px-4 pt-3.5">
          <div class="min-w-0">
            <p class="text-sm font-bold leading-tight">Negociações abertas</p>
            <p class="mt-0.5 text-[11px] text-muted-foreground">Mais paradas primeiro — é o que precisa de ação</p>
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white">Abertos</span>
            <span class="rounded-md border px-2.5 py-1 text-[11px] font-medium text-muted-foreground">Fechados</span>
            <span class="rounded-md border px-2.5 py-1 text-[11px] font-medium text-muted-foreground">Cancelados</span>
            <span class="ml-1 rounded-md border px-2.5 py-1 text-[11px] font-medium text-muted-foreground">Responsável ▾</span>
          </div>
        </div>
        <div class="mt-1 grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.1fr)] gap-3 border-b px-4 pb-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground/70">
          <span>Cliente e parte contrária</span><span>Negociação</span><span>Vez / parada</span><span class="text-right">Responsável</span>
        </div>
        <div class="flex flex-col px-2 pb-2 pt-1">
{linha_acordo(0, "Construtora Vale Verde", "Ação de cobrança", "Metalúrgica Sul Ltda", 22, "R$ 68.000,00", "R$ 120.000,00", "Esperando nós", "parado há 31 dias", "Camila D.", selo("negociando", "aviso"), alerta=True)}
{linha_acordo(1, "Maria Aparecida Nunes", "", "Banco Crédito S/A", 8, "R$ 12.400,00", "R$ 38.000,00", "Esperando nós", "parado há 24 dias", "Rafael N.", selo("negociando", "aviso"), alerta=True)}
{linha_acordo(2, "Transportes Boa Sorte", "0801234-55.2024", "Seguradora Norte", 91, "R$ 96.500,00", "R$ 100.000,00", "Esperando eles", "parado há 19 dias", "Camila D.", selo("proposta", "info"), alerta=True)}
{linha_acordo(3, "João Batista Ferreira", "", "Imobiliária Central", 64, "R$ 41.200,00", "R$ 55.000,00", "Esperando eles", "há 6 dias", "Priscila M.", selo("proposta", "info"))}
{linha_acordo(4, "Clínica São Rafael", "Rescisão contratual", "Fornecedora MedPlus", 78, "R$ 28.900,00", "R$ 34.000,00", "Esperando nós", "há 3 dias", "Diego A.", selo("negociando", "aviso"))}
{linha_acordo(5, "Ana Lúcia Prado", "", "Condomínio Jardins", 100, "R$ 22.000,00", "R$ 22.000,00", "Na meta", "ontem", "Rafael N.", selo("na meta", "ok"))}
        </div>
        <div class="mt-auto flex items-center justify-between border-t px-4 py-2.5 text-[11px] text-muted-foreground">
          <span>6 de 18 abertos · R$ 269.000,00 em jogo</span>
          <span class="font-semibold text-violet-600 dark:text-violet-400">Ver todos</span>
        </div>
      </div>
    </div>
  </div>"""


# ═══════════════════════════════════════════════════════════════════════════
# TELA 2 — Detalhe (painel lateral)
# ═══════════════════════════════════════════════════════════════════════════

def tratativa(icone_tom, titulo, valor, autor, quando, nossa=True):
    cor = "var(--viz-1)" if nossa else "var(--viz-2)"
    return f"""            <div class="relative pl-6">
              <span class="absolute left-[5px] top-[7px] h-2 w-2 rounded-full ring-2 ring-card" style="background:{cor}"></span>
              <p class="text-[12.5px] leading-snug">{titulo}{f' <span class="font-bold tabular-nums">· {valor}</span>' if valor else ''}</p>
              <p class="mt-0.5 text-[10.5px] text-muted-foreground">{autor} · {quando}</p>
            </div>"""


detalhe = f"""  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0">
      <h1 class="text-[22px] font-bold leading-tight tracking-tight">Acordos</h1>
      <p class="mt-0.5 text-[12.5px] text-muted-foreground">Painel de detalhe aberto — o que a pessoa vê ao clicar numa linha</p>
    </div>
  </div>

  <div class="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_420px]">
    <div class="rounded-md border border-dashed bg-card/40 p-4">
      <p class="text-[12px] text-muted-foreground">A lista continua aqui atrás, com a linha aberta destacada.</p>
      <div class="mt-3 space-y-2">
        <div class="h-9 rounded-md bg-muted/60"></div>
        <div class="h-9 rounded-md border-2 border-violet-400 bg-violet-50 dark:bg-violet-950/30"></div>
        <div class="h-9 rounded-md bg-muted/60"></div>
      </div>
    </div>

    <div class="flex flex-col overflow-hidden rounded-md border bg-card">
      <div class="border-b px-4 py-3.5">
        <div class="flex items-start justify-between gap-3">
          <div class="flex min-w-0 items-center gap-2.5">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style="background:#7c3aed">CV</span>
            <div class="min-w-0">
              <p class="truncate text-[14px] font-bold leading-tight">Construtora Vale Verde</p>
              <p class="mt-0.5 truncate text-[11px] text-muted-foreground">vs Metalúrgica Sul Ltda · Ação de cobrança</p>
            </div>
          </div>
          <button class="shrink-0 rounded-md border px-2 py-1 text-[11.5px] font-semibold">Editar</button>
        </div>
        <div class="mt-2.5 flex flex-wrap items-center gap-1.5">
          {selo("negociando", "aviso")}
          {selo("parado há 31 dias", "ruim")}
          <span class="text-[11px] text-muted-foreground">Responsável: <b class="text-foreground">Camila Duarte</b></span>
        </div>
      </div>

      <div class="border-b px-4 py-3.5">
        <div class="flex items-baseline justify-between">
          <p class="text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Proposta atual</p>
          <p class="text-[10.5px] text-muted-foreground">a <b class="tabular-nums text-foreground">R$ 52.000,00</b> da meta</p>
        </div>
        <p class="mt-1 text-[26px] font-bold leading-none tracking-tight tabular-nums">R$ 68.000,00</p>
        <div class="mt-3.5">
          <span class="relative block h-2.5 w-full overflow-hidden rounded-full bg-muted">
            <span class="block h-full rounded-full" style="width:22%;background:var(--viz-2)"></span>
          </span>
          <div class="mt-2 flex items-center justify-between text-[10.5px]">
            <span class="text-muted-foreground">limite <b class="tabular-nums text-foreground">R$ 55.000,00</b></span>
            <span class="text-muted-foreground">meta <b class="tabular-nums text-foreground">R$ 120.000,00</b></span>
          </div>
        </div>
        <div class="mt-3 flex items-center justify-between border-t pt-2.5 text-[11px] text-muted-foreground">
          <span>Abriu em R$ 60.000,00 · avançou R$ 8.000,00</span>
          <span class="tabular-nums">22% do caminho</span>
        </div>
      </div>

      <div class="border-b px-4 py-3">
        <p class="text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Quem negocia do outro lado</p>
        <div class="mt-1.5 flex items-center justify-between gap-2">
          <div class="min-w-0">
            <p class="truncate text-[12.5px] font-semibold">Dr. Ricardo Aguiar</p>
            <p class="text-[11px] tabular-nums text-muted-foreground">(85) 99812-4477</p>
          </div>
          <button class="shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">WhatsApp</button>
        </div>
      </div>

      <div class="flex-1 px-4 py-3.5">
        <div class="flex items-center justify-between">
          <p class="text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">Histórico da negociação</p>
          <span class="text-[10.5px] text-muted-foreground">5 registros</span>
        </div>
        <div class="relative mt-3 space-y-3.5 before:absolute before:bottom-1 before:left-[9px] before:top-1 before:w-px before:bg-border">
{tratativa("", "Contraproposta recebida — recusaram os R$ 68 mil", "R$ 44.000,00", "Dr. Ricardo Aguiar", "10 de jul., 14:32", nossa=False)}
{tratativa("", "Proposta enviada por e-mail com minuta anexa", "R$ 68.000,00", "Camila Duarte", "02 de jul., 09:10")}
{tratativa("", "Cliente autorizou negociar até R$ 55 mil", "", "Camila Duarte", "28 de jun., 16:45")}
{tratativa("", "Primeira conversa por telefone — abriram em R$ 30 mil", "R$ 30.000,00", "Dr. Ricardo Aguiar", "21 de jun., 11:20", nossa=False)}
{tratativa("", "Proposta inicial registrada", "R$ 60.000,00", "Camila Duarte", "18 de jun., 08:05")}
        </div>
      </div>

      <div class="border-t px-4 py-3">
        <div class="mb-2 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 dark:border-amber-900 dark:bg-amber-950/30">
          <span class="text-[11.5px] text-amber-800 dark:text-amber-200">Sem movimento há 31 dias. Próximo passo não agendado.</span>
        </div>
        <div class="flex flex-wrap gap-2">
          <button class="flex-1 rounded-md bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white">Registrar</button>
          <button class="flex-1 rounded-md border px-3 py-1.5 text-[12px] font-semibold">Agendar retorno</button>
          <button class="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[12px] font-semibold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">Fechar</button>
        </div>
      </div>
    </div>
  </div>"""


for nome, corpo, titulo in [("lista", lista, "Acordos — lista"), ("detalhe", detalhe, "Acordos — detalhe")]:
    (AQUI / f"{nome}.html").write_text(pagina(titulo, corpo), encoding="utf-8")
    print("gerado", nome)
