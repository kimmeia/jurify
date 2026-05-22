# SmartFlow — Proposta de redesign visual

**Status:** Mockup para aprovação. Nenhum código alterado ainda.
**Escopo:** apenas visual (layout, cores, hierarquia). Lógica do motor, dispatcher, schedulers e tudo que envolve "como o sistema executa as automações" — **não mexe**.

---

## TL;DR — O que muda

| | Antes | Depois |
|---|---|---|
| Lista de cenários | Header simples, 3 botões soltos | Hero com gradiente, **4 KPIs no topo** (alinhado com Agentes IA) |
| Cards de cenário | Genéricos, todos iguais | **Borda esquerda colorida por categoria de gatilho** (igual cards de agente) |
| Aba Execuções | Lista plana, pouca informação | Filtros + status visíveis + indicador de tempo |
| Editor — topo | Top bar minimalista, "perdido" | Top bar com identidade do módulo + **indicador de salvo/não salvo** + switch Ativo |
| Editor — paleta | Confunde gatilho com passos | Seção **GATILHO** destacada + **AÇÕES** organizadas |
| Editor — canvas | Plano, sem hierarquia | Background sutil + mini-toolbar (zoom, validar, autoarranjo) |
| Editor — painel direito | 320px, apertado | 360px, com abas internas pra configs grandes |

---

## TELA 1 — Lista de cenários (`/smartflow`)

### Estado atual (o que está hoje)

```
┌─────────────────────────────────────────────────────────────────┐
│ ⚡ SmartFlow             [Atendimento] [Pgto→Kanban] [+ Novo]   │
│    Automações inteligentes — WhatsApp + IA + Cal.com            │
├─────────────────────────────────────────────────────────────────┤
│ [ Cenários ] [ Execuções ]                                      │
├─────────────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│ │⚡ Card 1 │ │⚡ Card 2 │ │⚡ Card 3 │ │⚡ Card 4 │   (cards     │
│ │          │ │          │ │          │ │          │   iguais,   │
│ │ Gatilho  │ │ Gatilho  │ │ Gatilho  │ │ Gatilho  │   sem cor)  │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

**Problemas:**
1. Não tem identidade visual do módulo (qualquer página parecida)
2. Não mostra "saúde" do SmartFlow (quantos cenários ativos? Quantas execuções? Está dando erro?)
3. Cards são todos iguais — não consegue ver de relance "este é de WhatsApp", "este é de Asaas"
4. Tab "Execuções" não tem filtro nem agregação (lista crua)

### Proposta

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ╔══════════════════════════════════════════════════════════════════════╗ │
│ ║ ┌────┐ SmartFlow                                                     ║ │ Hero card
│ ║ │ ⚡ │ ✨ Automações inteligentes · WhatsApp · Asaas · Cal.com       ║ │ gradiente
│ ║ └────┘                                              [+ Novo cenário] ║ │ violet→pink
│ ║                                                                      ║ │ (igual ao
│ ║ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ║ │ AgentesIA)
│ ║ │ 🔵 4 Ativos  │ │ 💬 142 30d   │ │ ✅ 96% sucesso │ │ ⏱ 1.2s avg │ ║ │
│ ║ │ KPI violet   │ │ KPI emerald   │ │ KPI amber    │ │ KPI fuchsia  │ ║ │ KPI cards
│ ║ └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ ║ │
│ ╚══════════════════════════════════════════════════════════════════════╝ │
│                                                                          │
│ [ Cenários (4) ] [ Execuções (142) ]      [🔍 Buscar...] [Filtro ▾]     │
│                                                                          │
│ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐          │
│ │┃ 💬 WhatsApp QR  │ │┃ 💰 Pgto recebido│ │┃ 📅 Lembrete Cal │          │
│ │┃                 │ │┃                 │ │┃                 │          │
│ │┃ Atendimento     │ │┃ Pgto → Kanban   │ │┃ Lembrete 1d antes│         │
│ │┃ 5 passos        │ │┃ 3 passos        │ │┃ 2 passos        │          │
│ │┃                 │ │┃                 │ │┃                 │          │
│ │┃ ▼ 28 execuções  │ │┃ ▼ 14 execuções  │ │┃ ▼ 3 execuções   │          │
│ │┃                 │ │┃                 │ │┃                 │          │
│ │┃ [✏] [⬤Ativo] [🗑]│ │┃ [✏] [⬤Ativo] [🗑]│ │┃ [✏] [○Inativ][🗑]│        │
│ └──────────────────┘ └──────────────────┘ └──────────────────┘          │
│   ^                                                                      │
│   bordas coloridas: azul=mensagem, verde=Asaas, laranja=Cal.com,         │
│                     violeta=CRM, cinza=manual                            │
└──────────────────────────────────────────────────────────────────────────┘
```

**Detalhes visuais:**

- **Hero**: mesmo padrão de `AgentesHero` — `rounded-2xl`, fundo gradiente violet→indigo→pink (8% opacidade), borda sutil. Ícone `Zap` num quadrado gradient `from-violet-600 via-indigo-600 to-blue-600`. Texto subtítulo com `Sparkles` lilás antes.
- **4 KPIs no topo do hero**:
  1. **Cenários ativos** (violeta) — só os com switch ligado
  2. **Execuções 30d** (emerald) — soma de `smartflowExecucoes` últimos 30 dias
  3. **Taxa de sucesso 30d** (amber) — `concluido / total %`
  4. **Tempo médio passo** (fuchsia) — média de `updatedAt - createdAt` dividido por `passoAtual`

- **Cards de cenário**: cópia do padrão `AgenteCard` —
  - `rounded-xl border border-l-4 bg-card p-4 hover:shadow-md hover:-translate-y-px`
  - **Cor da borda esquerda por categoria de gatilho**:
    - 🟦 Azul (`border-l-blue-500`) → mensagem (WhatsApp/Instagram/Facebook)
    - 🟩 Verde (`border-l-emerald-500`) → Asaas (recebido/vencido/próximo)
    - 🟧 Laranja (`border-l-orange-500`) → Cal.com (criado/cancelado/remarcado/lembrete)
    - 🟪 Violeta (`border-l-violet-500`) → CRM (novo lead)
    - ⚪ Cinza (`border-l-slate-500`) → manual
  - **Avatar gradient** com ícone do gatilho no canto sup. esquerdo (igual avatar do agente)
  - **Métricas inline**: nº de passos, nº de execuções 7d, status pill (Ativo/Inativo)
  - **Switch ativar/desativar** no canto sup. direito (idêntico ao agente)
  - Botões compactos: ✏️ editar, 🗑 excluir, ▶ executar (só se `gatilho === "manual"`)

- **Toolbar de filtros** acima da grid: campo de busca por nome + select de filtro por categoria de gatilho

- **Aba Execuções**: ganha mini-filtros (Status / Cenário / Janela) + um **mini-painel de timeline** no topo (gráfico de barras de execuções por dia, últimos 7 dias)

---

## TELA 2 — Editor de fluxo (`/smartflow/:id/editar`)

### Estado atual

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [← Voltar] | [Nome do cenário___]                       [💾 Salvar]      │  top bar
├──────────────────────────────────────────────────────────────────────────┤
│ [Descrição (opcional)_____________________________________]              │  descrição
├──────────┬──────────────────────────────────────────────┬────────────────┤
│ GATILHO  │                                              │ Painel direito │
│ □ Msg    │            ╔═══════╗                         │ (config do nó) │
│ □ Asaas  │            ║Gatilho║                         │                │
│ □ Cal    │            ╚═══╤═══╝                         │                │
│ □ CRM    │                ▼                             │                │
│ □ Fluxo  │            ╔═══════╗                         │                │
│          │            ║ Passo ║                         │                │
│ AÇÕES    │            ╚═══════╝                         │                │
│ □ IA     │                                              │                │
│ □ Cal    │           [Canvas ReactFlow]                 │                │
│ □ Kanban │                                              │                │
│ □ Asaas  │                                              │                │
│ □ Geral  │                                              │                │
│ □ Webhook│                                              │                │
│ 240 px   │                                              │     320 px     │
└──────────┴──────────────────────────────────────────────┴────────────────┘
```

**Problemas:**
1. **Top bar perdido** — sem ícone, sem cor, sem identidade do SmartFlow
2. **Sem indicador de "salvo"** — usuário não sabe se a última edição foi salva
3. **Sem switch Ativo no editor** — precisa voltar pra lista pra ativar/desativar
4. **Paleta confusa**: "GATILHO" e "AÇÕES" usam o mesmo estilo visual, parece que é só uma lista única
5. **Painel direito apertado (320px)** — quando você abre passos com várias condições ou template grande, fica espremido
6. **Canvas plano** — fundo branco, sem hierarquia, sem hint de "comece daqui"
7. **Sem botão de testar** — pra ver se o fluxo funciona, tem que sair e clicar em "Executar agora" na lista

### Proposta

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ┌──┐  Atendimento + Agendamento                          ┌───────────────┐  │ top bar
│ │⚡│  💬 Mensagem recebida · 5 passos · ⬤ Salvo há 2 min  │⬤ Ativo  💾 Salvar│  rica
│ └──┘                                            [▶ Testar][🗑]              │
├──────────────────────────────────────────────────────────────────────────────┤
│ [📝 Descrição: explica o que o cenário faz...]                              │
├────────────┬──────────────────────────────────────────────┬──────────────────┤
│            │ ┌──────────────────────────────────────────┐ │                  │
│  GATILHO   │ │              CANVAS (fundo sutil)        │ │ ⚙ Configuração   │
│ ╔════════╗ │ │                                          │ │ ────────────────  │
│ ║💬 MSG  ║ │ │            ╔═══════════════╗             │ │                  │
│ ║Recebida║ │ │            ║ 💬 Gatilho     ║             │ │ ┌─ Geral ──┐    │
│ ╚════════╝ │ │            ║   Mensagem     ║             │ │ │ Template  │    │
│ + categoria│ │            ║   recebida     ║             │ │ │ ┌──────┐ │    │
│            │ │            ╚════╤══════════╝              │ │ │ │ {{}} │ │    │
│ ─────────  │ │                 │                         │ │ │ └──────┘ │    │
│  AÇÕES     │ │            ╔═══▼═══════════╗             │ │ └──────────┘    │
│            │ │            ║ 🧠 Classificar ║             │ │                  │
│ ▸ IA       │ │            ║   intenção     ║             │ │ ┌─ Avançado ┐   │
│   2 passos │ │            ╚════╤══════════╝              │ │ │ Timeout...│   │
│ ▸ Kanban   │ │                 │                         │ │ └───────────┘   │
│   4 passos │ │            ╔═══▼═══════════╗             │ │                  │
│ ▸ Asaas    │ │            ║ 🤖 Responder   ║             │ │ ┌─ Saída ────┐  │
│   4 passos │ │            ║   com IA       ║             │ │ │ Variáveis  │  │
│ ▸ Cal.com  │ │            ╚════════════════╝             │ │ │ disponíveis│  │
│   5 passos │ │                                          │ │ └────────────┘   │
│ ▸ Geral    │ │  [➕ Adicionar passo]                    │ │                  │
│   3 passos │ │                                          │ │ [🗑 Remover]     │
│ ▸ Webhook  │ │            ┌──────────────────────┐      │ │                  │
│            │ │            │🔍 Zoom │🎯 Centrar │✓│      │ │                  │
│            │ │            │↻ Arranjar │ Validar │▼│      │ │                  │
│  280 px    │ │            └──────────────────────┘      │ │     360 px       │
│            │ └──────────────────────────────────────────┘ │                  │
└────────────┴──────────────────────────────────────────────┴──────────────────┘
```

**Detalhes visuais:**

#### 🔝 Top bar nova
- **Ícone gradient SmartFlow** (mesmo `Zap` violet→indigo→blue do hero da lista) — identidade
- **Nome do cenário** em destaque (`text-base font-semibold`), edição inline ao clicar
- **Linha de meta-info**: ícone do gatilho atual · nº de passos · ponto colorido + "Salvo há 2 min" / "Alterações não salvas" (vermelho)
- **Switch Ativo/Inativo** (igual ao da lista) — não precisa mais voltar pra ativar
- **Botão Salvar gradient** `from-violet-600 to-indigo-600` (consistência com app inteiro)
- **Botão "▶ Testar"** secundário — abre um modal com input de contexto JSON e mostra o resultado da execução em tempo real (mesma chamada `executarManual` que já existe no router)
- **Botão excluir** discreto no canto

#### 🎨 Paleta esquerda (280px, era 240)
- **Seção GATILHO**: card destaque (não lista de chips). Mostra o gatilho ATUAL como um card grande com ícone + nome + descrição curta. Botão "Trocar gatilho" abre popover com as categorias.
- **Separador** visual
- **Seção AÇÕES**: agrupada por categoria com **collapse/expand**. Cada categoria mostra contador de operações (`▸ Kanban (4)`). Ao expandir, lista os passos com ícone + label + hover info. Click adiciona ao canvas.
- **Search inline** no topo da seção AÇÕES: filtra os passos pelo nome ("digite 'whatsapp' pra achar rápido")

#### 🖼 Canvas (centro)
- **Background mais sutil** — gradient muito leve (`from-slate-50/40 via-white to-violet-50/20`) em vez de branco puro, ajuda a hierarquia visual
- **Hint de comece daqui** mais visível quando o cenário está vazio
- **Mini-toolbar flutuante no canto inferior**:
  - 🔍 Zoom in/out
  - 🎯 Centrar canvas
  - ↻ **Auto-arranjar** (botão NOVO — chama um algoritmo simples que distribui os nós verticalmente espaçados)
  - ✓ **Validar grafo** (botão NOVO — roda `validarGrafo` do shared e mostra erros num popover; já existe ao salvar, mas dá pra checar antes)

#### ⚙ Painel direito (360px, era 320)
- **Header com ícone do passo** + nome + status (igual hoje)
- **Abas internas** pra configs grandes:
  - **⚙ Configuração** — campos principais (template, agente IA, condições...)
  - **🔧 Avançado** — campos secundários (timeout, retry, fallback)
  - **📤 Saída** — variáveis que esse passo deixa no contexto (ajuda o usuário a entender o que pode usar no próximo passo)
- **Botão "Remover passo" rodapé** (igual hoje)

---

## O que NÃO muda (importante)

- **Schema do banco** (`smartflowCenarios`, `smartflowPassos`, `smartflowExecucoes`) — zero alteração
- **Motor de execução** (`engine.ts`) — zero alteração
- **Dispatcher** e **schedulers** — zero alteração
- **Endpoints tRPC** — não preciso adicionar nada (os dados de KPI já vêm dos endpoints existentes)
- **Cenários já criados** — continuam funcionando, só o visual da lista/editor muda

Ou seja: **risco baixo de regressão**. Os 157 testes que validei seguem verdes.

---

## Plano de execução (se aprovar)

Divido em 3 PRs pequenos pra você revisar por etapa, cada um isolado:

1. **PR-1 (Lista)** — `SmartFlow.tsx` repaginada + componente `SmartFlowHero` + componente `CenarioCard` (espelho do `AgenteCard`)
2. **PR-2 (Editor — top bar e paleta)** — Top bar nova, paleta reorganizada com collapse, switch Ativo, indicador de salvo
3. **PR-3 (Editor — canvas e painel)** — Mini-toolbar, abas no painel direito, botão Testar

Cada PR roda independente e o `pnpm check + test` precisa ficar verde antes de seguir.

---

## Pergunta antes de eu codar

1. Os 4 KPIs do hero estão bons? Quer trocar algum (ex: tirar "Tempo médio passo" e colocar "Cenários com erro 24h")?
2. Gosta da ideia de **borda colorida por categoria de gatilho** ou prefere todos os cards iguais (como hoje)?
3. O botão **"▶ Testar"** no editor é útil pra você? Hoje só dá pra testar saindo do editor e voltando.
4. Faz sentido as **3 abas** dentro do painel direito (Configuração / Avançado / Saída) ou prefere uma única coluna scrollável?
