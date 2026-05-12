# Plano — Robô de Testes Automatizado End-to-End

> Objetivo: construir uma suíte que simule uso humano do Jurify pra **descobrir bugs que ninguém testou ainda**, validar UX, e mapear comportamento real do sistema. Não substitui CI atual (910+ vitest verdes), complementa.

## 1. O que queremos achar

Bugs que escapam de testes de unidade/integração porque exigem:

- **Composição de telas**: criar cliente → cadastrar processo pra ele → gerar cobrança → enviar → marcar pago. Cada step funciona, o fluxo inteiro quebra.
- **Estado entre reloads**: aba aberta, dado mudou no DB, UI mostra stale.
- **Permissões reais**: colaborador X loga, vê dado de Y (cross-tenant leak). `checkPermission` tem regra certa, mas procedure esqueceu de chamar.
- **Inputs adversariais**: nome com emoji, CPF com 999 chars, data 9999-12-31, upload de PDF de 50MB.
- **Concorrência leve**: dois usuários do mesmo escritório editando mesma cobrança.
- **UX confusa**: validação só aparece depois de submit, botão habilitado em estado inválido, loading infinito, toast sumiu rápido demais.

**Não é objetivo**: substituir testes manuais de regressão visual, testar performance de carga, validar legalidade de cálculos jurídicos (isso é vitest unitário).

## 2. Arquitetura — três camadas complementares

```
┌──────────────────────────────────────────────────────────────┐
│  Camada 3: Explorador agêntico (Claude API + Playwright)     │
│  → 1×/dia em staging, modo descoberta                        │
│  → "Loga como dono, navega 30 min, reporta tudo estranho"    │
└──────────────────────────────────────────────────────────────┘
                            ▲ reusa
┌──────────────────────────────────────────────────────────────┐
│  Camada 2: Golden paths Playwright (roteirizado)             │
│  → A cada PR no CI                                            │
│  → 20-30 fluxos críticos determinísticos                     │
└──────────────────────────────────────────────────────────────┘
                            ▲ reusa
┌──────────────────────────────────────────────────────────────┐
│  Camada 1: Fundação — seed, helpers, DB reset, fixtures      │
│  → Habilita todas as outras                                  │
└──────────────────────────────────────────────────────────────┘

         ┌───────────────────────────────────────────┐
         │  Camada paralela: Fuzz tRPC (fast-check)  │
         │  → Vitest, sem browser, foco autorização  │
         └───────────────────────────────────────────┘
```

Por que três e não uma? Cada uma acha tipo diferente de bug:

| Camada | Acha o quê | Custo | Determinismo |
|---|---|---|---|
| Golden paths | Regressão em fluxos conhecidos | Baixo (1-2 min/run) | Alto |
| Fuzz tRPC | IDOR, cross-tenant, data integrity | Médio (5-10 min/run) | Alto (com seed) |
| Explorador agêntico | Bugs nunca pensados, UX ruim, dead-ends | Alto ($1-2/sessão) | Baixo |

## 3. Fase 1 — Fundação (Semana 1)

Tudo que segue depende disso. Sem fundação, golden paths viram flaky e explorador trava em "como faço login?".

### 3.1 Banco de testes isolado

- **Staging atual**: `develop` branch → Railway. DB compartilhado.
- **Risco**: testes rodando em paralelo corrompem dados entre si.
- **Proposta**: criar `RAILWAY_ENVIRONMENT=test` separado, ou usar schema isolado (`test_<runId>`) e dropar no fim.
  - Alternativa mais leve: cada test suite usa um `escritorio` próprio gerado com sufixo do `runId`, e teardown deleta tudo daquele `escritorioId` no fim.
- **Decisão pendente**: schema-por-run (mais limpo, exige mudança em Drizzle) vs escritório-por-run (mais simples, exige cascade delete completo). Recomendo escritório-por-run pra começar.

### 3.2 Seed determinístico

Já existe `scripts/seed-staging.ts` com `SEED_PASSWORD="Smoke123!"`. Estender pra:

- 1 escritório "test-runner-<runId>" com:
  - 1 dono, 1 gestor, 1 atendente, 1 estagiário, 1 sdr (cada cargo legado)
  - 1 cargo personalizado com permissões customizadas
  - 5 clientes (PF/PJ mistos)
  - 10 processos (TJCE/PJe/TRT2 distribuídos)
  - 3 categorias de cobrança + 5 cobranças em estados diferentes (pendente/paga/vencida)
  - 2 credenciais no cofre (válidas + inválidas)
  - 1 quadro Kanban com 4 colunas, 8 cards
  - 2 agendamentos futuros

Helper `seedTestEscritorio(runId): Promise<{ escritorioId, users: { dono, gestor, ... } }>`.

### 3.3 Helpers Playwright reutilizáveis

Inspirados em `scripts/spike-motor-proprio/lib/playwright-helpers.ts` (já temos esse padrão):

- `loginAs(page, user)`: navega `/auth`, preenche, espera redirect, valida cookie de sessão.
- `expectNoConsoleErrors(page)`: anexa listener, falha teste se aparece erro JS no console.
- `expectNoNetwork5xx(page)`: anexa listener, falha se qualquer request retorna 5xx.
- `expectNoOrphanLoading(page, timeout)`: falha se spinner sobrevive timeout.
- `screenshotOnFail` (já tem em motor próprio): reusar.
- `waitForToast(page, text?)`: helper pra esperar shadcn-ui toast.
- `seedAndLogin(role)`: combinação `seedTestEscritorio` + `loginAs`, atômico.

**Localização proposta**: `tests/e2e/lib/` (separado dos fixtures atuais em `tests/e2e/fixtures/`).

### 3.4 Convenções

- Cada teste cria seu próprio escritório (não compartilha estado). Trade-off: mais lento, mas zero flake.
- Suffix `runId = process.env.GITHUB_RUN_ID ?? Date.now()` pra evitar colisão.
- Teardown global remove escritórios criados há > 24h (cleanup de zumbis de runs interrompidos).

## 4. Fase 2 — Golden paths Playwright (Semana 2)

20-30 testes cobrindo o caminho feliz + 2-3 caminhos infelizes de cada módulo crítico. Roda no CI a cada PR.

### 4.1 Fluxos a cobrir (priorizados)

**Críticos (P0 — bloqueia release se quebrar)**:

1. Signup → escolher plano → criar escritório → onboarding completo
2. Login email/senha + 2FA (se ativo)
3. Login Google (mock do idToken)
4. Convidar colaborador → email recebido → aceitar convite → primeiro login
5. Criar cliente PF (CPF) → editar → adicionar anotação → upload arquivo → excluir
6. Criar cliente PJ (CNPJ) → mesma jornada
7. Cadastrar processo via CNJ → consulta → criar monitoramento → aguardar nova ação → ver no painel
8. Cofre: cadastrar credencial OAB → validar → usar em consulta processo → remover
9. Financeiro: criar categoria → criar cobrança → marcar paga → ver DRE → exportar CSV
10. Permissões: estagiário tenta editar processo de outro colaborador → bloqueado

**Importantes (P1 — bug aceitável até próximo sprint)**:

11. Kanban: criar quadro → adicionar card → arrastar entre colunas → arquivar
12. Agenda: criar agendamento → editar → confirmar arquivo anexado
13. SmartFlow: criar automação → trigger → ver execução
14. Modelos contrato: criar modelo → preencher variáveis → gerar PDF
15. Assinaturas: criar doc → enviar pra assinatura → assinar
16. Relatórios: gerar relatório de produtividade → exportar PDF
17. Cálculos trabalhista: simular → exportar PDF → conferir totais
18. Admin: ver lista de issues Sentry → marcar resolvido
19. Configurações: editar dados escritório → mudar logo → adicionar campo customizado cliente
20. Logout → confirmar que cookie sumiu → tentar acessar `/processos` → redireciona pra `/auth`

**Cross-cutting (P0)**:

21. Cada role (dono, gestor, atendente, estagiário, sdr) loga → screenshot do menu → comparar com matriz esperada. Se gestor vê "Admin" no menu, é bug.
22. Após sair de aba 30min → voltar → sessão ainda válida (ou expirou de forma graciosa).
23. Resize pra mobile (375px) em cada página → conferir overflow/scroll horizontal.

### 4.2 Caminhos infelizes obrigatórios

Pra cada P0, adicionar 1-2 testes negativos:

- Cliente: CPF inválido (deve mostrar erro inline, não submit)
- Processo: CNJ malformado (mesma coisa)
- Convite: email já cadastrado em outro escritório (mensagem clara)
- Cobrança: valor negativo (rejeitado)
- Cofre: credencial errada (validação falha, mas não trava UI)

### 4.3 Métricas a coletar

- Tempo total da suíte (meta: < 10 min no CI)
- Flaky rate (meta: < 1%)
- Cobertura de páginas (% de rotas em `client/src/pages` tocadas em algum teste)

## 5. Fase 3 — Fuzz tRPC com `fast-check` (Semana 3)

Vitest puro, sem browser. Roda no CI. Foco em **autorização** e **data integrity**.

### 5.1 Propriedades a testar

**Cross-tenant (IDOR)** — pra cada procedure que recebe ID de recurso:
```
∀ usuárioA do escritórioA, ∀ recursoB do escritórioB:
  procedure(input com recursoB.id) deve retornar UNAUTHORIZED, nunca dados
```
Procedures alvo (lista do mapeamento):
- `clientes.atualizar`, `clientes.excluir`, `clientes.listarArquivos`
- `processos.buscarProcessoCompleto`
- `cofre.removerMinha`, `cofre.validarMinha`
- `financeiro.atribuirCobrancasEmMassa`, `financeiro.salvarRegraComissao`
- `permissoes.removerColaborador`, `permissoes.alterarCargo`

**Permissões** — pra cada combinação `(cargo, modulo, ação)`:
```
∀ usuário com cargo C:
  se PERMISSOES_LEGADO[C][modulo][ação] === false:
    procedure correspondente deve retornar FORBIDDEN
```

**Data integrity** — fast-check arbitraries:
- Strings: vazias, unicode (𓀀, emoji, RTL árabe, zalgo), 10k chars, SQL injection clássico, XSS clássico
- Números: -1, 0, MAX_SAFE_INTEGER, NaN, Infinity, 0.1+0.2
- Datas: 1900-01-01, 9999-12-31, ano negativo, formato inválido
- UUIDs/IDs: malformados, de outro escritório, deletado, soft-deleted

Procedures alvo:
- `clientes.criar` (nome, documento, email)
- `processos.consultarCNJ` (numero processo)
- `financeiro.criarCategoriaCobranca` (valor, dias)
- `cofre.cadastrarMinha` (username, password — sem leak de pwd em logs!)

**Privilege escalation** — `permissoes.alterarCargo`:
- Atendente tenta promover a si mesmo a dono → bloqueado
- Gestor tenta criar cargo personalizado com permissão "admin global" → bloqueado

### 5.2 Setup

- Novo arquivo `server/_core/fuzz-helpers.ts` com arbitraries customizados (CPF, CNPJ, CNJ, valor monetário em centavos).
- Configuração `vitest.fuzz.config.ts` com `testTimeout: 60_000` (fuzz é mais lento).
- Pasta `tests/fuzz/` com 1 arquivo por router crítico.
- Reprodutibilidade: `fast-check` salva seed quando falha → testes regridem com seed exato.

### 5.3 Métricas

- # de shrinks até input mínimo que reproduz bug
- Procedures sem cobertura fuzz (gap analysis)

## 6. Fase 4 — Explorador agêntico (Semanas 4-5)

Aqui mora a magia: um agente Claude dirige Playwright "no escuro", explora o app como um humano novo, reporta tudo que estranha.

### 6.1 Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│ Loop principal (TypeScript, roda em staging)            │
│                                                         │
│   while (orçamento_não_esgotou):                        │
│     state   = capturar(page)  ← screenshot + DOM + URL  │
│     prompt  = montar_contexto(state, histórico)         │
│     ação    = claude.messages.create(prompt)            │
│                → "click selector X" | "fill Y com Z"    │
│                | "voltar" | "reportar bug: ..."         │
│     executar(page, ação)                                │
│     se ação == REPORT: salvar e continuar               │
└─────────────────────────────────────────────────────────┘
```

### 6.2 Prompt do agente (esqueleto)

```
Você é um QA testando o Jurify (SaaS jurídico). Você está logado como
{cargo} no escritório de teste. Seu objetivo: explorar todas as
funcionalidades, executar fluxos reais (cadastrar cliente, criar
processo, gerar cobrança...) e REPORTAR qualquer coisa que pareça bug
ou UX confusa.

Tela atual: {url}
DOM simplificado: {dom_summarized}
Screenshot: {image}
Histórico (últimas 10 ações): {history}

Critérios de "bug ou UX ruim":
- Erro 500 / network error
- Erro JS no console
- Loading que não termina em 5s
- Validação confusa (mensagem genérica, sem indicar campo)
- Botão habilitado em estado inválido
- Dado errado na tela (ex: "R$ NaN", data "Invalid Date")
- Página em branco
- Texto truncado, overflow, layout quebrado

Decida UMA ação:
1. CLICK <selector>
2. FILL <selector> <valor>
3. NAVIGATE <path>
4. WAIT <ms>
5. REPORT <severidade: low|med|high|critical> <descrição>
6. STOP <razão>
```

### 6.3 Estratégias de exploração

3 modos rodando em paralelo (cada um em escritório próprio):

- **Modo "primeiro dia"**: agente loga como dono recém-criado, simula onboarding completo, anota tudo que parece confuso.
- **Modo "rotina"**: agente loga como atendente, simula um dia de trabalho — chega cliente, cadastra, faz cobrança, responde mensagem.
- **Modo "destrutivo"**: agente tenta explicitamente quebrar coisas — input bizarro, navegação rápida, F5 no meio de submit, voltar/avançar do browser.

### 6.4 Custo estimado

Por sessão (~30 min de exploração, ~80 ações):

| Item | Volume | Custo |
|---|---|---|
| Input (screenshot + DOM + history) | ~5k tokens × 80 | ~400k tokens |
| Output (decisão de ação) | ~300 tokens × 80 | ~24k tokens |
| **Modelo: Sonnet 4.6** ($3 in / $15 out) | | **~$1.50 / sessão** |
| **Com prompt caching** (system prompt + matriz) | | **~$0.80 / sessão** |
| 10 sessões/dia × 30 dias | | **~$240/mês** |

Pra Opus 4.7 ($15/$75): ~$8/sessão → $2400/mês — desnecessário pra QA, Sonnet basta.

**Caching obrigatório**: system prompt + descrição da matriz de permissões + glossário de UI são fixos → cache hit em 90% das chamadas.

### 6.5 Saídas

Cada sessão produz:

- `reports/<runId>/findings.json`: lista de REPORTs com severidade, screenshot, URL, DOM snapshot, ação que disparou.
- `reports/<runId>/trace.html`: Playwright trace viewer (já é nativo).
- `reports/<runId>/summary.md`: agente escreve resumo no fim ("explorei X, achei Y bugs, observei Z").

### 6.6 Triagem

- Bugs `critical|high` → criar issue automática no GitHub via `mcp__github__issue_write`.
- `med|low` → ficam em board manual (planilha ou Linear).
- Falsos positivos → adicionar pattern ao prompt do agente como "isso não é bug".

## 7. Integração CI

```
.github/workflows/test-automation.yml
├── on: pull_request
│   ├── pnpm check (já existe)
│   ├── pnpm test (vitest unitário, já existe)
│   ├── pnpm test:e2e:golden (NOVO - golden paths Playwright)
│   └── pnpm test:fuzz (NOVO - fast-check tRPC)
│
└── on: schedule (1×/dia, 03:00 UTC)
    └── pnpm test:explore (NOVO - explorador agêntico em staging)
        └── posta resumo em #qa-automation no Slack
```

## 8. Métricas de sucesso (90 dias)

- Camada 1+2: > 20 fluxos cobertos, < 1% flake, < 10 min de suíte.
- Camada 3: 0 IDOR não detectado em audit independente, fuzz acha pelo menos 5 bugs reais.
- Camada 4: explorador acha em média 2-3 bugs novos por semana nos primeiros 30 dias (curva decrescente é sinal de saúde).
- Bugs achados → corrigidos → regressão adicionada à camada 1.

## 9. Riscos & mitigações

| Risco | Mitigação |
|---|---|
| Testes flaky degradam confiança | Quarentena imediata + investigar root cause, nunca `it.skip` "temporário" |
| Custo do explorador escalar fora de controle | Hard budget cap por dia ($10), kill switch em env var, alarme Sentry se passar |
| Staging não isola → testes poluem dados reais | Camada 1.1 obrigatória antes de qualquer outra coisa |
| Explorador acha "bug" que é feature → ruído | Loop de feedback: humano marca como falso positivo, agente aprende via examples no prompt |
| Vazamento de senhas/tokens em logs/screenshots | Sanitização obrigatória no `expectNoConsoleErrors`, screenshots censuram inputs `type=password` |

## 10. Cronograma

| Semana | Entrega | Critério de aceite |
|---|---|---|
| 1 | Fundação (DB isolation + seed + helpers) | `seedAndLogin('dono')` funciona em CI |
| 2 | Golden paths P0 (testes 1-10) | Roda no CI verde, < 10 min |
| 3 | Golden paths P1 + fuzz tRPC | Cobertura de 20 procedures críticas |
| 4 | Explorador v1 (modo "primeiro dia") | 1 sessão completa, achados reais |
| 5 | Explorador v2 (modo "rotina" + "destrutivo") | 3 modos em paralelo, custo < $10/dia |
| 6 | Triagem + CI scheduled + dashboard | Issues automáticas no GitHub, dashboard com trend |

## 11. Decisões pendentes (preciso de input)

1. **Banco de teste**: schema-por-run ou escritório-por-run? (Recomendo escritório-por-run pra começar — menos invasivo.)
2. **Ambiente do explorador**: staging atual ou criar `RAILWAY_ENVIRONMENT=qa` dedicado? (Recomendo dedicado pra não contaminar staging com dados loucos.)
3. **Modelo do explorador**: Sonnet 4.6 ($240/mês) ou começar com Haiku 4.5 ($30/mês) e subir se quality ruim? (Recomendo Sonnet — Haiku tende a perder contexto em ações complexas.)
4. **Onde reportar bugs**: GitHub issues, Linear, ou planilha? (Recomendo GitHub issues — já temos `mcp__github__issue_write`, dá pra automatizar.)
5. **Quem é o "owner" da suíte**: cada PR roda golden+fuzz obrigatoriamente, ou opt-in via label? (Recomendo obrigatório — vira regressão de verdade.)
6. **Sanitização de PII em screenshots**: borrar CPF/CNPJ/email no screenshot antes de salvar? (Recomendo sim — screenshots vão pro CI artifact storage.)
