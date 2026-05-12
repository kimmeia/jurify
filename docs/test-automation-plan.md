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
│  Camada 3: Crawler determinístico (Playwright, sem LLM)      │
│  → 1×/dia em staging OU sob demanda                          │
│  → Reusa lib/playwright-helpers.ts do motor próprio          │
│  → Estratégias: Route Walker + Form Filler (fase 1)          │
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
| Crawler determinístico | 5xx, console errors, validação ausente, a11y, dead links | Zero recorrente | Alto |

**Decisão**: a versão anterior do plano propunha um explorador agêntico (Claude API dirigindo Playwright). Foi rejeitada em favor do **crawler determinístico no estilo motor próprio** (`scripts/spike-motor-proprio/`). Trade-off aceito: perdemos detecção subjetiva de UX confusa (que seria melhor capturada em revisão humana ou usability test), mas ganhamos custo zero, 100% reproducibilidade, CI sem chave de API, e mesma filosofia que o time já domina.

## 3. Fase 1 — Fundação (Semana 1)

Tudo que segue depende disso. Sem fundação, golden paths viram flaky e crawler trava em "como faço login?".

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

## 6. Fase 4 — Crawler determinístico (Semanas 4-5)

Playwright puro no estilo `scripts/spike-motor-proprio/`. Sem LLM no loop. Mesma filosofia já provada nos scrapers de tribunais: retry com backoff, screenshot em erro, Sentry com tags estruturadas, output JSON + stats.

### 6.1 Filosofia (replicada do motor próprio)

| Padrão do motor próprio | Onde aplicar no crawler |
|---|---|
| `getBrowser()` singleton + `novoContext()` por sessão | Cada estratégia roda em context novo, browser compartilhado |
| `comRetry(fn, { tentativas, baseMs })` | Toda ação flaky-prone (click, fill, navigate) |
| `capturarScreenshot(page, prefixo)` em erro | `scripts/test-crawler/samples/screenshots/` com naming ISO |
| Categorias de erro tipadas (`CategoriaErro`) | Adicionar: `console_error`, `network_5xx`, `dead_link`, `validation_missing`, `accessibility_violation` |
| Sentry tags `spike: "motor-proprio"` | Trocar pra `crawler: "qa-explorer"` + tag de estratégia |
| `withSpan("trt2.consultar_cnj")` | `withSpan("crawler.route_walk")`, etc. |
| Output `samples/poc-N-{ts}.json` + stats | Output `samples/run-{ts}.json` + `run-{ts}-stats.json` |
| Delays educados (`waitForTimeout(800)`) | Manter — evita race condition em React/Wouter |

### 6.2 Escopo inicial — 2 estratégias

**Decisão**: começamos com A+B. Estratégias C (Action Chains) e D (Visual Regression) ficam pra Fase 2, revisitada após Semana 8 baseado em ROI.

#### Estratégia A — Route Walker (descoberta de superfície)

Objetivo: visitar todas as rotas do client, validar que carregam sem erro.

- **Input**: lista de rotas extraída de `client/src/pages/` (hardcoded inicialmente, AST scan depois)
- **Pra cada rota**:
  - Loga como dono do escritório de teste (helper de Camada 1)
  - Navega
  - Anexa listeners: `page.on('console')`, `'pageerror'`, `'requestfailed'`, `'response')` — coletam erros JS, 5xx, network failures
  - Espera `networkidle` com timeout 15s
  - Captura screenshot baseline
  - Roda `@axe-core/playwright` → coleta violations WCAG
  - Reporta findings
- **Acha**: páginas que crashan no load, 5xx em endpoints chamados no mount, console errors, regressão de acessibilidade
- **Custo de execução**: ~30 rotas × 3s = 90s

#### Estratégia B — Form Filler (validação de inputs)

Objetivo: pra cada formulário do app, preencher com dados plausíveis e adversariais, validar comportamento.

- **Detecção**: `page.locator('form')` → enumera inputs (name, type, placeholder, aria-label, required)
- **Gerador de dados** em `crawler/lib/data-generators.ts`:
  - `name=cpf` → CPF válido + 5 CPFs inválidos
  - `name=email` → email plausível + emails inválidos (sem @, com unicode, > 320 chars)
  - `type=date` → datas válidas + 9999-12-31, 1900-01-01, ano negativo
  - `type=number` → valores em escala + -1, 0, MAX_SAFE_INTEGER, NaN
  - `name=*nome*` → nomes Faker-style + emoji + zalgo + 10k chars
  - `name=*senha*` → senha forte + senhas fracas + caracteres especiais
- **Por form**:
  - Tenta caminho feliz: preenche válido, submete, espera toast/redirect
  - Testa cada campo isoladamente com dado adversarial, valida erro inline (não 5xx)
- **Acha**: validação ausente, 500 em submit, mensagem genérica "Erro" sem campo, máscara que aceita unicode

### 6.3 Saída estruturada

Cada execução produz (espelhando o que motor próprio já gera):

```
scripts/test-crawler/samples/
├── run-{ts}.json              # Findings detalhados
├── run-{ts}-stats.json        # Agregado por estratégia + categoria
├── run-{ts}-summary.md        # Markdown legível pra revisão humana
└── screenshots/
    ├── route-walk-{rota}-{ts}.png
    └── form-{form-id}-{ts}.png
```

Estrutura JSON:

```jsonc
{
  "runId": "20260512-...",
  "estrategia": "route_walker" | "form_filler",
  "ok": false,
  "findings": [
    {
      "severidade": "high",
      "categoria": "network_5xx",
      "rota": "/clientes/123",
      "screenshotPath": "samples/screenshots/route-walk-...",
      "detalhes": "GET /api/trpc/clientes.buscar respondeu 500"
    }
  ],
  "latenciaMs": 87340,
  "finalizadoEm": "2026-05-12T..."
}
```

### 6.4 Integração com Sentry

Mesma filosofia do `lib/sentry-spike.ts`:

```ts
initSpikeSentry({ pocId: "crawler", workerName: "qa-crawler" });
// Tags: crawler: "qa-explorer", crawler_estrategia: "form_filler", crawler_run: "{ts}"
```

Cada finding `severity >= high` vai como `captureSpikeError` com extras (rota, screenshot, categoria).

### 6.5 Triagem

- Findings `critical|high` → criar issue automática no GitHub via `mcp__github__issue_write` com screenshot anexado
- `med|low` → board manual (revisão semanal)
- Falsos positivos → adicionar pattern ao código do crawler (ex: "rota /relatorios pode demorar > 5s, não conta como bug")

### 6.6 Fase 2 (pós-validação)

Se A+B mostrarem ROI bom (achar ≥ 3 bugs reais em 30 dias), implementar:

- **Estratégia C — Action Chains**: sequências declarativas de ações com invariants entre telas (cadastrar cliente → criar cobrança → conferir DRE soma)
- **Estratégia D — Visual Regression + Perf**: screenshot diff por rota, baseline em `main`, alarme em degradação P95 > 30%

Detalhes ficam congelados nesta seção até reavaliação após Semana 8.

## 7. Integração CI

```
.github/workflows/test-automation.yml
├── on: pull_request
│   ├── pnpm check (já existe)
│   ├── pnpm test (vitest unitário, já existe)
│   ├── pnpm test:e2e:golden (NOVO - golden paths Playwright)
│   └── pnpm test:fuzz (NOVO - fast-check tRPC)
│
└── on: schedule (1×/dia, 03:00 UTC) + on: workflow_dispatch
    └── pnpm test:crawler (NOVO - crawler determinístico em staging)
        └── findings ≥ high viram GitHub issues automáticas
```

Sem chave de API: roda no CI padrão sem secret adicional. Disparo manual via `workflow_dispatch` quando quiser rodar sob demanda.

## 8. Métricas de sucesso (90 dias)

- Camada 1+2: > 20 fluxos cobertos, < 1% flake, < 10 min de suíte.
- Camada 3 (Fuzz): 0 IDOR não detectado em audit independente, fast-check acha pelo menos 5 bugs reais.
- Camada 4 (Crawler): cada run reporta < 5 findings novos após estabilização (curva decrescente é sinal de saúde do app). Acha bug intencional injetado em < 2 min.
- Bugs achados → corrigidos → regressão adicionada à Camada 2.

## 9. Riscos & mitigações

| Risco | Mitigação |
|---|---|
| Testes flaky degradam confiança | Quarentena imediata + investigar root cause, nunca `it.skip` "temporário" |
| Staging não isola → testes poluem dados reais | Camada 1.1 obrigatória antes de qualquer outra coisa |
| Crawler reporta ruído (rota intencionalmente lenta, validação opcional) | Patterns de exceção codados explicitamente; revisão semanal das categorias mais frequentes |
| Vazamento de senhas/tokens em logs/screenshots | Sanitização obrigatória no `expectNoConsoleErrors`, screenshots borram inputs `type=password` e regex CPF/CNPJ/email |
| Crawler quebra com mudança de UI (selector mudou) | Reusa `comRetry` do motor próprio (3 tentativas, backoff); failures viram findings categoria `selector_obsoleto` pra atualização explícita |

## 10. Cronograma

| Semana | Entrega | Critério de aceite |
|---|---|---|
| 1 | Fundação (DB isolation + seed + helpers) | `seedAndLogin('dono')` funciona em CI |
| 2 | Golden paths P0 (testes 1-10) | Roda no CI verde, < 10 min |
| 3 | Golden paths P1 + fuzz tRPC | Cobertura de 20 procedures críticas |
| 4 | Crawler Estratégia A (Route Walker) | Roda 1× em staging, gera report JSON, Sentry recebe tags |
| 5 | Crawler Estratégia B (Form Filler) | Detecta 1 bug intencional injetado (validação ausente) |
| 6 | CI scheduled + GitHub issues automáticas | Issues criadas via `mcp__github__issue_write` pra findings ≥ high |

## 11. Decisões pendentes (preciso de input)

| # | Decisão | Recomendação |
|---|---|---|
| 1 | Isolamento DB | Escritório-por-run (não invasivo, cascade delete) |
| 2 | Ambiente do crawler | `RAILWAY_ENVIRONMENT=qa` dedicado (evita poluir staging) |
| 3 | ~~Modelo LLM~~ | **Sem objeto — crawler é determinístico** |
| 4 | Onde reportar bugs | GitHub issues via `mcp__github__issue_write` (severidade ≥ high) |
| 5 | CI obrigatório/opt-in | Camadas 1, 2 e Fuzz: obrigatório em todo PR. Crawler: scheduled (diário) + sob demanda via `workflow_dispatch` |
| 6 | Sanitização PII | Sim — borrar valores de inputs `type=password` + campos com regex CPF/CNPJ/email antes de salvar screenshot |
| 7 | Profundidade do crawler | **Confirmado**: começar com A+B. Estratégias C+D ficam pra Fase 2 (revisitar após Semana 8) |
