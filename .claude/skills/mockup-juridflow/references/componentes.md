# Receitas de componentes

CSS extraído dos mockups aprovados da Agenda. Copie o bloco, troque o
conteúdo. Se um componente que você precisa não está aqui, monte-o com os
tokens do `assets/base.html` antes de inventar valores novos.

- [Barra de filtros](#barra-de-filtros)
- [Popover de multi-seleção](#popover-de-multi-seleção)
- [Chips e legenda](#chips-e-legenda)
- [Alternador de visão (segmented)](#alternador-de-visão-segmented)
- [Calendário mensal](#calendário-mensal)
- [Swimlanes por pessoa (visão dia)](#swimlanes-por-pessoa-visão-dia)
- [Barra de carga de trabalho](#barra-de-carga-de-trabalho)
- [Rodapé de resumo](#rodapé-de-resumo)
- [Marcar o que é novo](#marcar-o-que-é-novo)
- [Paleta por pessoa](#paleta-por-pessoa)
- [Estado vazio](#estado-vazio)

---

## Barra de filtros

Um `.card` logo abaixo do cabeçalho, com uma ou duas linhas de controles.
Busca primeiro (é o que a pessoa procura), depois os selects, depois os
chips de estado ativo.

```css
.filtros { margin-top:18px; padding:14px 16px; display:flex; flex-direction:column; gap:11px; position:relative; }
.linha   { display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
```

`position:relative` na barra é o que ancora o popover. Sem isso ele escapa
do card.

## Popover de multi-seleção

O padrão para "filtrar por N pessoas": busca no topo, seções por equipe,
linha com checkbox + nome + contagem, rodapé com o total e o botão aplicar.

```css
.pop      { position:absolute; top:calc(100% + 8px); left:0; width:316px; z-index:5;
            background:#fff; border:1px solid #e2e8f0; border-radius:13px; padding:11px;
            box-shadow:0 24px 50px -18px #0f172a44; }
.pop-busca{ height:34px; border:1px solid #e2e8f0; border-radius:8px; display:flex; align-items:center;
            gap:8px; padding:0 10px; font-size:12.5px; color:#94a3b8; margin-bottom:9px; }
.pop-sec  { font-size:10px; font-weight:700; letter-spacing:.07em; text-transform:uppercase;
            color:#94a3b8; margin:9px 0 5px; display:flex; align-items:center; justify-content:space-between; }
.pop-sec .todos { color:#7c3aed; font-size:10.5px; font-weight:700; text-transform:none; letter-spacing:0; }
.row-p    { display:flex; align-items:center; gap:9px; padding:6px 5px; border-radius:7px; }
.row-p.on { background:#f5f3ff; }
.cbx      { width:15px; height:15px; border-radius:4px; border:1.6px solid #cbd5e1; flex:0 0 auto;
            display:flex; align-items:center; justify-content:center; }
.cbx.on   { background:#7c3aed; border-color:#7c3aed; }
.row-p .nome { flex:1; font-size:12.8px; font-weight:500; color:#1e293b; }
.row-p .qtd  { font-size:11px; color:#94a3b8; font-weight:600; }
.pop-rod  { border-top:1px solid #f1f5f9; margin-top:9px; padding-top:9px;
            display:flex; align-items:center; justify-content:space-between; }
.pop-rod .lim { font-size:11.5px; color:#64748b; font-weight:600; }
.pop-rod .apl { background:#7c3aed; color:#fff; font-size:11.5px; font-weight:700;
                border-radius:7px; padding:6px 14px; }
```

Deixe o popover **aberto** no mockup. Um select fechado não mostra nada — o
mockup existe justamente para o dono ver o que tem dentro.

## Chips e legenda

Chip neutro é branco com borda; chip ativo é tinta sólida (`#0f172a`), não
violeta — o violeta fica reservado para ação e novidade.

```css
.chip      { border:1px solid #e2e8f0; background:#fff; color:#475569; border-radius:999px;
             padding:5px 11px; font-size:11.5px; font-weight:500;
             display:inline-flex; align-items:center; gap:6px; }
.chip.dark { background:#0f172a; color:#fff; border-color:#0f172a; }
.chip .dot { width:6px; height:6px; border-radius:50%; }

.legenda { margin-top:14px; display:flex; align-items:center; gap:16px; flex-wrap:wrap;
           padding:10px 14px; background:#fff; border:1px solid #e2e8f0; border-radius:11px; }
.lg-t    { font-size:10.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:#94a3b8; }
.lg-i    { display:flex; align-items:center; gap:7px; font-size:12px; color:#334155; font-weight:500; }
.lg-i .sw{ width:11px; height:11px; border-radius:3px; }
.lg-i .n { color:#94a3b8; font-weight:600; font-size:11px; }
```

Sempre que a tela colore itens por alguma dimensão (pessoa, tipo, status),
a legenda é obrigatória — inclusive com a contagem de cada cor, que é o que
transforma legenda em informação.

## Alternador de visão (segmented)

```css
.views          { display:flex; gap:4px; background:#f1f5f9; padding:3px; border-radius:9px; }
.views span     { padding:6px 13px; font-size:12px; font-weight:600; color:#64748b; border-radius:7px; }
.views span.on  { background:#fff; color:#0f172a; box-shadow:0 1px 3px #0f172a1a; }
```

Variante para quando a visão ativa é a novidade que você quer destacar:

```css
.views span.on { background:#7c3aed; color:#fff; box-shadow:0 4px 10px -4px #7c3aed99; }
```

## Calendário mensal

```css
.cal     { margin-top:14px; flex:1; display:flex; flex-direction:column; overflow:hidden; }
.cal-top { display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-bottom:1px solid #f1f5f9; }
.mes     { font-family:'Poppins'; font-weight:700; font-size:16px; }
.nav-b   { width:30px; height:30px; border:1px solid #e2e8f0; border-radius:8px; display:flex; align-items:center; justify-content:center; }
.hoje-b  { border:1px solid #e2e8f0; border-radius:8px; padding:6px 13px; font-size:12px; font-weight:600; color:#334155; }

.dows      { display:grid; grid-template-columns:repeat(7,1fr); border-bottom:1px solid #f1f5f9; }
.dows div  { padding:8px 0; text-align:center; font-size:10.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:#94a3b8; }
.grid      { flex:1; display:grid; grid-template-columns:repeat(7,1fr); grid-auto-rows:1fr; }
.cel       { border-right:1px solid #f1f5f9; border-bottom:1px solid #f1f5f9; padding:6px 7px; overflow:hidden; }
.cel:nth-child(7n) { border-right:0; }
.cel .num  { font-size:11.5px; font-weight:600; color:#334155; }
.cel.out .num  { color:#cbd5e1; }
.cel.hoje .num { background:#7c3aed; color:#fff; width:20px; height:20px; border-radius:50%;
                 display:flex; align-items:center; justify-content:center; font-size:11px; }
.ev        { margin-top:3px; border-radius:5px; padding:2.5px 6px; font-size:10px; font-weight:600; color:#fff;
             white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:flex; align-items:center; gap:4px; }
.ev .ini   { font-weight:800; opacity:.75; font-size:8.5px; }
.mais      { margin-top:3px; font-size:9.5px; color:#94a3b8; font-weight:600; }
```

`overflow:hidden` na célula + `grid-auto-rows:1fr` é o que impede a grade de
empurrar o rodapé para fora do palco quando um dia tem muitos eventos. Use
`.mais` ("+3") em vez de listar tudo.

## Swimlanes por pessoa (visão dia)

Uma coluna por responsável, régua de horas à esquerda, blocos posicionados
em absoluto.

```css
.cols-head { display:grid; grid-template-columns:64px repeat(4,1fr); border-bottom:1px solid #e2e8f0; }
.col-h     { padding:11px 12px; border-left:1px solid #f1f5f9; }
.col-h:first-child { border-left:0; }
.ch-av     { width:31px; height:31px; border-radius:50%; display:flex; align-items:center; justify-content:center;
             color:#fff; font-size:11.5px; font-weight:700; flex:0 0 auto; }
.ch-nome   { font-size:13px; font-weight:700; color:#0f172a; line-height:1.15; }
.ch-setor  { font-size:10.5px; color:#94a3b8; font-weight:500; }

.grade   { flex:1; display:grid; grid-template-columns:64px repeat(4,1fr); overflow:hidden; position:relative; }
.horas   { border-right:1px solid #f1f5f9; }
.hora    { height:66px; padding:3px 8px 0 0; text-align:right; font-size:10px; color:#94a3b8; font-weight:600; border-bottom:1px solid #f8fafc; }
.col     { border-left:1px solid #f1f5f9; position:relative; }
.linha-h { height:66px; border-bottom:1px solid #f8fafc; }

.bloco      { position:absolute; left:6px; right:6px; border-radius:7px; padding:6px 8px; color:#fff;
              overflow:hidden; box-shadow:0 3px 8px -3px #0f172a44; }
.bloco .h   { font-size:10px; font-weight:700; opacity:.9; }
.bloco .t   { font-size:11.5px; font-weight:700; line-height:1.2; margin-top:1px; }
.bloco .c   { font-size:10px; opacity:.88; margin-top:2px; }

/* linha do "agora" */
.agora         { position:absolute; left:0; right:0; height:2px; background:#dc2626; z-index:3; }
.agora::before { content:""; position:absolute; left:-4px; top:-3px; width:8px; height:8px; border-radius:50%; background:#dc2626; }
```

Hora = 66px. Um bloco das 9h30 às 11h, com a régua começando às 8h, fica
`top: 1.5*66 = 99px; height: 1.5*66 = 99px`. Calcule na mão e escreva o
valor — nada de JS no mockup.

## Barra de carga de trabalho

O detalhe que fez a visão por equipe valer a pena: mostrar quem está
sobrecarregado, em vermelho, sem precisar contar os blocos.

```css
.carga           { margin-top:8px; display:flex; align-items:center; gap:8px; }
.barrinha        { flex:1; height:5px; background:#f1f5f9; border-radius:3px; overflow:hidden; }
.barrinha i      { display:block; height:100%; border-radius:3px; }
.carga .txt      { font-size:10.5px; font-weight:700; color:#64748b; white-space:nowrap; }
.carga .txt.alerta { color:#dc2626; }
```

## Rodapé de resumo

Fecha a tela com o número que importa e o alerta acionável.

```css
.rodape      { margin-top:12px; display:flex; align-items:center; gap:14px; padding:11px 15px;
               background:#fff; border:1px solid #e2e8f0; border-radius:11px; font-size:12.5px; color:#475569; }
.rodape b    { color:#0f172a; }
.pill-alerta { background:#fef2f2; border:1px solid #fecaca; color:#b91c1c; border-radius:999px;
               padding:4px 11px; font-size:11.5px; font-weight:700; display:inline-flex; align-items:center; gap:6px; }
```

## Marcar o que é novo

```css
.novo-wrap  { position:relative; }
.badge-novo { position:absolute; top:-9px; right:-9px; background:#059669; color:#fff;
              font-size:9px; font-weight:800; letter-spacing:.06em; padding:2.5px 7px; border-radius:20px; }
```

Um selo por mockup, no elemento mais importante. Dois ou três selos e o
olho não sabe mais para onde ir. Confira no PNG se ele não caiu em cima de
outro texto — `top`/`right` negativos escapam do card com facilidade.

## Paleta por pessoa

Fixa e nesta ordem, para a mesma pessoa ter a mesma cor entre mockups:

| # | cor | uso |
|---|-----|-----|
| 1 | `#7c3aed` violeta | também é o acento — funciona porque é a 1ª pessoa da lista |
| 2 | `#0891b2` ciano | |
| 3 | `#d97706` âmbar | |
| 4 | `#059669` esmeralda | |
| 5 | `#e11d48` rosa | |

Texto sempre `#fff` em cima — todas passam contraste. Para 6+ pessoas,
repita a sequência com `opacity:.75`; o mockup não precisa provar que
escala até 30.

## Estado vazio

```css
.vazio { position:absolute; top:50%; left:0; right:0; transform:translateY(-50%);
         text-align:center; color:#cbd5e1; font-size:12px; font-weight:600; }
```

Vale a pena deixar uma coluna/dia vazio de propósito: mostra que a tela não
quebra e dá contraste para as colunas cheias.
