# Relatório de Auditoria Completa — JuridFlow (julho/2026)

Estudo completo da plataforma, levantamento de falhas e plano de correção.
Elaborado após os dois incidentes de banimento WhatsApp (cliente Boyadjian) e
como resposta à pergunta do dono: *"o que podemos fazer para nunca mais
acontecer isso?"*

**Metodologia:** 12 agentes de análise independentes em 3 ondas — (1) auditoria
inicial por subsistema (WhatsApp/Meta, Smartflow, Asaas, arquitetura, banco,
billing/backup/upload, scrapers/cofre, auth/multi-tenant, segurança); (2)
verificação exaustiva pós-correções (varredura de todos os caminhos de envio,
revisão adversarial dos próprios fixes, validação contra a documentação atual
da Meta); (3) contraditório — cada achado crítico/alto revisado por um
verificador independente instruído a refutá-lo. Todo achado tem evidência
`arquivo:linha`. Estado do código na conclusão: `pnpm check` limpo, **2.819
testes verdes**.

---

## 1. Sumário executivo

- **Os dois bans tiveram causas distintas e ambas foram tratadas.** O 1º foi
  comportamental (disparo frio em massa + dunning perpétuo — cenário de
  cobrança vencida sem horário disparava 1×/dia para sempre). O 2º foi
  **estrutural**: número novo criado sobre a linhagem banida (mesma BM), caiu
  por associação praticamente sem tráfego — a cota de mensagens nunca foi
  estourada, o que confirma que ban vem de *qualidade* e *integridade*, não de
  volume.
- **4 lotes de correção anti-ban foram implementados, verificados e estão em
  produção.** O sistema hoje tem defesa em camadas: guard universal em todos
  os 18 caminhos de envio, opt-out irrefutável (resolvido por telefone), freio
  automático por qualidade (YELLOW = ½ teto, RED = pausa proativos), teto
  conservador para número novo (250/dia), disjuntor persistido multi-fonte,
  dunning com limite blindado, retomadas sem duplicação e alertas push ao dono
  para qualquer sinal de degradação.
- **Fora do WhatsApp, as maiores exposições da plataforma estão no Asaas
  (risco de cobrança dupla ao cliente final e de perda silenciosa de webhooks),
  nos uploads (arquivos de clientes em disco efêmero e servidos publicamente
  sem autenticação) e em 3 IDORs no kanban.** Nenhuma corrigida ainda — são o
  P0 do plano.
- A base é sólida: criptografia AES-256-GCM nas credenciais, isolamento
  multi-tenant consistente na grande maioria das procedures, scrypt + rate
  limit no login, HMAC timing-safe nos webhooks, suite com 2.8k+ testes.

---

## 2. Visão geral da plataforma

**Stack:** TypeScript ponta a ponta. Backend Express + tRPC 11 (server/_core),
MySQL via drizzle-orm, migrations por runner próprio no boot
(`auto-migrate.ts`). Frontend React + Vite (client/src), Radix UI. Deploy
Railway (develop→staging, main→produção), instância única. Sentry, Resend,
OpenAI, Web Push. 90 tabelas em `drizzle/schema.ts`.

**Domínios funcionais:**

| Domínio | Onde mora | Descrição |
|---|---|---|
| Cálculos jurídicos | server/calculos | Bancário, trabalhista, previdenciário etc. (motores puros + BACEN) |
| CRM / Atendimento | server/escritorio, routers/customer360 | Contatos, conversas, inbox WhatsApp/IG/FB, leads, pipeline |
| WhatsApp Cloud API | server/integracoes/whatsapp-* | Canal oficial Meta: envio, webhook, guard anti-ban, calling |
| Smartflow | server/smartflow | Automações por grafo (gatilhos, IA, cobranças, agendamentos) |
| Financeiro / Asaas | server/integracoes/asaas-*, escritorio/router-financeiro | Cobranças, assinaturas, extrato, comissões, despesas |
| Processos / Motor próprio | server/processos, scripts/spike-motor-proprio | Scraping autenticado PJe (TJCE) + TRF5 público, monitoramentos, cofre de credenciais |
| Jurídico | server/juridico | Peças, catálogo, RAG de fontes |
| Agenda | escritorio/router-agenda | Compromissos, prazos, lembretes |
| Billing SaaS | server/billing | Planos, assinaturas (Asaas), créditos por escritório, trial |
| Admin | server/admin | Painel superadmin global (integracões, erros, backup, tribunais) |

**Multi-tenancy:** `escritorios.id` é a raiz; tenant resolvido por-procedure a
partir do usuário logado (sem middleware central — ver falha S6). Permissões
via `checkPermission` (dono/gestor/cargos personalizados).

---

## 3. O incidente dos bans e o escudo construído

### Causa raiz

1. **1º ban (jul/2026):** disparo frio em massa + o *dunning perpétuo* — no
   modo legado, cenário `pagamento_vencido` sem horário configurado tinha só
   dedupe de 24h: 1 mensagem/dia por cobrança vencida, para sempre. O próprio
   código registrava que um cenário com 20 disparos/dia causou ban por
   "Sending spam".
2. **2º ban:** estrutural. Número novo na mesma estrutura banida → sistema de
   integridade da Meta derruba por associação, sem precisar de tráfego.
   Confirmado pela validação de documentação: "ban evasion" suspende o
   portfólio inteiro.

### Os 4 lotes de correção (todos em produção)

| Lote | Commit | Conteúdo |
|---|---|---|
| 1 | bb407e2 | Trava dura da janela de 24h no composer (UI) + sinalização de canal inoperante (badge vermelho, banner, lista) |
| 2 (P0) | 56bbd87 | Fim do dunning perpétuo; "Nova Conversa" por todas as travas + janela; interativo com opt-out/opt-in; botões/listas/reação pelo guard; tier default 250 |
| 3 (escudo) | 98fab6d | Opt-out resolvido por telefone no guard; freio por qualidade (YELLOW ½, RED pausa); alertas push ao dono (qualidade/disjuntor/tier); chamada perdida pelo guard |
| 4 (verificação) | d51f24c | Guard no pedido de permissão de ligação; retomada por timeout como proativo; claim atômico nas retomadas; NaN não desliga mais tetos; interativo/texto na timeline; janela por par contato×canal; falha transitória não queima lembrete; alerta de template pausado |

### Estado atual das camadas anti-ban

1. **Guard universal** (`whatsapp-envio-guard.ts`): disjuntor persistido →
   freio RED → teto diário por tier (default 250) → rate 10/min-200/h →
   opt-out (por contatoId OU telefone) → opt-in. Verificado: **18/18 caminhos
   de envio passam por ele.**
2. **Disjuntor multi-fonte:** tripa por erro síncrono, webhook `failed`,
   `account_update` da WABA e health-check; reativação manual apenas.
3. **Observabilidade ativa:** notificação in-app + SSE + web push ao dono em
   transição de qualidade, disjuntor, rebaixamento de tier e template
   pausado/desativado. Canal caído aparece em vermelho no Atendimento.
4. **Automações domadas:** repetirPorDias com clamp blindado; throttle 1,2s;
   reagendamento (nunca descarte); claim atômico; execução com erro não
   consome lembrete; MAX_DISPAROS_DIA=3.

### Confirmações da documentação Meta (jul/2026)

- Classificação do disjuntor **correta**: 131031/368 pausam tudo; 131048 pausa
  o número; 131049 (cap por usuário), 131056 (par), 131026 (destinatário/cap
  de marketing), 130497 (país) são limites normais.
- **Mudança importante (out/2025): limites por PORTFÓLIO**, não por número —
  ver item A-Meta1 no plano.
- Coexistência app+API é oficial; número ex-WABA precisa de cooldown ~1-2
  meses antes de reonboard.
- Enviar template pausado falha síncrono (132015) sem entregar — não fere o
  quality score; o risco é operacional (3ª pausa = desativação permanente).

### Itens anti-ban ainda abertos (nenhum é vetor provável isolado)

| Item | Severidade | Descrição / fix desenhado |
|---|---|---|
| A-Meta1. Teto por portfólio | média | Teto hoje é por canal; escritório com 2+ números na mesma BM pode somar acima do limite compartilhado. Fix: agregar `disparosDia` por WABA/escritório no guard |
| A-Meta2. Dedupe inbound por wamid | média | Redelivery da Meta duplica mensagem → bot responde 2×. Fix: `idExterno` no insert de entrada + check |
| A-Meta3. Quiet hours | média | `PAYMENT_OVERDUE` do Asaas pode disparar cobrança de madrugada. Fix: janela default 8h–21h no fuso do escritório p/ proativo sem slot |
| A-Meta4. Categoria MARKETING | média | Consentimento transacional (Asaas) libera qualquer template; MARKETING deveria exigir inbound real. Fix: cache da categoria + gate no guard |
| A-Meta5. idExterno nas respostas do bot | baixa | `failed` não casa com a bolha (disjuntor tripa mesmo assim). Fix: gravar `r.idExterno` |
| A-Meta6. Router legado whatsappCoex | baixa | Não envia, mas `exchangeCode` sobrescreve canal. Fix: remover do appRouter |
| A-Meta7. Watchdog de execuções órfãs | baixa | `rodando` + `retomarEm NULL` fica pra sempre. Fix: cron diário marca erro após 24h |
| A-Meta8. Expiração de token | baixa | Token morto = silêncio. Fix: detectar 190/OAuthException no health-check → notificarSaudeCanal |
| A-Meta9. Telemetria 131xxx / quota por tenant | baixa | Base p/ detectar tenant abusivo antes da Meta. Tabela leve de contadores |
| A-Meta10. Blocklist graph.facebook.com no chamarWebhook | baixa | Vetor teórico de envio fora do guard |

---

## 4. Levantamento de falhas — demais áreas (todas ABERTAS)

### 4.1 Asaas (gateway de pagamento) — prioridade máxima fora do WhatsApp

| # | Sev. | Falha | Evidência |
|---|---|---|---|
| AS1 | **crítica** | `conectar` rotaciona `webhookToken` em todo reconnect sem garantir re-registro no Asaas → webhooks caem em 401 e o Asaas **interrompe a fila** silenciosamente; nada detecta/repara | router-asaas.ts:695,707-731; asaas-webhook.ts:93-96 |
| AS2 | **crítica** | Criação de cobrança sem idempotência outbound (sem `externalReference`): timeout + reclique = **cliente final cobrado 2×**; retry de parcelamento recomeça da parcela 1 | router-asaas.ts:2257-2267, 5071-5137 |
| AS3 | alta | `syncCobrancasDeCliente` sem filtro de escritório: 2 escritórios na mesma conta Asaas → sync de um **deleta/atualiza cobrança do outro** | asaas-sync.ts:255-256, 267-268 |
| AS4 | alta | Webhook marca evento processado ANTES de agir (crash perde evento) e CONFIRMED/RECEIVED dividem a mesma chave (data de pagamento errada até o sweep) | asaas-webhook.ts:126-153 |
| AS5 | alta | Webhook responde 500 sem validação Zod → payload inesperado pausa a fila do Asaas; sem dead-letter | asaas-webhook.ts:519-522 |
| AS6 | alta | API key revogada em runtime: 401 cai em log genérico, status continua "conectado", sem badge de erro | asaas-sync.ts:717-773 |
| AS7 | média | Estornos: débito de PAYMENT_REVERSAL invisível no extrato; taxa não revertida em REFUNDED; PARTIALLY_REFUNDED sem card | asaas-extrato.ts:71-81 |
| AS8 | média | Procedures de sync sem `checkPermission` (`forcarMigracao` deleta vínculos com login simples) | router-asaas.ts:3307-3310 |
| AS9 | média | Billing SaaS: renovação hardcoded +30d (assinante ANUAL fica "vencido" 30d após pagar) | asaas-billing-webhook.ts:242-245 |
| AS10 | média | Rate guard: um 429 pontual congela a cota por até 12h mesmo com Retry-After de 60s | asaas-rate-guard.ts:393-396 |
| AS11 | baixa | `listarAssinaturas` = 1 GET/vínculo por render; sandbox/prod por heurística de string; dinheiro em varchar; paginação pode pular registros | vários |

*O que já está bem:* criptografia da key, rate guard 4 camadas persistente,
UNIQUEs + upserts, 429 handling nos syncs, 22 arquivos de teste.

### 4.2 Segurança

| # | Sev. | Falha | Evidência |
|---|---|---|---|
| S1 | **crítica** | `/uploads` servido por `express.static` **sem autenticação** — documentos jurídicos com PII acessíveis por URL (LGPD) | _core/index.ts:149 |
| S2 | **crítica** | Uploads em **disco efêmero** — sem volume Railway montado, anexos/assinaturas/modelos somem a cada deploy (o código só loga warning) | _core/index.ts:59-79 |
| S3 | alta | IDOR kanban: `deletarColuna`/`editarColuna`/`criarColuna` sem checagem de tenant — qualquer logado deleta coluna+cards de outro escritório por id sequencial | router-kanban.ts:160-201 |
| S4 | média | XSS: saída de IA renderizada via `marked` + `dangerouslySetInnerHTML` sem sanitização | Processos.tsx:807,827 |
| S5 | média | `express.json({limit:"3gb"})` global + upload base64 em RAM → DoS/OOM | _core/index.ts:137-147 |
| S6 | média | Fallbacks de segredo condicionados só a `NODE_ENV` (ENCRYPTION_KEY←SHA256(DATABASE_URL); JWT_SECRET←"") — deploy sem NODE_ENV=production = sessões forjáveis | crypto-utils.ts:23-34; _core/env.ts:1-12 |
| S7 | baixa-média | Webhooks Cal.com/Meta fail-open sem secret ("no-secret"); CPF em logs; `removerComentario`/`removerLembrete` cross-tenant | calcom-signature.ts:64; db-crm.ts:158; router-kanban.ts:1055; router-agenda.ts:944 |
| S8 | baixa | Sem token CSRF (mitigado por content-type + sem CORS); rate limit por instância; sem graceful shutdown; pdf-parse antigo | vários |

*O que já está bem:* sem secrets hardcoded; cofre AES-256-GCM; scrypt +
anti-brute-force; JWT HS256 fixado; SSE autenticado por cookie; drizzle
parametrizado; Helmet/HSTS; impersonation auditada.

### 4.3 Infra, dados e billing

| # | Sev. | Falha |
|---|---|---|
| I1 | alta | Limites de plano aplicados da constante hardcoded `LIMITES` (@deprecated), não da tabela `planos` — edição no admin não tem efeito; monitoramentos/cobranças nunca são limitados; colaborador extra não bloqueia |
| I2 | alta | `past_due` não restringe acesso — inadimplente mantém tudo (só perde reset de créditos) |
| I3 | média | Backup depende de cron do GitHub Actions — se pausar, para em silêncio; restore global manual e nunca testado |
| I4 | média | Journal do drizzle-kit parado no 0016 (164 arquivos) — `drizzle-kit migrate` aplicaria 17 e causaria drift; dupla fonte de verdade (ensure* + SQL); migration fatal re-tenta todo boot só com Sentry |
| I5 | média | `getDb()` retorna null sem DATABASE_URL → app degrada silenciosamente (helpers retornam vazio) |
| I6 | baixa | Números de migration duplicados (23) e gaps; `run-migrations.ts` manual com drift latente |

### 4.4 Motor próprio (scrapers PJe) e cofre

| # | Sev. | Falha |
|---|---|---|
| M1 | alta | O "spike descartável" É o motor de produção (server importa `scripts/spike-motor-proprio` em runtime); sem gate de ambiente; Chromium no mesmo processo da API (OOM/latência) |
| M2 | alta | ENCRYPTION_KEY única global sem KMS; rotação/perda = credenciais irrecuperáveis; fallback dev derivável da DATABASE_URL |
| M3 | média | Login a cada ~60min por credencial (sessão 90min + cron 60min) sem delay entre requests → risco de lockout da conta do advogado; sem captcha handling |
| M4 | média | 2FA reduzido a 1 fator (TOTP secret armazenado); robô raspa secret novo da tela no CONFIGURE_TOTP (frágil a mudança de layout) |
| M5 | média | Suposições single-instance em guards/caches/dedups — escala horizontal duplica scrapes |
| M6 | contextual | Exposição legal/ToS: automação autenticada em tribunais com credenciais reais do advogado |

---

## 5. Plano de correção priorizado

### P0 — próxima sprint (protege dinheiro e dados de cliente)

1. **AS1** Webhook Asaas resiliente: só rotacionar token com re-registro
   confirmado + campo `ultimoWebhookEm` + alerta "conectado e sem eventos há
   N horas" + re-arme de `interrupted`.
2. **AS2** Idempotência outbound: `externalReference` único por operação/
   parcela + consulta prévia; retry de parcelamento retoma da faltante.
3. **AS3** Filtro de `escritorioId` nos 2 pontos do sync legado (fix de 2
   linhas + teste).
4. **S1+S2** Uploads: montar volume Railway (`docs/setup-volume-railway.md` já
   existe) e servir `/uploads` por rota autenticada com verificação de
   escritório (padrão já existe em `assinatura-pdf-route.ts`).
5. **S3** Kanban: `checkPermission` + validação de funil nos 3 endpoints de
   coluna (+ os 2 menores de comentário/lembrete).

### P1 — mês 1

6. **AS4/AS5/AS6** Webhook Asaas: agir-antes-de-marcar, Zod no payload,
   200-com-log para erro não-recuperável, 401→status erro visível.
7. **A-Meta1** Teto agregado por portfólio/WABA no guard.
8. **A-Meta2/A-Meta3** Dedupe por wamid + quiet hours default.
9. **S4/S5/S6** DOMPurify na saída de IA; reduzir limite de body/streaming de
   upload; segredos exigidos por `resolverAmbiente()`.
10. **I1/I2** Limites de plano lendo da tabela `planos`; gate de `past_due`
    (redução de acesso após N dias).
11. **AS9** Ciclo real na renovação do billing (anual).

### P2 — trimestre

12. Restantes A-Meta4..10 (categoria, coex, watchdog, token, telemetria).
13. **AS7/AS8/AS10** Estornos ponta a ponta; permissões nos syncs; rate guard
    com escopo por endpoint.
14. **I3/I4** Backup com verificação de execução + teste de restore
    documentado; saneamento do sistema de migrations.
15. **M1..M5** Motor próprio: extrair p/ worker (BullMQ), gate de ambiente,
    delays entre logins, plano de rotação da ENCRYPTION_KEY.
16. **S7/S8** Fail-closed nos webhooks ativos, mascarar CPF em logs, CSRF
    token, graceful shutdown.
17. **Produto:** módulo **Campanhas** (público com opt-in, só templates
    APPROVED, fila com pacing, métricas, parada automática) e **Modo
    Aquecimento** por canal (rampa automática condicionada a qualidade).

### Estratégico

18. **Tech Provider da Meta** — obrigatório para ISVs desde 2025; formaliza a
    posição da plataforma e destrava Embedded Signup/limites.
19. Fila/worker dedicado (scrapers + broadcasts), Redis para rate limits,
    preparação multi-instância.

---

## 6. Recomendações operacionais (fora do código)

1. **Apelações**: manter as duas (protocolo do 1º ban + 2º) via Business
   Support Home; nunca clicar "Já resolvi"; argumento: conta sempre dentro
   dos limites de volume.
2. **Nada de 3º número na estrutura banida** até apelação resolver. Número
   ex-API no app: ok para atendimento 1-a-1 (sem broadcast!); reonboard na
   API só após cooldown de 1-2 meses + exclusão da WABA antiga.
3. **Cliente novo**: BM própria verificada, opt-in desde o contrato, clientes
   iniciando a conversa (link wa.me divulgado por outros canais), rampa
   20-30/dia na 1ª semana.
4. **Higiene do app da plataforma** (runbook): Data Use Checkup anual (criar
   lembrete recorrente), ≥2 admins com 2FA por app autenticador, política de
   privacidade no ar, remover app legado das WABAs, levar acesso avançado até
   o fim. O app NÃO precisa ser trocado — bans de cliente não cascateiam para
   o app; o vetor real é compliance própria.
5. **Contrato padrão**: cláusula de consentimento WhatsApp + rodapé "Responda
   SAIR" nos templates (já no runbook — auditar adoção).

---

*Notas de trabalho detalhadas (evidências por agente): scratchpad da sessão,
diretório `notas-auditoria/`. Runbook operacional WhatsApp:
`docs/runbook-whatsapp-meta.md`.*
