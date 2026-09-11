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
