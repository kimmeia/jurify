# Estudo do frontend a partir das telas REAIS — 11/09/2026

**Como este estudo foi feito:** o JuridFlow foi subido de verdade neste
ambiente (MariaDB local, 225 migrations, seed de staging, login como dono,
Termos aceitos), **povoado com dados jurídicos plausíveis** (10 clientes,
8 compromissos, 10 leads, 6 cards de Kanban, 7 cobranças, 7 monitoramentos,
7 movimentações) e fotografado em duas larguras: **1600px** e **390px**.
Receita em `docs/rodar-o-app-localmente.md`.

**Por que isso importa:** o estudo anterior (10/09) foi feito por `grep` e
foi reprovado pelo dono — *"seus mockups não retratam o de uso real hoje,
fez uma cópia barata e muito mal feita"*. Estava certo. Tudo aqui é foto ou
medição no navegador; onde for leitura de código, está dito.

> Telas vazias escondem defeito. A primeira rodada deste estudo, sem dados,
> dizia "nenhuma tela rola de lado no celular". Com dados, **quatro rolam**.
> Não estudar sistema vazio.

---

## 1. O que o sistema é hoje

Menu com **15 itens** em 4 grupos: Dashboard · Agenda · Atendimento |
Clientes · Processos · Acordos · Kanban | JurisIA (selo BETA) · Ponto ·
Cálculos · Modelos · Automações | Financeiro · Relatórios · Roadmap.
Barra escura, busca com `⌘K` no rodapé e cartão do usuário embaixo.

**Existem três linguagens de cabeçalho**, e duas delas são deliberadas:

| Tela | O que tem no topo | Tamanho renderido |
|---|---|---|
| Processos · Agenda | `<h1>` + subtítulo + pastilhas | **26px** |
| Relatórios · Automações · Roadmap · Agentes IA | `<h1>` sozinho | **24px** |
| Dashboard · Acordos | `<h1>` | **22px** |
| Atendimento · Tarefas | `<h1>` | **20px** |
| Ponto | `<h1>` "RH · equipe" | **18px**, peso 800 |
| **Clientes** | **hero branco**: selo "● CLIENTES", linha "Cadastro · histórico · documentos · financeiro", KPI "Clientes ativos", bloco ATENÇÃO com 3 mini-cards | — |
| **Financeiro** | **hero verde**: "PAINEL FINANCEIRO", intervalo de datas, 4 KPIs, tendência | — |
| Kanban · Modelos · Cálculos · JurisIA | sem título de tela | — |

Dashboard e Atendimento abrem com **saudação** ("Bom dia, Dono", "Boa
tarde, Dono! ☀️"), não com o nome da tela.

**Correção ao meu próprio documento:** a escala da Fatia 1 diz que `pagina`,
`secao` e `titulo` são "700 Poppins". **Não são.** Os `<h1>` do app renderizam
em **Inter 700** — o token só define tamanho, e a família vem do `body`.
Poppins (`--font-display`) existe no tema e praticamente não é usada nos
títulos. Corrigir a tabela da seção 3 daquele documento.

---

## 2. Achados, por gravidade

### 🔴 A — Celular: 4 de 8 telas rolam de lado

Medido em tela de **390px** (iPhone 12/13/14), depois de sair do "modo foco"
pelo "Abrir versão completa":

| Tela | Conteúdo | Estouro |
|---|---|---|
| Dashboard | 461px | +71px |
| Processos | 449px | +59px |
| Financeiro | 443px | +53px |
| Acordos | 430px | +40px |
| Clientes · Agenda · Kanban · Relatórios | cabem | — |

E dentro do Financeiro, **a tabela de cobranças tem 1.589px** — quatro vezes
a largura da tela.

**O "modo foco" é decisão de produto, não defeito.** No celular, escritório
com Atendimento contratado entra direto em `/atendimento` e só vê essa tela
(`modoFocadoMobile`, `AppLayout.tsx:507`); o resto fica atrás de "Abrir
versão completa". Ou seja: **quem usa o celular no padrão não esbarra
nisso** — mas quem abre a versão completa esbarra em metade das telas.

### 🔴 B — Financeiro no celular está quebrado em três pontos

Foto: `celular/completo-financeiro.png`.

1. **O botão "Nova cobrança" é cortado pela borda** e o menu "⋮" ao lado
   fica metade fora da tela.
2. **"R$ 10.7k" quebra em duas linhas** — "R$" em cima, "10.7k" embaixo.
3. **"AsaasR$ 0,00"** e **"ManualR$ 10.700,00"** — o rótulo cola no valor,
   sem espaço. É uma linha `justify-between` que ficou sem folga.

### 🟠 C — O mesmo dinheiro aparece em dois formatos

| Tela | Mesmo valor |
|---|---|
| Dashboard | **R$ 10.700,00** |
| Financeiro (hero) | **R$ 10.7k** |

`R$ 10.7k` tem **ponto decimal inglês** num sistema brasileiro. A origem:

```js
// client/src/pages/financeiro/helpers.tsx:54
if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(1)}k`;
```

`toFixed` sempre usa ponto. E essa função está **duplicada, idêntica**, em
`financeiro/helpers.tsx` e `dashboards/common.tsx` — mesmas 4 linhas, mesmo
defeito, dois arquivos.

Escala do problema (leitura de código): **32 formatadores de dinheiro
definidos localmente** no client, e **47 arquivos** chamam
`toLocaleDateString` direto, além de 10 formatadores de data próprios. Não
existe um helper de moeda/data compartilhado em `shared/`.

### 🟠 D — Processos: o nome do cliente é cortado com a tela vazia

Na lista de Movimentações, o nome ocupa **220px** e é truncado (o texto
real tem 252px) — enquanto sobram **1.065px vazios à direita**. "Maria
Aparecida Nogueira de Sousa" vira "Maria Aparecida Nogueira de…" sem
nenhuma necessidade. Foto: `desktop/processos.png`.

### 🟠 E — Agenda: a pílula "AGORA" cobre o título do evento

No fuso do evento em andamento, o marcador "AGORA ·" é desenhado **por
cima** do nome do compromisso — "Perícia médica" fica ilegível.
Foto: `desktop/agenda.png`.

### 🟡 F — Avisos empilhados antes do conteúdo

O Financeiro abre com **três sinais** antes da tabela: a pílula "Asaas
desconectado", a faixa "Asaas desconectado. Você está vendo apenas
cobranças manuais…" e a faixa "7 cobranças sem categoria — afeta o DRE".
As duas primeiras dizem a mesma coisa. Processos abre com uma faixa
("Saldo baixo").

### 🟡 G — Cinco tamanhos de título de tela

18 · 20 · 22 · 24 · 26px (tabela da seção 1). Não é o problema mais grave,
mas é o que faz a troca de tela "pular". **Atenção:** padronizar não pode
apagar a saudação do Dashboard/Atendimento nem rebaixar os heroes de
Clientes e Financeiro — os três são melhores que um `<h1>` seco.

---

## 3. O que está bom e não deve ser mexido

- **Clientes e Financeiro.** Os heroes são o melhor cabeçalho do sistema:
  nome da tela, o que ela faz, o número que importa e o que precisa de
  atenção — tudo antes da primeira rolagem. Devem ser o **modelo**, não o
  alvo.
- **A saudação** do Dashboard e do Atendimento. É escolha de produto.
- **Agenda.** O cartão "PRÓXIMO EVENTO 16:30 · em 2h10min" com os avatares
  do cliente e do responsável, os chips por tipo e a régua de horas é
  trabalho de gente que entende do assunto.
- **Estados vazios com ilustração** (Financeiro, Atendimento) — já existem
  e estão corretos.
- **Cor e menu**, como já registrado no estudo de 10/09.

---

## 4. Proposta, em ordem de retorno

| # | O quê | Por quê | Risco |
|---|---|---|---|
| 1 | **Um formatador de moeda e um de data em `shared/`** e trocar as 32+10 cópias | Dinheiro com ponto inglês é erro que o cliente vê. Conserta C e mata a duplicação | Baixo — função pura, dá para travar com teste |
| 2 | **Os três defeitos do Financeiro no celular** (B) | São recortes de layout, não redesenho | Baixo |
| 3 | **Nome truncado em Processos** (D) e **"AGORA" sobreposto na Agenda** (E) | Um esconde o nome do cliente, o outro esconde o compromisso | Baixo |
| 4 | **Estouro lateral das 4 telas** (A) | 40 a 71px de estouro — normalmente um `min-width` ou uma linha de botões que não quebra | Médio |
| 5 | **Tabela do Financeiro no celular** (1.589px) | Vira cartão abaixo de `md`, como Clientes já faz | Médio |
| 6 | **Unificar os 5 tamanhos de título** (G) | Só depois dos itens acima, e **preservando** heroes e saudação | Médio |

O item 1 é o único que mexe em algo além de CSS, e mesmo assim é função
pura — cabe no escopo "só telas" que o dono definiu.

---

## 5. Reprodução

```bash
# subir: docs/rodar-o-app-localmente.md
# povoar com dados jurídicos:
mariadb --default-character-set=utf8mb4 -uroot juridflow < scratchpad/estudo-telas/povoar.sql
# fotografar desktop + celular:
node scratchpad/estudo-telas/captura.mjs <destino> <sessao.json>
# celular na "versão completa" (fora do modo foco):
node scratchpad/estudo-telas/cel-completo.mjs <destino> <sessao.json>
# medir truncamento, avisos e tamanhos de título:
node scratchpad/estudo-telas/medir.mjs <sessao.json>
```

**Use `--default-character-set=utf8mb4` no mariadb.** Sem isso o seed entra
com acentuação quebrada ("petiÃ§Ã£o") e a foto vira um falso achado — foi o
que aconteceu na primeira rodada.

---

## 6. O que foi corrigido — proposta de 12/09/2026 (aguardando aprovação)

Branch `claude/proposta-visual-11-09`. **Nada foi mergeado**: o dono aprova
vendo o mockup navegável `mockup-navegavel-telas-reais.html`, que mostra as
telas do app rodando com chave Antes ⟷ Depois e Computador ⟷ Celular
(receita em `docs/mockup-navegavel.md`).

### Os 6 achados, medidos no navegador antes e depois

Largura do conteúdo num celular de **390px** — acima de 390 a página anda de
lado com o dedo:

| Tela | Antes | Depois | O que era |
|---|---|---|---|
| Dashboard | **461px** | 390px | régua de abas "Hoje · Semana · Mês · Trimestre" em linha reta |
| Processos | **449px** | 390px | fileira de botões do topo sem quebra |
| Movimentações | **449px** | 390px | a mesma fileira (é a mesma tela) |
| Tarefas | **437px** | 390px | filtros "Todas · Pendente · Em andamento · Concluída" na linha da busca |
| Financeiro | **443px** | 390px | régua de abas + duas tabelas empurrando a página |
| Acordos | **430px** | 390px | 3 cartões de resumo lado a lado até no celular |
| Clientes · Agenda · Kanban · Relatórios · Atendimento | cabem | cabem | — |

**11 de 11 telas cabem no celular; eram 5 de 11.** A medição sai do próprio
log do serializador (`ROLA DE LADO`), não de opinião — e as três causas eram
diferentes: tira de abas em linha reta (Dashboard, Financeiro), fileira de
botões sem quebra (Processos, Movimentações, Tarefas) e grid sem coluna
declarada no celular (Acordos — sem nenhuma coluna abaixo de `lg`, a coluna
implícita vale `auto` e cresce até o conteúdo).

Mais três consertos que não são de largura:

- **Agenda** — a pílula "AGORA" media **103px** num vão de 48px e entrava por
  cima da coluna das horas, cobrindo o nome do compromisso. Virou duas linhas
  (AGORA / 14:35) e termina exatamente onde a grade começa. (Medido dentro do
  navegável: antes 103px em 1 linha, depois 48px em 2 linhas.)
- **Movimentações** — a coluna do cliente tinha 220px fixos e escrevia
  "Maria Aparecida Nogueir…" com 1.065px vazios à direita. Cresce até 380px
  em monitor; no celular continua enxuta.
- **Dinheiro** — `R$ 10.7k` (ponto decimal inglês) virou `R$ 10,7 mil`.
  `shared/formato-numero.ts` é agora a única fonte: `moedaBR`,
  `moedaCurtaBR`, `numeroBR`, em cima de `Intl`. Os dois arquivos que tinham
  a função duplicada, idêntica e com o mesmo defeito
  (`financeiro/helpers.tsx` e `dashboards/common.tsx`) passaram a reexportar
  daí. Amarra: `server/__tests__/formato-numero.test.ts` trava a vírgula e
  proíbe `/1000 … toFixed` voltar nesses arquivos.

- **Tarefas** — na linha de apoio de cada tarefa lia-se `10/09/2026⚠`, com o
  triângulo de atraso desenhado **em cima** da data: os itens encolhiam abaixo
  do próprio texto porque a linha não quebrava. Agora quebram.

### Achados novos, que o estudo de 11/09 não tinha

**Tarefas rola de lado no celular** (437px) **e o aviso de atraso cai em cima
da data**. Não estavam na lista porque a tela estava **vazia** na primeira
rodada — não havia tarefa nenhuma no banco. Com 7 tarefas povoadas, os dois
defeitos apareceram. É a mesma lição de novo: tela vazia esconde defeito. O
`povoar.sql` ganhou tarefas, conversas, mensagens e um canal de WhatsApp por
isso — o Atendimento também estava vazio, e é a tela mais usada do sistema.

### O que NÃO foi mexido, e por quê

- **Item F (avisos empilhados no Financeiro)** — esconder ou juntar aviso é
  decisão de produto, e tirar um deles é remoção. Aguarda o dono.
- **Item G (cinco tamanhos de título)** — mexe em cabeçalho de tela, inclui a
  saudação do Dashboard/Atendimento e os heroes de Clientes/Financeiro, que
  são deliberados e bons. Precisa de mockup próprio e autorização.
- **Tabela do Financeiro virar cartão no celular** (1.589px de largura) — hoje
  ela rola dentro da própria moldura, que resolve o estouro da página. Virar
  cartão é redesenho, não recorte.
- **Contraste do valor no hero verde do Financeiro** — verde-escuro sobre
  verde. É decisão de cor; o dono decide.
- **Na linha da tarefa, o título é cortado no celular** ("Cobrar entrada d…")
  porque os botões de ação da linha só aparecem no `hover` — que no celular
  nunca acontece — e mesmo invisíveis ocupam a largura que falta ao título.
  Consertar é decidir o que a linha mostra num celular: mockup próprio.
- **47 telas formatam data na mão.** O formatador de dinheiro ficou pronto; o
  de data é o mesmo tipo de conserto, maior.

### Amarras e conferência

- `server/__tests__/formato-numero.test.ts` (7 testes) trava a vírgula e
  proíbe `/1000 … toFixed` voltar nos dois arquivos.
- `server/__tests__/telas-cabem-no-celular.test.ts` (8 testes) guarda as três
  causas de estouro encontradas no navegador (tira de abas sem rolagem,
  fileira sem `flex-wrap`, grid sem coluna declarada) mais a pílula da Agenda
  e a coluna de Movimentações. **14 mutações conferidas, todas vermelhas**
  (`scratchpad/mutar-telas-celular.py`) — as duas primeiras versões da amarra
  passavam com a classe apagada, porque o trecho vizinho tinha a palavra.
- O navegável foi **dirigido por Playwright** (`confere-navegavel.mjs`): 46
  combinações, nenhuma vazia, nenhum erro de página. E `confere-fidelidade.mjs`
  confere dentro do iframe os números que foram medidos no app: coluna do nome
  220 → 380px, pílula 103px/1 linha → 48px/2 linhas, `R$ 10.7k` → `R$ 10,7 mil`,
  altura do valor no celular 48px → 20px. **7/7 conferem.**

### Onde está o arquivo

`mockup-navegavel-telas-reais.html` (4,4 MB, auto-contido). **Não é
versionado**: é reproduzível pelos scripts, e um HTML de 4 MB por proposta
engorda o repositório rápido. Receita em `docs/mockup-navegavel.md`; o
arquivo vai para o dono pelo chat.
