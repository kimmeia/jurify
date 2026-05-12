# Módulo Processos — Mapa exaustivo

Documento produzido após investigação de um falso-positivo no sistema de monitoramento de processos. Mapeia camadas de servidor, scraper e UI; lista riscos de falso-positivo priorizados; e indica gaps de teste.

Tudo está citado por `arquivo:linha` direto da árvore atual do repo.

---

## 1. Visão geral

```
                ┌─────────────────────────────────────────────────────────┐
                │  USUÁRIO (Processos.tsx)                                │
                │  • Aba "Consultar" → consulta pontual com débito        │
                │  • Aba "Monitorar" → cria/lista monitoramentos de CNJ   │
                │  • Aba "Novas ações" → monitoramento por CPF/CNPJ       │
                │  • Aba "Cofre" → credenciais TJCE/PDPJ                  │
                └────────────┬────────────────────────────────────────────┘
                             │ tRPC
                             ▼
                ┌─────────────────────────────────────────────────────────┐
                │  ROUTER tRPC                                            │
                │  server/routers/processos.ts          (1.206 linhas)    │
                │  server/escritorio/router-cliente-processos.ts (376 l.) │
                │  server/processos/router-notificacoes.ts (270 linhas)   │
                └────────────┬────────────────────────────────────────────┘
                             │
              ┌──────────────┼─────────────────────────────────┐
              ▼              ▼                                 ▼
     ┌─────────────┐  ┌──────────────────┐         ┌───────────────────────┐
     │  CRÉDITOS   │  │  MOTOR PRÓPRIO   │         │  CRON DE              │
     │  (escritori │  │  runner (async)  │         │  MONITORAMENTO        │
     │  o_creditos)│  │  cache in-memory │         │  setInterval(60min)   │
     └─────────────┘  └────────┬─────────┘         └───────────┬───────────┘
                               │                               │
                               ▼                               ▼
                     ┌───────────────────────────────────────────────────┐
                     │  ADAPTER PJe-TJCE (Playwright headless)           │
                     │  scripts/spike-motor-proprio/poc-2-esaj-login/    │
                     │     adapters/pje-tjce.ts                          │
                     │  → Keycloak SSO + TOTP, navega listView.seam,     │
                     │    extrai capa + movs ou CNJs por CPF             │
                     └────────────┬──────────────────────────────────────┘
                                  │
                                  ▼
                     ┌───────────────────────────────────────────────────┐
                     │  PERSISTÊNCIA                                     │
                     │  • motor_monitoramentos (estado + hashUltimasMovs)│
                     │  • eventos_processo (hashDedup UNIQUE)            │
                     │  • notificacoes (sem UNIQUE)                      │
                     └────────────┬──────────────────────────────────────┘
                                  │
                                  ▼
                     ┌───────────────────────────────────────────────────┐
                     │  PUSH                                             │
                     │  emitirNotificacao(userId, ...)                   │
                     │  server/_core/sse-notifications.ts                │
                     │  → Sino de notificações + badge "Novas ações"     │
                     └───────────────────────────────────────────────────┘
```

**Importante:** O SmartFlow **não escuta** nenhum evento do módulo de processos (`shared/smartflow-types.ts:10-21` não declara gatilho `movimentacao_processo`/`nova_acao`; o `dispatcher.ts` não tem `dispararMovimentacao*`). Toda notificação de movimentação nasce direto do cron, sem passar pelo motor de automações.

---

## 2. Inventário de arquivos

### Server
| Caminho | Linhas | Função |
|---|---:|---|
| `server/routers/processos.ts` | 1.206 | Router tRPC principal (consulta, monitoramento, créditos, novas ações) |
| `server/escritorio/router-cliente-processos.ts` | 376 | Vínculo de processo ↔ contato/cliente |
| `server/processos/router-notificacoes.ts` | 270 | Listagem/marcação do sino |
| `server/processos/cron-monitoramento.ts` | 679 | Cron polling de movimentações e novas ações |
| `server/processos/motor-proprio-runner.ts` | 306 | Executa consulta assíncrona, cache in-memory |
| `server/processos/tribunal-providers.ts` | 277 | Metadados de tribunais (não usado pelo cron real) |
| `server/processos/cnj-parser.ts` | 180 | Parsing CNJ → tribunal/UF/motor próprio |
| `server/processos/credit-calc.ts` | 187 | Cálculo de custo (código legado Judit) |
| `server/processos/adapters/pje-tjce.ts` | ~80 | Wrapper fino sobre o adapter do spike |
| `server/processos/router-motor-proprio-teste.ts` | 308 | Ferramenta de QA (adminProcedure) |
| `server/processos/pje-tjce-extrair-cnjs.test.ts` | 81 | **Único teste do módulo** |
| `scripts/spike-motor-proprio/poc-2-esaj-login/adapters/pje-tjce.ts` | ~1700 | Adapter Playwright real |
| `scripts/spike-motor-proprio/lib/parser-utils.ts` | ~300 | `normalizarCnj`, `validarCnj`, `extrairCnjs`, `hashEvento` |

### Client
| Caminho | Linhas | Função |
|---|---:|---|
| `client/src/pages/Processos.tsx` | 1.951 | Página completa (4 abas + 1 oculta) |
| `client/src/pages/processos/search-history.tsx` | — | Histórico de buscas + alertas por palavra-chave (localStorage) |
| `client/src/components/NotificacoesSino.tsx` | — | Sino global (refetch 60s) |
| `client/src/components/MovimentacaoDetalheDrawer.tsx` | — | Drawer de detalhe de mov |

### DB / migrations relevantes
- `drizzle/schema.ts` — entidades nas linhas 165 (`notificacoes`), 781 (`cliente_processos`), 816 (`cliente_processo_anotacoes`), 1379 (`motor_monitoramentos`), 2539 (`eventos_processo`)
- `drizzle/0036_processo_tipo_anotacoes.sql` — coluna `tipo` em `cliente_processos`
- `drizzle/0048_kanban_processo.sql`, `0049_hotfix_kanban_processo.sql` — kanban x processo
- `drizzle/0050_motor_proprio_base.sql` — `eventos_processo` + UNIQUE em `hashDedup`
- `drizzle/0070_remove_judit.sql` — remove `monitoramentoId` antigo de `cliente_processos`
- `drizzle/0071_motor_monitoramentos.sql` — tabela do motor próprio (**sem UNIQUE em search_key + tipo**)
- `drizzle/0081_motor_monitoramentos_capa_partes.sql` — `capaJson`, `partesJson`
- `drizzle/0098_cliente_processos_cnj_opcional.sql` — `numeroCnj` torna-se NULL-able

---

## 3. Procedures tRPC

### 3.1 `processosRouter` (`server/routers/processos.ts:127`)

| # | Procedure | Gate | Permissão interna | Filtro de escopo | Cobra crédito? |
|--:|---|---|---|---|---|
| 1 | `saldo` (`:128`) | `protectedProcedure` | — | `escritorio.id` | não |
| 2 | `pacotes` (`:149`) | `protectedProcedure` | — | — (estático) | não |
| 3 | `consultarCNJ` (`:161`) | `protectedProcedure` | **nenhuma** | `cofreCredenciais.escritorioId` | sim (debita antes do scraper) |
| 4 | `statusConsulta` (`:250`) | `protectedProcedure` | **nenhuma** | **não valida que requestId pertence ao escritório** | não |
| 5 | `resultados` (`:267`) | `protectedProcedure` | **nenhuma** | idem | não |
| 6 | `transacoes` (`:284`) | `protectedProcedure` | — | `escritorioId` | não |
| 7 | `adicionarCreditos` (`:300`) | `adminProcedure` | role admin Jurify | aceita qualquer `escritorioId` | não |
| 8 | `meusMonitoramentos` (`:360`) | `protectedProcedure` | `checkPermission("processos","ver")` + JOIN com contatos se `verProprios` | `escritorioId` | não |
| 9 | `criarMonitoramento` (`:418`) | `protectedProcedure` | **nenhuma** | confere `credencial.escritorioId` | sim |
| 10 | `pausarMonitoramento` (`:499`) | `protectedProcedure` | **nenhuma** | `id+escritorioId` | não |
| 11 | `reativarMonitoramento` (`:524`) | `protectedProcedure` | **nenhuma** | `id+escritorioId` | não |
| 12 | `deletarMonitoramento` (`:549`) | `protectedProcedure` | **nenhuma** | `id+escritorioId` | não |
| 13 | `historicoMonitoramento` (`:573`) | `protectedProcedure` | **nenhuma** | filtra eventos por `(escritorioId, cnjAfetado)` — não por `monitoramentoId` (intencional) | não |
| 14 | `buscarProcessoCompleto` (`:698`) | `protectedProcedure` | **nenhuma** | confere escritório do monitoramento | sim (1 cred) |
| 15 | `criarMonitoramentoNovasAcoes` (`:874`) | `protectedProcedure` | **nenhuma** | confere credencial do escritório | sim (15 cred) |
| 16 | `listarNovasAcoes` (`:986`) | `protectedProcedure` | **nenhuma** | `eventosProcesso.escritorioId` | não |
| 17 | `marcarNovaAcaoLida` (`:1062`) | `protectedProcedure` | **nenhuma** | `eventosProcesso.escritorioId` | não |
| 18 | `atualizarNovasAcoesAgora` (`:1087`) | `protectedProcedure` | **nenhuma** | `id+escritorioId` | **não** (anti-abuso ausente) |

### 3.2 `clienteProcessosRouter` (`server/escritorio/router-cliente-processos.ts:39`)

| # | Procedure | Gate | Permissão interna |
|--:|---|---|---|
| 1 | `listar` (`:43`) | `protectedProcedure` | `checkPermission("clientes","ver")` + `podeVerCliente()` (filtra por responsável quando `!verTodos`) |
| 2 | `vincular` (`:113`) | `protectedProcedure` | **nenhuma `checkPermission`**; aceita qualquer membro |
| 3 | `desvincular` (`:188`) | `protectedProcedure` | **nenhuma** — atendente com id consegue deletar processo de outro responsável |
| 4 | `atualizar` (`:207`) | `protectedProcedure` | **nenhuma** |
| 5 | `listarAnotacoes` (`:272`) | `protectedProcedure` | confere escritório no SELECT do processo, mas SELECT das anotações só usa `processoId` |
| 6 | `criarAnotacao` (`:310`) | `protectedProcedure` | **nenhuma** |
| 7 | `excluirAnotacao` (`:339`) | `protectedProcedure` | `checkPermission("clientes","editar")` para não-autores |

### 3.3 `notificacoesRouter` (`server/processos/router-notificacoes.ts:60`)

| # | Procedure | Filtro |
|--:|---|---|
| 1 | `listar` (`:65`) | `userId == ctx.user.id` (+ filtro opcional por `tipos[]` / `lida=false`) |
| 2 | `contarNaoLidas` (`:109`) | `userId, lida=false` |
| 3 | `marcarLida` (`:130`) | `userId, id` |
| 4 | `marcarTodasLidas` (`:153`) | `userId` |
| 5 | `apagar` (`:174`) | `userId, id` |
| 6 | `limparLidas` (`:196`) | `userId, lida=true` |
| 7 | `detalheEvento` (`:221`) | dupla: SELECT evento + valida `escritorioId` resolvido |

---

## 4. Tabelas relevantes do schema

### `motor_monitoramentos` (`drizzle/schema.ts:1379`)
| Coluna | Tipo | NULL? | Detalhe |
|---|---|---|---|
| `id` | INT AI | NO | PK |
| `escritorioId` | INT | NO | — |
| `criadoPor` | INT | NO | userId |
| `tipoMonitoramento` | ENUM(`movimentacoes`,`novas_acoes`) | NO | — |
| `searchType` | ENUM(`lawsuit_cnj`,`cpf`,`cnpj`) | NO | — |
| `searchKey` | VARCHAR(64) | NO | CNJ **mascarado** (cf. `routers/processos.ts:473-481`) ou CPF/CNPJ normalizado |
| `tribunal` | VARCHAR(16) | NO | string literal (`"tjce"` hard-coded no cron) |
| `credencialId` | INT | YES | sem FK formal |
| `status` | ENUM(`ativo`,`pausado`,`erro`) | NO | — |
| `recurrenceHoras` | INT | NO | 6 default |
| `ultimaConsultaEm` | TIMESTAMP | YES | usado pra eleger pendentes |
| `hashUltimasMovs` | VARCHAR(64) | YES | SHA-256 das movs (sem normalização) |
| `cnjsConhecidos` | TEXT | YES | JSON array de CNJs (baseline pra `novas_acoes`) |
| `capaJson`, `partesJson` | TEXT | YES | adicionado em `0081` |
| `ultimoErro` | TEXT | YES | mostrado no `MonitorHealthDot` |

**Indexes:** `idx_motor_mon_escritorio`, `idx_motor_mon_user`, `idx_motor_mon_polling(status, ultimaConsultaEm)`, `idx_motor_mon_credencial`.
**Não existe UNIQUE** em `(escritorioId, searchKey, tipoMonitoramento)` — duplicação trivial.

### `eventos_processo` (`drizzle/schema.ts:2539`)
| Coluna | Tipo | Detalhe |
|---|---|---|
| `id` | BIGINT AI | PK |
| `monitoramentoId` | INT NULL | sem FK; órfão após `deletarMonitoramento` |
| `escritorioId` | INT NOT NULL | — |
| `tipoEvento` | ENUM | 10 valores |
| `dataEvento` | TIMESTAMP NOT NULL | momento real no tribunal |
| `conteudo` | TEXT NOT NULL | texto bruto da mov |
| `cnjAfetado` | VARCHAR(32) NULL | — |
| `hashDedup` | VARCHAR(64) **UNIQUE** | gerado por `hashEvento()` |
| `lido` | BOOLEAN | default false |
| `alertaEnviado` / `alertaEnviadoEm` | BOOLEAN/TIMESTAMP | **DEAD CODE** — nenhum código lê ou seta |

### `notificacoes` (`drizzle/schema.ts:165`)
| Coluna | Tipo | Detalhe |
|---|---|---|
| `id` | INT AI | PK |
| `userId` | INT NOT NULL | — |
| `tipo` | ENUM(`movimentacao`,`sistema`,`plano`,`nova_acao`) | — |
| `eventoId` | BIGINT NULL | FK lógica para `eventos_processo.id` |
| `lida` | BOOLEAN | default false |

**Sem UNIQUE de dedup** (nem em `(userId, eventoId, tipo)`). Isolamento só por `userId` — não há `escritorioId`.

### `cliente_processos` (`drizzle/schema.ts:781`)
- `numeroCnj` é NULL-able desde migration `0098`.
- **Sem UNIQUE** — dedup feito em app-level por `(contatoId, numeroCnj, escritorioId)` no router (`router-cliente-processos.ts:147-160`), só quando `cnj` presente.
- `monitoramentoId` foi removida em `0070`.

### `cliente_processo_anotacoes` (`drizzle/schema.ts:816`)
- **Sem `escritorioId`** — segurança depende 100% do JOIN no router.

---

## 5. Fluxo de monitoramento — end-to-end

### 5.1 Quem dispara
`server/_core/cron-jobs.ts`:
- `:295-304` — `setInterval(60min)` → `pollMonitoramentosMovs`
- `:307-314` — `setInterval(60min)` → `pollMonitoramentosNovasAcoes`
- `:216-223` — `setTimeout(40s)` na boot do servidor (1× imediata)
- `:328-335` — `setInterval(60min)` → `cron-revalidar-cofre`

**Sem lock distribuído** (Redis NX, advisory lock, flag `running_at`). Se um tick demorar > 60min (cenário plausível com Playwright), o próximo tick **inicia em paralelo**.

### 5.2 Detecção de "nova"
Mecanismo duplo:
1. **Hash agregado** (`motor_monitoramentos.hashUltimasMovs`) — detecta se vale comparar item a item. Calculado em `cron-monitoramento.ts:42-49` por `SHA256(movs.join("\n", "${data}|${texto.trim().slice(0,200)}"))`.
2. **Hash por evento** (`eventos_processo.hashDedup` UNIQUE) — barreira final. Calculado em `cron-monitoramento.ts:51-56` por `SHA256("movimentacao|${cnj}|${data}|${texto.slice(0,200)}")` **sem trim, sem normalização Unicode**.

INSERT com captura de errno `1062` (`ER_DUP_ENTRY`) é o sinal de dedup OK. Quando passa: cria-se notificação (até 3 por execução, `:308-318`) + push SSE (`:321-330`).

### 5.3 Notificação
- Cron faz `db.insert(notificacoes).values({...})` direto (`:311-318`, `:622-630`), **sem usar** o helper `criarNotificacao` (`router-notificacoes.ts:34-54`) e **sem dedup**.
- SSE: `emitirNotificacao(mon.criadoPor, ...)` — **só pro criador**, nunca pro escritório (cf. `sse-notifications.ts:114, 161` que tem `emitirParaEscritorio` e `emitirParaResponsaveisEMaster` mas não são chamados).

### 5.4 Particularidades do adapter PJe-TJCE
- **Único provider real exercido pelo cron**. Outros providers em `tribunal-providers.ts` são metadata sem implementação.
- `cron-monitoramento.ts:123` faz `if (mon.tribunal === "tjce")` — string-comparison literal. Qualquer outro tribunal: pula silencioso sem atualizar `ultimaConsultaEm` (`:126-131`), ficando eternamente pendente.
- 90 min de janela TOTP; revalidação a cada 60 min via `cron-revalidar-cofre`.
- Heurística de extração de movs (`scripts/spike-motor-proprio/poc-2-esaj-login/adapters/pje-tjce.ts:1079-1297`) tem **5 casos** de match no parser; o **caso 5** (item sem hora) cria `data` com `00:00:00` — se o layout do PJe mudar e tudo cair no caso 5, o `data` muda → **avalanche de "novas" movs**.
- Bug histórico do "CNJ fantasma" no header documentado em `pje-tjce.ts:766-780` (fix por seletor `[id*='processosTable']`). Já causou FP no passado.

---

## 6. CNJ — parsing, normalização, dedup

| Função | Arquivo | Faz |
|---|---|---|
| `normalizarCnj` | `scripts/spike-motor-proprio/lib/parser-utils.ts:16` | `.replace(/\D/g,"")` |
| `mascararCnj` | `:24` | aplica máscara padrão; se length ≠ 20 retorna input cru |
| `validarCnj` | `:39` | DV via módulo 97 com BigInt |
| `extrairCnjs` | `:256` | regex + filtra DV inválido |
| `parseCnjTribunal` | `server/processos/cnj-parser.ts:101-170` | extrai tribunal/UF/`temMotorProprio`. **Não valida DV**. |

**Tribunais com motor próprio (lista canônica)**: `cnj-parser.ts:68-71` → **apenas `"tjce"`**. Mas `sistemaCofrePorTribunal` (`:79-88`) lista `tjce, tjrj, tjmg, tjsp`. **Drift** entre as duas listas: a UI pode habilitar fluxos que o cron pula em silêncio.

**Onde CNJ é dedup:**
- `eventos_processo.hashDedup` UNIQUE: compõe-se de `tipo|cnj|data|texto[0:200]`.
- **`hashEvento` definido em DOIS lugares**:
  - `parser-utils.ts:233` aplica `normalizarTexto()` (lowercase + remove acento) antes do hash
  - `cron-monitoramento.ts:51` **não normaliza nada**
  - `routers/processos.ts:41` importa a versão do cron → mesma semântica
  - **Risco direto de FP** (ver §8).
- Para `nova_acao`: `hashDedup = sha256("nova_acao|${mon.id}|${cnj}")` — inclui o `mon.id`. Para `movimentacao`: `sha256("movimentacao|${cnj}|${data}|${texto[0:200]}")` — não inclui mon.id. **Inconsistência intencional?** Não documentada.

**Validação de CNJ no INPUT:**
- `routers/processos.ts:consultarCNJ` (`:161`) — só checa length 15-30. **Não chama `validarCnj`**.
- `router-cliente-processos.ts:vincular` (`:113`) e `atualizar` (`:207`) — **não validam DV**.
- `criarMonitoramentoNovasAcoes` — só `length` do CPF/CNPJ; **não valida DV**.
- `atualizarNovasAcoesAgora` — não revalida CNJs retornados pelo scraper antes de inserir como `nova_acao`. O filtro `validarCnj` só acontece na **leitura** (`listarNovasAcoes:1056`) — sino e contadores no DB ficam inflados.

---

## 7. UI e notificações

### 7.1 Página `Processos.tsx`
- 4 abas visíveis: Consultar / Monitorar / Novas ações / Cofre (+ Saldo).
- Polling: `statusConsulta` a cada 3s durante busca; `NovasAcoesBadge` a cada 60s.
- **Sem optimistic update** em nenhuma mutation; sempre `invalidate()` / `refetch()`.
- **Sem `refetchInterval`** em `meusMonitoramentos` nem `listarNovasAcoes` (tab) — atualização só por evento do user.
- **Sem listener de SSE no client** (não há `new EventSource(...)` em `client/src/` para este fluxo). O servidor pusha, mas ninguém escuta — fallback é apenas o refetch dos 60s.

### 7.2 Badges de "novo"
| Badge | Onde | Origem do "novo" |
|---|---|---|
| Sino global | `NotificacoesSino.tsx` | `notificacoes.lida=false` por `userId` |
| `NovasAcoesBadge` (header da aba) | `Processos.tsx:1233-1245` | `listarNovasAcoes.totalNaoLidas` (após filtro `validarCnj`) |
| Card "NOVO" em `NovasAcoesTab` | `Processos.tsx:1482-1484` | `!a.lido` direto de `eventos_processo` |
| `Bell {N}` em `ProcessoCard` (busca) | `Processos.tsx:126-128, 178-204` | **localStorage do usuário**, via `checkKeywords()` em `search-history.tsx:170-174`. **NÃO consulta o servidor.** |
| `MonitorHealthDot` (verde/amarelo/vermelho pulsante) | `Processos.tsx:45-110` | `updatedAt` do monitoramento; semântica é "checei recentemente", não "há novidade" |

### 7.3 SmartFlow ↔ Processos
**Zero integração.** Nenhum gatilho em `shared/smartflow-types.ts:10-21`. Nenhuma chamada do cron a `dispatcher.ts`. Nenhum executor (`server/smartflow/executores.ts`) reage a movimentação. O substantivo "processo" no smartflow refere-se a `cliente_processos.id` (ação jurídica vinculada a cobrança), não a monitoramento de tribunal.

---

## 8. Pontos de risco de falso-positivo — PRIORIZADO

### CRÍTICOS (P0)

#### FP-1. `hashEvento` sem normalização Unicode
**Onde:** `server/processos/cron-monitoramento.ts:51-56` (versão sem `normalizarTexto`) usada via import em `cron-monitoramento.ts:168-173`, `:245-250`, `:581` e `routers/processos.ts:41`.
**Comparar com:** `scripts/spike-motor-proprio/lib/parser-utils.ts:233-239` (versão **com** `normalizarTexto`, não usada pelo cron).
**Sintoma:** mesma movimentação volta como "nova" se o PJe re-renderiza com whitespace, acento ou case diferente nos primeiros 200 chars.
**Pista:** comentário do próprio autor em `cron-monitoramento.ts:333-346` (`// Hash mudou mas dedup não encontrou movs novas (re-render do PJe?)`) confirma que **já desconfiavam** disso.

#### FP-2. Ausência de lock entre cron-runs
**Onde:** `server/_core/cron-jobs.ts:295-304` (`setInterval` puro) + `server/processos/cron-monitoramento.ts:58-82` (SELECT de pendentes sem `FOR UPDATE`).
**Sintoma:** `setInterval(60min)` em runs sobrepostos processa o mesmo monitoramento 2×; UNIQUE em `eventos_processo` barra duplicatas de evento, **mas `notificacoes` não tem UNIQUE** → notif aparece 2× no sino.
**Aliado:** `ultimaConsultaEm` só é atualizado **após** a consulta (5-15s no Playwright). Janela ampla para race.

#### FP-3. `notificacoes` sem UNIQUE de dedup
**Onde:** `drizzle/schema.ts:165-187`. Não há índice em `(userId, eventoId, tipo)`.
**Sintoma:** se algum caminho (FP-2 ou bug futuro) tentar criar duas notifs apontando pro mesmo `eventoId`, ambas persistem. Hoje a defesa é só o UNIQUE em `eventos_processo` upstream.

#### FP-4. Notif criada **sem validar CNJ** em novas ações
**Onde:** `cron-monitoramento.ts:574-630` e `routers/processos.ts:atualizarNovasAcoesAgora:1142-1196` (caminho manual).
**Sintoma:** CNJ "fantasma" extraído pelo scraper entra em `eventos_processo.lido=false`. Filtro `validarCnj` só na leitura (`routers/processos.ts:1056`) — o sino mostra "1 nova ação detectada" **sem que ela apareça na tab**.

#### FP-5. Sem UNIQUE em `motor_monitoramentos(escritorioId, searchKey, tipoMonitoramento)`
**Onde:** `drizzle/0071_motor_monitoramentos.sql:58-61`.
**Sintoma:** user cria 2 monitoramentos para o mesmo CNJ → cron processa cada → 2 notificações por movimentação. Não há check de duplicata em `criarMonitoramento` (`routers/processos.ts:418-497`) nem em `criarMonitoramentoNovasAcoes` (`:874-984`).

### SÉRIOS (P1)

#### FP-6. `hashDedup` por texto truncado em 200 chars
**Onde:** `cron-monitoramento.ts:42-49, 166-173, 245-250`.
**Sintoma duplo:**
- Movs com mesmo prefixo de 200 chars colidem → **falso-negativo** (a segunda nunca entra).
- Variação dentro dos primeiros 200 chars (espaço duplo, acento, virgula) → hash diferente → **falso-positivo**.

#### FP-7. `hashDedup` de `nova_acao` inclui `mon.id`
**Onde:** `cron-monitoramento.ts:581` e `routers/processos.ts:1170-1172`.
**Sintoma:** user deleta + recria monitoramento de CPF → novo `mon.id` → mesmo CNJ entra como nova ação porque hash é diferente do anterior. `cnjsConhecidos` deveria barrar, mas começa em `null/[]` num monitoramento novo.

#### FP-8. Bell badge usa **localStorage** do usuário
**Onde:** `client/src/pages/Processos.tsx:126-128, 178-204` + `search-history.tsx:134-139, 170-174`.
**Sintoma:** badge azul com `animate-pulse` aparece em qualquer processo cujo texto contenha keyword salva. Independente de "novo" real. UX mistura "alerta de keyword" e "movimentação não lida" com o mesmo componente `Bell`.

#### FP-9. `deletarMonitoramento` deixa eventos órfãos
**Onde:** `routers/processos.ts:549` (DELETE em `motor_monitoramentos` sem cascade).
**Sintoma:** ao recriar monitoramento do mesmo CNJ, `historicoMonitoramento` puxa eventos antigos (filtra por `cnjAfetado`, não por `monitoramentoId`). Em `listarNovasAcoes`, `leftJoin` traz `apelido=null`. Se o `monitoramentoId` for reciclado, pode trazer dados de outro monitoramento.

#### FP-10. Heurística de extração de movs no PJe (5 casos)
**Onde:** `scripts/spike-motor-proprio/poc-2-esaj-login/adapters/pje-tjce.ts:1079-1297`.
**Sintoma:** se o PJe muda layout, items caem no **caso 5** (sem hora, usa `dataAtual` com `00:00:00`). Combinado com FP-1, **todas as movs viram "novas"** num único run.

#### FP-11. Reset de `hashUltimasMovs` com payload incompleto
**Onde:** `cron-monitoramento.ts:333-346`.
**Sintoma:** se o PJe devolve lista incompleta (timeout AJAX, paginação rasa), o branch atualiza `hashUltimasMovs` para um hash **truncado**. Próximo run com payload completo dispara `houveMudanca=true`. UNIQUE evita FP de evento, mas o monitoramento entra em "loop de mudança" e os logs ficam ruidosos.

#### FP-12. Notificação só pro `criadoPor`
**Onde:** `cron-monitoramento.ts:312, 321, 623, 632`.
**Sintoma:** **falso-negativo**, não positivo: dono/gestor do escritório não vê notif se quem criou o monitoramento foi um atendente desativado.

### MÉDIOS (P2)

#### FP-13. Race `buscarProcessoCompleto` × cron
**Onde:** `routers/processos.ts:698-868` × `cron-monitoramento.ts:58-373`. Ambos sobrescrevem `hashUltimasMovs` em `motor_monitoramentos`. O cron pode sobrescrever com hash mais antigo se chegar depois.
**Sintoma:** próximo cron detecta tudo como "novo" porque o baseline foi rebaixado.

#### FP-14. `consultarCNJ` cobra antes do scraper
**Onde:** `routers/processos.ts:161-247`.
**Sintoma:** scraper falha em background → crédito debitado, sem refund. Não é FP de detecção; é FP financeiro.

#### FP-15. Drift entre `TRIBUNAIS_COM_MOTOR_PROPRIO` e `sistemaCofrePorTribunal`
**Onde:** `cnj-parser.ts:68-71` (só `tjce`) vs `:79-88` (`tjce, tjrj, tjmg, tjsp`).
**Sintoma:** UI pode permitir habilitar TJRJ; cron pula silencioso sem update de `ultimaConsultaEm` (`cron-monitoramento.ts:126-131`).

#### FP-16. Timezone hardcoded "America/Fortaleza"
**Onde:** `pje-tjce.ts:149,221,642` (browser context) + `parser-utils.ts:131,149` (offset `-03:00`).
**Sintoma:** mov à beira da meia-noite pode mudar de dia entre runs com encoding diferente → `dataEvento` muda → hash muda → FP.

#### FP-17. Atualização ilimitada sem cobrança
**Onde:** `routers/processos.ts:atualizarNovasAcoesAgora:1087`.
**Sintoma:** não é FP, é abuso. Usuário pode forçar polling sem limite de taxa nem débito.

### BAIXOS (P3)

#### FP-18. Cache `motor-proprio-runner` sem validação de escritório
**Onde:** `routers/processos.ts:statusConsulta:250, resultados:267`.
**Sintoma:** se requestId vaza em log, qualquer user logado lê resultado. Severidade real baixa (UUID).

#### FP-19. `clienteProcessos.desvincular`/`atualizar`/`vincular` sem `checkPermission`
**Onde:** `router-cliente-processos.ts:113, 188, 207`.
**Sintoma:** atendente sem permissão `clientes.editar`/`excluir` consegue alterar/deletar processo do escritório, contornando matriz de permissões.

#### FP-20. Heurística monetária `parseValorBRLCentavos`
**Onde:** `scripts/spike-motor-proprio/lib/parser-utils.ts:185-224`.
**Sintoma:** fronteira em 1000 arbitrária ("999" reais? centavos?). Capa salva pode oscilar.

#### FP-21. Colunas dead-code em `eventos_processo`
**Onde:** `drizzle/schema.ts:2565-2566` — `alertaEnviado`, `alertaEnviadoEm`. Nenhum código lê ou seta.
**Sintoma:** confusão de manutenção; pista de dedup de notif que ficou incompleta.

---

## 9. Hipóteses sobre o FP recente (ordem decrescente de probabilidade)

1. **FP-1 + FP-2 combinados** — uma re-renderização do PJe alterou whitespace dentro dos primeiros 200 chars de uma movimentação **enquanto** um cron-run sobreposto inseriu o evento "novo" com hash distinto. Notif disparou pelo run paralelo. **Mais provável.**
2. **FP-4** — scraper devolveu CNJ inválido (fantasma) em `consultarPorCpf`. Notif foi criada (sem `validarCnj`) e o sino mostrou "1 nova ação"; a tab filtrou e ficou vazia. **Sintoma típico**: o usuário vê badge mas, ao abrir, não há item correspondente.
3. **FP-10** — mudança de layout do PJe levou movs ao caso 5 do parser (data com `00:00:00`), gerando hashes novos para mov pré-existentes. **Avalanche** num único run.
4. **FP-5 + FP-9** — usuário deletou e recriou monitoramento; eventos órfãos retornaram via `historicoMonitoramento`; novas ações vieram com `hash` distinto por causa do `mon.id` em FP-7.
5. **FP-8** — badge `Bell` (UI) com keyword muito genérica. **Não é falso-positivo lógico**, é UX confusa — mas costuma ser reportado como FP pelo usuário.

Sem mais contexto sobre o evento concreto (que CNJ, que usuário, qual notificação), as 5 hipóteses ficam empatadas no topo. **Recomendação imediata**: instrumentar telemetria (próxima seção) pra cobrir todas elas.

---

## 10. Testes existentes e gaps

### Existem
- `server/processos/pje-tjce-extrair-cnjs.test.ts` — 7 testes de `extrairCnjs` (DV válido/inválido, escopo HTML, duplicatas). Cobre o bug N+1 histórico.
- `server/__tests__/motor-credit-calc.test.ts` — 22 testes, mas sobre `CUSTOS_JUDIT` **legado**, não sobre os `CUSTOS` atuais do motor próprio (`routers/processos.ts:53`).

### **Não existem** (gaps críticos)
- Nenhum teste das procedures tRPC (`processosRouter`, `clienteProcessosRouter`, `notificacoesRouter`).
- Nenhum teste de `validarCnj`, `parseCnjTribunal`, `hashEvento`.
- Nenhum teste de `pollMonitoramentosMovs` / `pollMonitoramentosNovasAcoes`.
- Nenhum teste de **race condition** (cron × `buscarProcessoCompleto`; cron × cron).
- Nenhum teste do **baseline silencioso** (`isPrimeiraExecucao`).
- Nenhum teste de **mudança de texto re-renderizada** (caso FP-1).
- Nenhum teste de **payload incompleto** (caso FP-11).
- Nenhum teste de **layout PJe quebrado** (caso FP-10).
- Nenhum teste do `adaptarParaJuditShape` (`routers/processos.ts:76-111`).
- Nenhum teste de dedup com retry após `ER_DUP_ENTRY`.

---

## 11. Recomendações priorizadas

### Hotfix (faça primeiro — baixo risco, alto retorno)
1. **Unificar `hashEvento`**: importar a versão de `parser-utils.ts` (com `normalizarTexto`) no cron e nos routers. Apagar a duplicata em `cron-monitoramento.ts:51-56`. **Aborta FP-1.**
2. **Validar CNJ na escrita** de novas ações: aplicar `validarCnj` em `cron-monitoramento.ts:574-614` e em `routers/processos.ts:atualizarNovasAcoesAgora:1142-1196` antes do INSERT. **Aborta FP-4.**
3. **UNIQUE em `notificacoes`**: `ALTER TABLE notificacoes ADD UNIQUE KEY uq_notif_dedup (userId, tipo, eventoId)` (cuidado com `eventoId` NULL — usar `tipo+userId+coalesce(eventoId, 0)+createdAt[trunc]` ou índice parcial). **Aborta FP-3.**
4. **Lock distribuído no cron**: adicionar `motor_monitoramentos.processing_started_at` + flag `processing_pid` (ou `SELECT GET_LOCK('motor-cron', 0)` no MySQL). **Aborta FP-2.**

### Médio prazo
5. **UNIQUE em `motor_monitoramentos(escritorioId, searchKey, tipoMonitoramento)`** + check no `criarMonitoramento`/`criarMonitoramentoNovasAcoes` retornando erro amigável. **Aborta FP-5.**
6. **Cascade em `eventos_processo`** quando `deletarMonitoramento` (soft-delete preferível pra preservar histórico). **Aborta FP-9.**
7. **`checkPermission` em mutations sensíveis** de `clienteProcessosRouter` (`vincular`/`desvincular`/`atualizar`/`criarAnotacao`). **Aborta FP-19.**
8. **Refund ou debit-after-success** no `consultarCNJ`. **Aborta FP-14.**
9. **Separar Bell de keyword e Bell de notificação** no `ProcessoCard`. **Aborta FP-8.**

### Observabilidade (essencial)
10. **Log estruturado em cada criação de notificação**: `log.info({userId, tipo, eventoId, monId, motivo}, "notif criada")`.
11. **Log estruturado em cada chamada do scraper**: input, contagem retornada, primeiras 3 movs.
12. **Audit de `marcarLida`**: campo `lidaEm` (timestamp) + log.
13. **Métrica de "notifs criadas por hora"** + alerta de spike (>10× baseline).

### Teste
14. Suite de regressão pra `pollMonitoramentosMovs` com:
    - mock do adapter retornando texto com whitespace alterado entre 2 runs (cobre FP-1)
    - duas chamadas concorrentes do `pollMonitoramentosMovs` (cobre FP-2)
    - payload com 5 movs depois 10 movs (cobre FP-11)
    - CNJ fantasma no retorno (cobre FP-4)
    - `mon` recriado com mesmo CNJ (cobre FP-7, FP-9)
15. Test de `hashEvento` cruzado: garantir que `"  decisão  "` e `"decisao"` resolvem pro mesmo hash após o fix do item 1.

---

## 12. Anti-padrões observados (vide `CLAUDE.md`)

| Anti-pattern (CLAUDE.md) | Ocorrência |
|---|---|
| `protectedProcedure` sem gate adicional onde a regra é "dono/gestor" | Várias procedures: `criarMonitoramento`, `pausar/reativar/deletarMonitoramento`, `clienteProcessos.vincular/desvincular/atualizar` |
| `cargo === "dono"` hardcoded | **Não encontrado** no módulo de processos (existe em `router-crm.ts:80,91` — fora do escopo) |
| Erro em integração só no response (sem persistir) | `consultarCNJ` cobra antes; falha do scraper não reverte. `cron-monitoramento.ts` persiste `ultimoErro` em `motor_monitoramentos` — **OK** |
| `confirm()` nativo do browser | Não verificado nesta auditoria |
| Gate admin em procedure usada por dropdown | Não detectado |
| Modificação de `authenticator.options` global | Não aplicável a este módulo |

---

## Apêndice: estrutura de pastas relevante

```
server/
├── routers/
│   ├── processos.ts                  ← router principal (1.206 linhas)
│   └── dashboard.ts                  ← usa eventos_processo
├── escritorio/
│   └── router-cliente-processos.ts   ← processo ↔ contato
├── processos/
│   ├── adapters/pje-tjce.ts          ← wrapper fino do spike
│   ├── cnj-parser.ts
│   ├── credit-calc.ts                ← legado Judit
│   ├── cron-monitoramento.ts         ← coração do polling
│   ├── motor-proprio-runner.ts       ← cache in-memory
│   ├── pje-tjce-extrair-cnjs.test.ts ← ÚNICO TESTE
│   ├── router-motor-proprio-teste.ts ← admin QA
│   ├── router-notificacoes.ts
│   └── tribunal-providers.ts
└── _core/
    ├── cron-jobs.ts                  ← setInterval declarado aqui
    └── sse-notifications.ts

client/src/
├── pages/
│   ├── Processos.tsx                 ← 1.951 linhas
│   └── processos/
│       └── search-history.tsx        ← keyword alerts (localStorage)
└── components/
    ├── NotificacoesSino.tsx
    └── MovimentacaoDetalheDrawer.tsx

scripts/spike-motor-proprio/
└── poc-2-esaj-login/
    └── adapters/pje-tjce.ts          ← scraper Playwright real
```
