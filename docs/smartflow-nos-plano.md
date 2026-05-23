# SmartFlow — Plano para nós universais e visual repaginado

**Objetivo:** transformar o SmartFlow de "passos rígidos com cara genérica" em **blocos universais que compõem infinitos cenários**, com visual claro e configuração que não exige adivinhação.

---

## TL;DR — o que muda

1. **6 nós novos** que destravam casos reais (consultar contato pelo telefone, listar ações do cliente, ler movimentações de processo, IA que extrai dados estruturados, esperar resposta do cliente no meio do fluxo, iterar sobre listas).
2. **Visual do nó repaginado**: header colorido por categoria + preview da configuração principal dentro do nó + chips das variáveis que ele publica.
3. **Configuração mais intuitiva**: tooltips ricos com exemplos, validação inline ("este nó precisa de `contatoId` no contexto"), wizard "primeiro fluxo" pra novos usuários.

**Tempo total estimado:** 3 fases pequenas (~1 dia cada se aprovado em sequência).

---

## Sobre o bug do campo personalizado

Investiguei o código (`server/smartflow/engine.ts:handleDefinirCampoPersonalizado` + `server/smartflow/executores.ts:definirCampoPersonalizadoCliente`). **O nó funciona** — três condições têm que bater:

| Condição | Hoje | Erro quando falha |
|---|---|---|
| Cenário tem `ctx.contatoId` | Vem de gatilhos com contato vinculado (mensagem recebida, pagamento, novo lead) | "Sem contatoId no contexto" — silencioso no log |
| Chave existe no catálogo | Definida em **Configurações → Campos personalizados de cliente** | `Campo personalizado "X" não existe no catálogo do escritório` |
| Valor preenchido | Texto literal ou interpolação `{{var}}` | Salva string vazia |

**Causa mais provável do que você viu:** você esperava que **a IA, ao receber "meu CPF é 123.456.789-00", entendesse e salvasse sozinha no campo `cpf`**. Hoje a IA gera texto bruto — pra salvar, é preciso um passo manual `definir_campo_personalizado` com chave fixa e valor extraído de uma variável.

A solução estrutural é o novo nó **`ia_extrair_campos`** (item 1 abaixo) — você diz "extrai CPF, RG, data de nascimento", a IA devolve um objeto e salva tudo de uma vez. Resolve o problema de fato.

Se o seu caso for outro (gatilho sem `contatoId`, ou você usou `definir_variavel` que só vive na execução), me diz qual cenário foi e eu confiro.

---

## Os 6 nós novos

### 1. 🧠 `ia_extrair_campos` — IA estruturada

**O que faz:** IA lê uma mensagem + uma lista de campos a extrair (com tipo) e devolve um **objeto JSON estruturado**. Salva direto no contexto e/ou nos campos personalizados.

**Por que existe:** hoje a IA só gera texto. Pra capturar "meu CPF é X, meu email é Y", você precisa de N passos. Este nó faz com 1 passo.

**Config:**
- **Quais campos extrair** (lista): nome, tipo (texto/email/cpf/data/numero/boolean/lista), obrigatório, descrição (ajuda pra IA)
- **Persistir como campo personalizado do cliente**: checkbox por campo. Se ✅ e `ctx.contatoId` existe, salva em `contatos.camposPersonalizados`.
- **Mensagem de origem**: por padrão `{{mensagem}}`, mas dá pra mudar (ex: `{{respostaUsuario}}` quando vem depois de "aguardar resposta")

**Publica no contexto:** `extracao.<chave>` pra cada campo extraído. Ex: `{{extracao.cpf}}`, `{{extracao.email}}`.

**Como funciona por baixo:** usa **tool calling** (Anthropic e OpenAI suportam) — montamos um JSON schema a partir da lista de campos e pedimos pra IA preencher. Se um campo opcional não tem na mensagem, IA omite. Sem alucinação de "preencheu CPF inventado".

**Exemplo de uso (cenário "captação de dados do cliente"):**
```
Cliente: "Sou João Silva, CPF 123.456.789-00, email joao@ex.com"
↓
ia_extrair_campos {
  nome: texto,
  cpf: cpf,
  email: email
}
↓
Contexto: {{extracao.nome}}="João Silva", {{extracao.cpf}}="123.456.789-00"
↓ (com "Persistir" marcado nos 3)
Salva em camposPersonalizados do contato
```

---

### 2. 🔍 `crm_buscar_contato` — Resolução por telefone/email/CPF

**O que faz:** Dado um telefone (ou email, ou CPF), busca em `contatos` do escritório e popula contexto com dados completos. Se não achar, marca `contatoEncontrado=false` pra próximo passo decidir.

**Por que existe:** seu exemplo: "cliente entra em contato, IA verifica se o número bate com cadastro". Hoje, no gatilho `mensagem_canal` o `contatoId` já vem populado se há vínculo — mas dá pra **buscar por outros campos** (cliente liga de outro número, mas informa CPF).

**Config:**
- **Buscar por:** `telefone` | `email` | `cpfCnpj` (radio)
- **Valor a buscar:** input livre, suporta `{{interpolação}}` (ex: `{{mensagem}}` ou `{{extracao.cpf}}`)

**Publica no contexto:**
- `contatoEncontrado` (booleano)
- `contatoId`, `nomeCliente`, `telefoneCliente`, `emailCliente`, `atendenteResponsavelId`
- `cliente.campos.*` (já populado pelo dispatcher, mas garante)

**Exemplo (telefone "novo" pede acesso):**
```
Cliente liga: "Sou cliente, CPF 123..."
↓
ia_extrair_campos → cpf
↓
crm_buscar_contato (por cpfCnpj, valor={{extracao.cpf}})
↓
condicional: contatoEncontrado == true ?
  └─ sim → continua
  └─ não → manda mensagem "não te achei aqui — vou chamar atendente" + transferir
```

---

### 3. 📋 `crm_listar_acoes_cliente` — Ações do cliente

**O que faz:** Dado `contatoId`, lista todos os `cliente_processos` do cliente. Retorna como array no contexto.

**Por que existe:** seu exemplo: "verifica se a ação que ele tá perguntando existe no cadastro dele". Hoje não tem como buscar dados de processos dentro do fluxo.

**Config:**
- **Filtrar por tipo:** todos / litigioso / extrajudicial
- **Filtrar por polo:** todos / ativo / passivo / interessado
- **Limite:** N primeiros (default 10)

**Publica no contexto:**
- `acoes` (lista): cada item com `{id, numeroCnj, apelido, classe, tipo, polo, valorCausa, dataReferenciaCadastro}`
- `acoesQuantidade` (número)

---

### 4. 📜 `processo_buscar_movimentacoes` — Histórico do processo

**O que faz:** Dado `processoId` (ou `numeroCnj`), busca em `eventos_processo` as últimas movimentações. Filtros por tipo e janela.

**Por que existe:** seu exemplo: "verifica movimentações e responde". Hoje impossível.

**Config:**
- **Processo a consultar:** `{{acaoId}}` (default) ou número fixo
- **Tipos a incluir:** multiselect (movimentacao, publicacao_dje, sentenca, audiencia, despacho...) — default tudo
- **Janela:** últimos N dias (default 30) ou últimas N movimentações (default 5)

**Publica no contexto:**
- `movimentacoes` (lista): cada item com `{tipo, dataEvento, conteudo, fonte}`
- `movimentacoesQuantidade`
- `movimentacaoMaisRecente` (objeto da primeira, ou null)

**Exemplo (cliente pergunta "houve novidade na minha ação?"):**
```
mensagem_canal
↓
ia_extrair_campos: identifica de qual ação ele fala (ou pergunta)
↓
crm_listar_acoes_cliente
↓
ia_responder: "Sobre qual ação? Você tem 3: ..."
   (espera escolha)
↓
processo_buscar_movimentacoes(processoId={{acaoEscolhida}})
↓
ia_responder: "Olha, a última novidade foi {{movimentacaoMaisRecente.dataEvento}}: ..."
```

---

### 5. ⏸️ `whatsapp_aguardar_resposta` — Conversa multi-turn

**O que faz:** Envia uma mensagem ao cliente e **pausa o fluxo** até ele responder (ou timeout). Quando ele responde, retoma do próximo passo com `ctx.respostaUsuario` populado.

**Por que existe:** hoje o fluxo é one-shot — IA responde, fim. Pra conversas que precisam de ida-e-volta ("qual horário você prefere?" → cliente: "amanhã às 14h" → "confirmado!"), não dá.

**Config:**
- **Mensagem a enviar:** template (igual `whatsapp_enviar`)
- **Timeout:** quanto tempo esperar antes de desistir (default 24h)
- **Se timeout:** ramo "expirou" no `proximoSe` ou parar fluxo

**Publica no contexto:**
- `respostaUsuario` (texto da próxima mensagem do cliente)

**Como funciona por baixo:** marca a execução como `rodando` + `retomarEm = null` (espera indefinida) + registra que esta execução está "aguardando mensagem do contato X na conversa Y". Quando próxima mensagem chegar do mesmo contato, o dispatcher `mensagem_canal` detecta e retoma a execução em vez de criar uma nova.

**Limitação:** só 1 execução por (cenário, contato) pode estar aguardando. Mensagem nova do mesmo cliente retoma; se quer começar fluxo novo, precisa expirar/cancelar o pendente.

---

### 6. 🔁 `para_cada_item` — Loop sobre lista

**O que faz:** Itera sobre uma lista do contexto (`{{acoes}}`, `{{movimentacoes}}`, etc.). Pra cada item, executa um subfluxo. Disponibiliza `{{item}}` e `{{indice}}` dentro do subfluxo.

**Por que existe:** pra coisas tipo "pra cada ação do cliente, manda um card no Kanban" ou "pra cada movimentação nova, manda um WhatsApp".

**Config:**
- **Lista a iterar:** caminho no contexto (ex: `acoes`, `movimentacoes`)
- **Limite máximo:** segurança (default 20)
- **Variável do item:** nome (default `item`, configurável pra fluxos aninhados)

**Visual no canvas:** o nó tem 2 handles de saída: "passo do loop" (que volta pro nó) e "depois do loop" (continuação).

---

## Refinamentos em nós existentes

| Nó | Refinamento |
|---|---|
| `definir_campo_personalizado` | Aviso visual se o gatilho selecionado não popula `contatoId` (vermelho com "este nó vai falhar — gatilho 'manual' não tem cliente vinculado"). |
| `whatsapp_enviar` | Botão "Adicionar opções" → vira menu numerado automaticamente (1, 2, 3...) e armazena mapping de número→valor pra próximo passo entender a escolha. |
| `ia_responder` | Suporte a `tools` (Fase 2 — depois de implementar tool calling). |
| `condicional` | Operador `na_lista` (verifica se valor está numa lista) — útil pra "cliente perguntou de uma ação que existe nas dele?". |

---

## Visual repaginado dos nós

Hoje o nó é um card chato com nome + ícone + 1 linha de resumo. Proposta:

```
┌──────────────────────────────────────┐
│ 💬 IA RESPONDER          [ ⚠ alerta ]│  ← header colorido por categoria
├──────────────────────────────────────┤
│  Agente: "Atendimento jurídico"      │  ← preview da config principal
│  Prompt: "Responda de forma..."      │
├──────────────────────────────────────┤
│  📤 publica: respostaIA              │  ← chips de variáveis publicadas
└──────────────────────────────────────┘
        │
        ▼ (linha mais grossa quando tem dados fluindo)
```

**Mudanças:**
- Header com **gradient da categoria** (azul=mensagem, verde=Asaas, laranja=Cal.com, violeta=IA, índigo=Kanban, âmbar=fluxo)
- Corpo mostra **preview da config** (template começa com..., condição é..., agente=X) — bate o olho e entende
- Rodapé com **chips das variáveis** que esse nó publica (clicar copia `{{var}}`)
- **Alertas no canto sup direito** — vermelho quando há problema de config (campo obrigatório vazio, dependência faltando)
- Largura do nó cresce um pouco (220→260px) pra acomodar preview

---

## Configuração mais intuitiva

1. **Tooltips ricos com exemplo** em cada campo. Hover no label "Chave" do `definir_campo_personalizado` mostra: "Nome do campo no cadastro do cliente. Exemplo: `cpf`, `data_aniversario`. Cadastre novos em Configurações."

2. **Validação inline** no painel direito:
   - Vermelho: erro que vai impedir execução ("Cenário 'mensagem' precisa de contatoId pra salvar campo personalizado — funcionará")
   - Âmbar: aviso ("Valor está vazio — o campo vai ficar em branco")
   - Verde: tudo OK

3. **Wizard "Primeiro fluxo"** quando o usuário cria cenário pela primeira vez:
   - Passo 1: Qual evento dispara? (gatilho)
   - Passo 2: O que quer fazer? (sugestões: responder mensagem / criar card / cobrar)
   - Passo 3: monta um fluxo template editável

4. **Botão "Sugerir próximo passo"** flutuante no canvas — IA olha o que você fez até agora e sugere o próximo nó típico (ex: depois de `ia_extrair_campos` sugere `definir_campo_personalizado` ou `crm_buscar_contato`).

---

## Plano de execução em 4 PRs

| PR | Escopo | Risco | Por que essa ordem |
|---|---|---|---|
| **PR-4 — Bug + fundação** | Implementar `ia_extrair_campos` (com tool calling Anthropic) · Avisos visuais quando contatoId faltar · Confirmar/corrigir bug do campo personalizado | Médio | Resolve o problema imediato. Tool calling vira fundação pros próximos. |
| **PR-5 — Consultas CRM** | `crm_buscar_contato`, `crm_listar_acoes_cliente`, `processo_buscar_movimentacoes` | Baixo | Endpoints isolados — não mexem em motor. |
| **PR-6 — Conversa multi-turn** | `whatsapp_aguardar_resposta`, `para_cada_item`, melhorias `whatsapp_enviar` (menu de opções) | Alto | Mexe no dispatcher pra retomar execução aguardando — testes pesados aqui. |
| **PR-7 — Visual + UX** | Nós novos com header colorido + preview + chips · Tooltips ricos · Validação inline · Wizard primeiro fluxo | Médio | Só client, mas tem muito polimento. |

---

## Pergunta antes de eu codar

1. **Concorda que o "bug" do campo personalizado é problema (3) — IA precisa extrair sozinha?** Se for outro caso, me descreve.
2. Os **6 nós novos** cobrem os fluxos que você imagina, ou tem caso que eu deixei de fora?
3. **Tool calling agora ou depois?** Posso entregar `ia_extrair_campos` **com** tool calling (mais robusto, IA não inventa) ou **sem** (usa JSON-mode tradicional, funciona mas é menos confiável). Recomendo COM, é só pouca coisa a mais.
4. Visual proposto (header colorido + preview + chips) — gostou ou prefere algo diferente?
5. **Wizard primeiro fluxo** — útil ou é overengineering?
