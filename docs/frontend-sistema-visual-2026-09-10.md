# Sistema visual do frontend — estudo, plano e estado

**Data do estudo:** 10/09/2026 · **Branch:** `claude/legal-system-frontend-hkcits`
**Escopo autorizado pelo dono:** SÓ TELAS. Nada de backend, nada de procedure,
nada de migration. "não mecha no backend, vamos apenas desenvolver as telas."

**Linha do tempo das decisões dele em 10/09**, na ordem:
1. "Mockup hoje, código depois do lançamento" — resposta à pergunta de ritmo.
2. Mockups entregues (seção 8) e aprovados: **"pode fazer"**.
3. Fatia 1 implementada na mesma sessão (seção 9).

4. **"pode mergear"** — Fatia 1 mergeada em `develop` e `main` no mesmo dia,
   com `--no-ff`, na ordem da regra do CLAUDE.md. Staging e produção
   receberam a mudança em 10/09.

O "pode fazer" veio depois de ele ver os mockups, e no vocabulário do projeto
é a autorização para virar código; o "pode mergear" veio depois de ler o
relatório da Fatia 1, com a ressalva de QA visual explícita na mensagem.

Este arquivo é a fonte de verdade do assunto "sistema visual" para qualquer
agente que entrar depois. Atualize-o a cada entrega, stand-by ou correção.

---

## 1. O que foi medido (números reais, não impressão)

Comandos de medição ficam na seção 7 para qualquer agente reproduzir.

| O que | Medida | Leitura |
|---|---|---|
| Cores cruas do Tailwind (`bg-blue-500`, `text-slate-700`…) | **0** | Disciplina de cor 100%. Nada a fazer aqui. |
| Usos de token semântico (`text-danger-fg`, `bg-success-bg`…) | **9.639** | A migração de cor já foi feita em sessões anteriores. |
| Tamanhos de fonte arbitrários `text-[Npx]` | **2.856 ocorrências** | O problema central. |
| Valores DISTINTOS de fonte arbitrária | **33** | Um sistema de design precisa de 6 a 8. |
| Ocorrências com **10px ou menos** | **1.501** | Piso de legibilidade furado. |
| Ocorrências com **9px ou menos** | **~340** | Inclui 7px, 7.5px, 8px, 8.5px. |
| Raios arbitrários `rounded-[Npx]` | 40 (10 valores) | Menor, mas mesma causa. |
| Telas com `<Table>` | 16 | — |
| Dessas, **sem** versão de celular | **16 de 16** | Nenhuma tabela do sistema funciona no telefone. |
| Telas que montam o próprio cabeçalho `h1` | **47** | Sem `PageHeader` compartilhado. |
| Tamanhos distintos de título de página | **4** (`text-[27px]`, `text-2xl`, `text-xl`, nenhum) | Cada tela parece de um autor diferente. |
| Ritmo de container (`space-y-`) | 3, 3.5, 4, 6 — alguns com padding, outros não | Respiro muda ao trocar de tela. |
| Uso do primitivo `ui/empty.tsx` que já existe no repo | **0** | 81 telas escrevem "Nenhum…" à mão. |
| `Loader2` (girinho) × `Skeleton` (esqueleto) | 99 × 47 | Duas linguagens de carregamento concorrendo. |
| Rotas no `App.tsx` | 72 | — |

### O que está BOM e não deve ser mexido

- **Paleta e tokens de cor.** `client/src/index.css` tem paleta semântica
  completa em OKLCH, light + dark, com tinta sobre preenchimento
  (`--*-on`), paleta categórica do JurisIA validada pra daltonismo, e a
  marca deliberadamente fora da paleta do produto. É trabalho bom e já
  aplicado em 9.639 pontos.
- **Arquitetura de informação do menu.** `AppLayout.tsx` agrupa 16 itens em
  4 grupos (Dia a dia · Carteira · Ferramentas · Gestão) com gating por
  módulo contratado, `soSemModulo` e badges. Não há problema de navegação.
- **Regra de cor de status já escrita no CSS:** verde = "em dia", âmbar =
  "tem coisa nova", vermelho = **só** o que exige ação hoje. Respeitar.

### As 10 telas mais afetadas (fonte arbitrária ≤10px / total arbitrário)

| Tela | Linhas | ≤10px | Total `text-[px]` |
|---|---|---|---|
| `SmartFlowEditor.tsx` | 6.528 | 149 | 192 |
| `Processos.tsx` | 5.149 | **118** | 178 |
| `Relatorios.tsx` | 2.680 | 84 | 95 (e 70 `<Card>`) |
| `Agenda.tsx` | 3.891 | 80 | 135 |
| `Atendimento.tsx` | 4.729 | 76 | 168 |
| `Clientes.tsx` | 4.355 | 76 | 102 |
| `financeiro/Relatorios.tsx` | 1.098 | 55 | 80 |
| `Configuracoes.tsx` | 2.300 | 49 | 108 |
| `Kanban.tsx` | 1.840 | 48 | 57 |
| `atendimento/customer-panel.tsx` | 1.531 | 43 | 62 |

---

## 2. O diagnóstico em uma frase

A cor é um sistema; a **tipografia não é sistema nenhum**. Cada tela inventou
seus próprios pixels, e o resultado é que informação que o advogado precisa
ler todo dia está em corpo 9px.

### A prova: uma linha da lista de Processos

`Processos.tsx:1283-1357` — uma única linha da lista usa **6 tamanhos**:

| Elemento | Tamanho hoje | O que é |
|---|---|---|
| Nome do caso | `text-[13px]` bold | o que identifica a linha |
| Selo "Pausado" / "2º grau?" | **`text-[9px]`** bold uppercase | estado do monitoramento |
| CNJ + tribunal | `text-[10.5px]` mono | o número do processo |
| Última movimentação / motivo da parada | `text-[12px]` | **o conteúdo da linha** |
| Tempo ("há 3 dias") | `text-[11.5px]` semibold | quando |
| Rótulo ("última mov.") | `text-[10px]` | o que o tempo significa |

Nada disso é decoração. `2º grau?` avisa que o processo subiu pra recurso —
e está em 9px. Em `Processos.tsx:1520-1526` o **prazo** também sai em 9px.

### Por que isso importa neste nicho, especificamente

Três razões, em ordem de peso:

1. **Quem lê é advogado, e lê o dia inteiro.** Grande parte do público tem
   40+ e usa óculos. 9px num monitor comum dá ~6,8pt — menor que a letra
   miúda de contrato. Fadiga visual não vira reclamação de design, vira
   "esse sistema me cansa".
2. **O que está pequeno é justamente o que é crítico.** Prazo, "2º grau?",
   instância, tribunal. O alarme está no corpo menor da tela.
3. **Tamanho é hierarquia.** Com 33 tamanhos não existe hierarquia — existe
   ruído. É exatamente isso que faz um sistema parecer feito em casa, mesmo
   com a paleta certa. Produto caro tem POUCOS tamanhos, bem escolhidos.

---

## 3. A escala proposta — 7 degraus, piso de 11px

Substitui os 33 valores. Nomes em português, no padrão do repo.

| Token | px | Peso | Uso | Absorve hoje |
|---|---|---|---|---|
| `micro` | **11** | 700, caps, `.06em` | rótulo de seção, cabeçalho de coluna, selo | 7 · 7,5 · 8 · 8,5 · 9 · 9,5 · 10 · 10,5 |
| `apoio` | **11,5** | 500 | meta, carimbo de tempo, ajuda | 10 · 10,5 · 11 · 11,5 |
| `corpo` | **13** | 500/600 | texto de lista, controle, valor | 12 · 12,5 · 12,8 · 13 · 13,5 · `text-xs` · `text-sm` |
| `secao` | **15** | 700 Poppins | título de card | 14 · 14,5 · 15 · `text-base` · `text-lg` |
| `titulo` | **20** | 700 Poppins | título de aba / subpágina | 17 · 18 · 19 · 20 · `text-xl` |
| `pagina` | **26** | 700 Poppins | título da tela | 22 · 24 · 26 · 27 · 28 · `text-2xl` · `text-3xl` |
| `numero` | **22** | 700 tabular | KPI de cartão | 19 · 22 · 26 · 30 · 34 · 38 · 42 |

**A regra que resolve o problema de verdade: nada abaixo de 11px.**

### A descoberta que faz o piso sair quase de graça

O selo de 9px é `font-bold uppercase tracking-[0.04em]`. Maiúscula + negrito
+ espaçamento extra + minúsculo é a pior combinação possível de legibilidade
— e também é **larga**, porque maiúscula ocupa mais que minúscula.

Medido no próprio Chromium com a fonte Inter real
(`scratchpad/mede.mjs`, não estimativa):

| Selo | 9px caixa alta | 11px caixa normal | Diferença |
|---|---|---|---|
| `2º grau?` | 45,9px | 45,2px | **−0,8px** |
| `Pausado` | 46,7px | 46,0px | **−0,7px** |
| `Baseline` | 46,7px | 45,1px | **−1,6px** |
| `1ª inst.` | 37,0px | 35,5px | **−1,5px** |
| `prazo vence hoje` | 96,7px | 90,9px | **−5,7px** |
| `TJCE` | 24,0px | 27,4px | **+3,4px** |

**Onde há palavra, a versão legível é mais estreita** — quanto mais longo o
selo, mais se economiza. **A exceção são siglas** (`TJCE`, `TRF1`, `CNJ`):
já nascem em maiúscula, não têm minúscula a ganhar, e crescem ~3px. São
poucas e curtas, mas é onde pode apertar.

Conclusão prática: o piso de 11px não custa espaço na maioria dos selos.
Ainda assim, isso se confirma no PNG a cada tela — não se assume.

### Risco honesto desta mudança

Subir fonte em tela densa pode transbordar layout. Onde o texto cresce de
fato (não os selos), a linha pode quebrar ou a coluna estourar. Por isso o
plano aplica **tela por tela com conferência visual**, nunca num `sed` global
sobre 2.856 pontos. Um `sed` global é a forma errada de fazer isso e não
deve ser tentada por nenhum agente.

---

## 4. O plano, em 4 fatias implementáveis

Ordem escolhida por retorno sobre risco. O dono pode parar em qualquer fatia.

### Fatia 1 — Escala + piso de legibilidade (recomendada como primeira)
Criar os 7 tokens e aplicar nas 6 telas que o escritório usa todo dia:
Processos, Clientes, Atendimento, Agenda, Kanban, Financeiro.
- Ganho: a percepção de qualidade muda na hora, e o prazo em 9px sai do ar.
- Risco: médio (densidade). Mitigação: tela por tela, PNG conferido.
- Não entra: SmartFlowEditor e admin (fatia 4).

### Fatia 2 — Cara de produto único
`PageHeader` compartilhado (título `pagina` + uma linha de subtítulo +
pastilhas + ações à direita), ritmo de container único, e **uma** linguagem
de carregamento (esqueleto para lista/tabela, girinho só em botão) e de
lista vazia (adotar o `ui/empty.tsx` que já existe e ninguém usa).
- Ganho: 47 telas param de parecer 47 autores.
- Risco: baixo. É extração de padrão, não redesenho.

### Fatia 3 — Celular
As 16 telas com tabela ganham versão de cartão abaixo de `md`. Prioridade
para as de operador: `Financeiro`, `Relatorios`, `financeiro/Comissoes`,
`financeiro/Despesas`. Admin é desktop e pode ficar por último.
- Ganho: advogado consulta no corredor do fórum.
- Risco: baixo (aditivo — a tabela continua existindo no desktop).

### Fatia 4 — Resto do sistema
SmartFlowEditor (149 pontos ≤10px, mas é tela de especialista, usada por
poucos) e as 24 telas de admin.

### Regra de qualidade para qualquer fatia
Antes de qualquer merge: `pnpm check` limpo, `pnpm test` 100% verde,
`pnpm vite build` passando. E um teste de amarra que trave o piso — uma
varredura que **falha** se aparecer `text-[Npx]` com N < 11 nas telas já
migradas, no mesmo espírito do `react-hooks-apos-return.test.ts`. Sem essa
amarra o 9px volta na primeira tela nova.

---

## 5. Achado de processo: a skill de mockup está desatualizada

`.claude/skills/mockup-juridflow/assets/base.html` e
`references/componentes.md` definem a cor de ação como **violeta `#7c3aed`**.
O produto **não é mais violeta**: `index.css` usa navy
`oklch(0.413 0.112 255)` = `#194b86`, e o comentário no próprio arquivo diz
que o violeta "doía na vista" e foi abandonado. O violeta sobrevive apenas
como **marca/logo** (`--marca` = `#7f22fe`), de propósito fora da paleta do
produto.

Consequência prática: mockup feito seguindo a skill ao pé da letra sai com a
cor que o dono já rejeitou e não representa o produto.

**Estado: a corrigir, depois de o dono aprovar o tom do mockup navy.**
Os mockups deste estudo já usam a paleta navy real.

### Tokens reais de produção em hex (para mockups)

Convertidos de OKLCH com `scratchpad/ok2hex.mjs`. Tema claro:

| Token | Hex | Uso |
|---|---|---|
| `primary` / `hero` | `#194b86` | ação primária, navy da marca no produto |
| `hero-2` | `#11325c` | fim do gradiente da faixa |
| `background` | `#f4f6f8` | fundo da página |
| `card` | `#ffffff` | superfície |
| `border` | `#dfe4ea` | borda de card/controle |
| `foreground` | `#16202c` | tinta de título e número |
| `secondary-foreground` | `#33404f` | texto de controle |
| `muted-foreground` | `#5a6b7d` | subtítulo, legenda |
| `neutral` | `#6d7d8c` | micro-label, ícone |
| `muted` / `secondary` | `#eef1f4` | fundo de trilho/segmented |
| `accent-bg` | `#eaf1f8` | fundo de controle selecionado |
| `success` / `-bg` | `#097245` / `#e9f6ef` | "em dia" |
| `warning` / `-bg` | `#8a5a0b` / `#fdf6e7` | "tem coisa nova" |
| `danger` / `-bg` | `#a8231b` / `#fdf0ef` | **só** o que exige ação hoje |
| `sidebar` | `#16202c` | menu (escuro nos dois temas) |
| `sidebar-foreground` | `#c4ced8` | texto do menu |
| `sidebar-accent` | `#24384f` | item ativo do menu |
| `sidebar-primary` | `#6fa5dd` | acento sobre o menu escuro |
| `marca` | `#7f22fe` | **só a logo**, nunca ação |

---

## 6. Estado de cada item

### Feito
- Estudo e medição de todo o `client/` (72 rotas, ~100 arquivos de tela).
- Tradução dos tokens OKLCH de produção para hex (`ok2hex.mjs`).
- Este documento.
- Mockups (seção 8), aprovados pelo dono com "pode fazer".
- **Fatia 1 implementada** (seção 9): escala em `index.css` + 673 pontos
  migrados nas 6 telas do dia a dia + amarra `escala-tipografica.test.ts`.

### Aguardando o dono
- **Conferência visual no app rodando.** Ver a ressalva na seção 9: daqui
  não dá para subir o app (precisa de banco), então build + testes provam
  que compila e que a regra vale, mas não provam que nenhuma tela ficou
  apertada. **É o único risco aberto desta entrega, e ela já está em
  produção** — foi mergeada com essa ressalva dita na mensagem. Olhar
  primeiro: lista de Processos, cartões do Kanban, painel do cliente no
  Atendimento.
- **Escolher a próxima fatia** (2 · cara de produto único, 3 · celular,
  4 · resto do sistema).
- **O selo "CPF diferente"** (Clientes, "Vincular a cliente") continua em
  caixa alta. Veio de `develop` durante o merge da Fatia 1 e tem o MESMO
  papel dos dois selos da lista de Processos que viraram caixa normal.
  Deixei como estava porque virar caixa normal é mudança visível e ele só
  aprovou aquela troca para os dois selos do mockup. Pergunta de uma linha
  quando ele voltar ao assunto.

### Stand-by explícito (não reabrir sozinho)
- **`text-xs` e `text-sm`.** Ficaram fora da Fatia 1 de propósito — motivo
  na seção 9. Só entram com o app visível.
- **Atualizar a skill `mockup-juridflow` para navy.** Ele aprovou os
  mockups em navy, o que resolve a dúvida do tom; falta só executar. Não é
  bloqueante para nada.
- **Backend.** Fora de escopo por ordem expressa dele nesta sessão.

### Nada foi removido
Valem as duas regras do dono: mockup antes de qualquer mudança visível
(cumprido — os três mockups vieram antes), e nunca remover sem autorização
expressa. A única remoção da Fatia 1 é o `uppercase tracking-[0.04em]` de
DOIS selos da lista de Processos, que é exatamente o que o mockup aprovado
mostrava, e está travada por teste.

---

## 9. Fatia 1 — entregue em 10/09

### O que mudou

**`client/src/index.css`** — os 7 degraus no `@theme inline`, com o porquê
escrito no próprio arquivo. **Sem `line-height` pareado**, de propósito:
`text-[10px]` também mexia só no `font-size`, então trocar por token não
podia arrastar o espaçamento vertical junto e mudar layout que ninguém pediu.
Conferido no CSS gerado — sai `.text-micro{font-size:11px}`, e só isso.

**As 6 telas do dia a dia** — 673 pontos, de 16 valores distintos para 5
degraus, via `scratchpad/mockup-tipografia/aplicar-escala.py` (roda com
`--seco` primeiro):

| De | Para | Quantos |
|---|---|---|
| 10px | `text-micro` (11px) | 292 |
| 11px | `text-apoio` (11,5px) | 131 |
| **9px** | `text-micro` (11px) | **96** |
| 10,5px | `text-apoio` | 43 |
| 11,5px | `text-apoio` | 27 |
| 13px | `text-corpo` (13px) | 20 |
| 9,5px | `text-micro` | 20 |
| 12,5 · 12 · 12,8 · 13,5px | `text-corpo` | 25 |
| 8 · 8,5 · 7px | `text-micro` | 13 |
| 15px | `text-secao` | 3 |
| 19px | `text-titulo` | 1 |
| 27px | `text-pagina` (26px) | 2 |

Resultado: **zero `text-[Npx]` nas 6 telas**. Restam 2.183 no resto do
sistema, que é a Fatia 4.

**Dois selos da lista de Processos** (`Pausado`, `2º grau?`) perderam
`uppercase tracking-[0.04em]` e trocaram `font-bold` por `font-semibold` —
é o que o mockup aprovado mostra, e é o que faz o piso de 11px sair de graça
em largura. Os outros pills em caixa alta (`IA`, `AES-256`, `Novo`,
`Em tempo real`) **não** foram tocados: são siglas e marcadores de destaque,
papel diferente, e não estavam no mockup.

### A amarra

`server/__tests__/escala-tipografica.test.ts` (9 testes):
1. os 7 degraus estão declarados no `index.css`;
2. nenhum degrau desce abaixo de 11px;
3. cada uma das 6 telas migradas não volta a escrever tamanho na mão;
4. o selo "2º grau?" continua `text-micro` e continua fora da caixa alta.

**Conferida por mutação** (`scratchpad/mockup-tipografia/mutar-escala.py`):
5 mutações, todas vermelhas. Teste que passa não prova nada.

`TELAS_MIGRADAS` no topo do teste é a lista que cresce a cada fatia — é essa
linha que impede a migração de desandar. **Ao migrar uma tela, acrescente-a
lá.**

### O que NÃO entrou, e por quê

- **`text-xs` (12px) e `text-sm` (14px).** São 490 usos nessas 6 telas.
  Levar `xs` para `corpo` cresce 1px em 339 pontos densos — é a mudança com
  maior chance de apertar layout, e é a que eu menos consigo verificar
  daqui. Levar `sm` para `corpo` encolhe 1px (seguro), mas fazer só isso
  aproximaria `sm` de `xs` e **achataria** a hierarquia onde hoje ela vem
  do contraste 14 × 12. Ou os dois juntos, com o app na tela, ou nenhum.
  Ficou nenhum.
  Consequência assumida: as 6 telas usam 11 · 11,5 · 12(`xs`) · 13 · 14(`sm`)
  · 15. São 6 tamanhos em vez dos 7 degraus puros — bem melhor que os 17 de
  antes, e sem risco.
- **Números grandes (KPI).** `text-numero` está declarado e ainda não é
  usado; os KPIs continuam em `text-2xl`. Escolher entre `numero` (22px) e
  `pagina` (26px) é decisão de papel, não de tamanho, e um mapeamento cego
  encolheria um KPI de 42px para 22px sem ninguém pedir. Fatia 2.
- **As outras 94 telas.** Fatias 2 a 4.

### Ressalva honesta sobre a verificação

O que foi provado: `pnpm check` limpo · `pnpm test` verde · `pnpm vite build`
passa · as classes saem corretas no CSS gerado · a amarra fica vermelha
quando o código quebra.

O que **não** foi provado: que nenhuma tela ficou visualmente apertada.
Deste ambiente não dá para subir o app (precisa de `DATABASE_URL`), então
não houve QA visual no produto real. A medição de largura da seção 3 diz que
os selos não crescem, e o `line-height` não foi tocado, o que limita muito o
risco — mas limitar não é eliminar. **Quem abrir o app deve olhar primeiro
as linhas mais densas**: lista de Processos, cartões do Kanban e o painel do
cliente no Atendimento.

### O merge com `develop` (mesmo dia)

`develop` tinha andado 5 commits enquanto a Fatia 1 era feita, e um deles
mexia em `Clientes.tsx` — uma das 6 telas migradas. Conflito em um bloco:
develop reescreveu a linha de "Vincular a cliente" e acrescentou o selo
**"CPF diferente"**. Resolução: ficou a versão de develop **inteira** (nada
do que ele ganhou foi descartado), com a escala aplicada por cima. Os três
tamanhos soltos que vieram junto no aviso de unificação (11 · 10,5 · 10px)
viraram `apoio`/`micro` pela mesma regra — sem isso a amarra ficaria
vermelha, que é exatamente o trabalho dela.

**Lição:** a amarra pegou tamanho solto chegando por merge, não só por
código novo. Era o objetivo.

### Efeito colateral corrigido

`kanban-campo-vazio-atraso-coluna-tags.test.ts` recortava a tela com
`indexOf('<p className="text-[10px] …">EDITAR</p>')`. O codemod trocou a
classe, o `indexOf` virou −1 e o teste passou a olhar o lugar errado.
Reancorado em `">EDITAR</p>"`, que não depende de estilo — âncora única no
arquivo, então o recorte é idêntico ao de antes e o teste não enfraqueceu.
**Lição para as próximas fatias:** teste que ancora em classe de estilo
quebra na migração; ancore em texto ou em `data-testid`.

---

## 7. Como reproduzir as medições

```bash
# fonte arbitrária: total, valores distintos e os piores arquivos
grep -rhoE 'text-\[[0-9.]+px\]' client/src --include=*.tsx | wc -l
grep -rhoE 'text-\[[0-9.]+px\]' client/src --include=*.tsx | sort | uniq -c | sort -rn
grep -roE 'text-\[[0-9.]+px\]' client/src --include=*.tsx | cut -d: -f1 | sort | uniq -c | sort -rn | head

# abaixo do piso de 11px
grep -rhoE 'text-\[(7|7\.5|8|8\.5|9|9\.5|10|10\.5)px\]' client/src --include=*.tsx | wc -l

# cor crua (tem que dar 0) × token semântico
grep -roE '\b(bg|text|border)-(slate|gray|red|amber|green|blue|violet)-[0-9]{2,3}' client/src --include=*.tsx | wc -l
grep -roE '\b(bg|text|border)-(info|warning|success|danger|neutral|muted|primary)(-(bg|fg|on))?\b' client/src --include=*.tsx | wc -l

# tabela sem versão de celular
for f in $(grep -rl '"@/components/ui/table"' client/src/pages --include=*.tsx); do
  grep -q 'md:hidden\|hidden md:' "$f" || echo "SEM MOBILE: $f"; done
```

---

## 8. Mockups deste estudo

Na raiz do repo, no padrão `mockup-<assunto>.html`. PNGs são reproduzíveis e
não versionados:

```bash
node .claude/skills/mockup-juridflow/scripts/render.mjs mockup-<arquivo>.html
```

| Arquivo | O que mostra |
|---|---|
| `mockup-tipografia-antes.html` | A tela Processos como está hoje, fiel ao código: 6 tamanhos numa linha, selo e prazo em 9px. |
| `mockup-tipografia-depois.html` | A mesma tela com a escala de 7 degraus e o piso de 11px. |
| `mockup-tipografia-escala.html` | A linha ampliada (antes × depois), a escala, a prova de largura medida, o que já está bom e o plano em 4 fatias. |

`antes` e `depois` saem do MESMO gerador
(`scratchpad/gera.mjs`): mesmo conteúdo, mesma grade, mesmas cores — a
**única** diferença entre os dois arquivos é o bloco de tipografia. É o que
torna a comparação honesta, e é como deve ser refeito se mudarem.

### Notas de produção dos mockups (para o próximo agente)

- `node_modules` do repo estava vazio nesta sessão, então
  `scripts/render.mjs` não achava o Playwright. Solução sem tocar no repo:
  `npm i playwright-core` no scratchpad e rodar com
  `NODE_PATH=<scratchpad>/node_modules node .claude/skills/.../render.mjs`.
  O Chromium do ambiente já está em `/opt/pw-browsers`.
- **Duas armadilhas de overflow caíram nesta sessão**, ambas invisíveis para
  o checador do render:
  1. Lista com uma linha a mais do que cabe: o `overflow:hidden` do card
     cortou a última linha em silêncio.
  2. Card dentro de `.col` flex encolhendo em vez de transbordar — o
     conteúdo era clipado e o checador não acusava porque "tecnicamente
     coube". Corrigido com `flex:0 0 auto` no `.card`. **Deixe assim**: com
     isso, estouro vira erro visível em vez de corte mudo.
- O olho pegou o que o script não pegou nas duas vezes. Não pular o passo 3
  da skill (ler o PNG com o Read).
