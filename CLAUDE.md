# JuridFlow — guia rápido para sessões Claude Code

## Comandos essenciais

```bash
pnpm check              # typecheck + lint
pnpm test               # vitest (server/**/*.test.ts) — meta: 910+ verdes
pnpm vitest run <file>  # roda 1 teste específico
pnpm dev                # dev server local
```

## Branches e deploy

- Branch de trabalho: `claude/setup-railway-environments-QadcF`
- Fluxo: feature branch → PR → merge em `develop` → PR `develop → main` → deploy production via Railway
- `develop` dispara deploy de **staging**; `main` dispara **production**
- Migrations em `drizzle/NNNN_*.sql` (numeração sequencial, ALTER TABLE com defaults pra ser non-destrutivo)

### Regra de merge autorizado pelo dono

Quando o dono do projeto autoriza explicitamente uma mudança (ex: "pode
mergear", "faça o merge", "pode aplicar"), o assistente faz merge **direto
em `develop` E em `main`**, sem abrir PR, na mesma sessão. Ordem: develop
primeiro → main depois. Usar `git merge --no-ff` para preservar histórico
de feature (comportamento equivalente ao "Merge pull request" do GitHub).

Pré-requisitos obrigatórios antes do merge:
- `pnpm check` limpo (typecheck sem erros)
- `pnpm test` 100% verde
- Build do client (`pnpm vite build`) passa quando há mudança em `client/`

Se algum desses falha, NÃO mergeia — reporta o problema e aguarda nova
autorização. A regra é "autorização → merge", não "merge incondicional".

## Padrões e convenções

### Mockup antes de qualquer mudança (regra do dono, 19/08/2026)

Toda e qualquer mudança — tela nova, ajuste de layout, correção que altere
o que o usuário vê — nasce como mockup (skill `mockup-juridflow`) e só vira
código depois do "aprovado" dele. **A entrega é o ARQUIVO HTML auto-contido
(fontes embutidas em base64), não PNG** — o dono abre no navegador dele.
Ele já corrigiu isso uma vez ("pedi mockup EM HTML bem claro"); não repetir.

### Comentários
- Default: NÃO escrever. Só pra "WHY" não-óbvio (workaround, invariant escondido, surpresa pra um leitor futuro)
- Não explicar WHAT (nomes de identificadores fazem isso)
- Não referenciar PR/issue/caller atual ("usado por X", "fix do bug Y") — apodrece

### Painel admin — layout novo (25/08)

- Menu agrupado (Principal/Produto/Sistema), 10 itens. Erros + robô auditor +
  robô de jornada + log de e-mails + auditoria = **abas de `/admin/saude`**
  (AdminSaude, aba "Visão rápida" compõe as queries existentes); Agentes IA +
  JurisIA = abas de `/admin/ia`. Rotas antigas redirecionam com `?aba=` —
  não recriar itens de menu pra elas (teste `admin-layout-novo.test.ts`
  quebra). Badge vermelho no menu = erros unresolved do Sentry (mesma
  query/cache da Visão rápida, staleTime 5min).
- Planos (Financeiro → aba Planos): lista vitrine/fora com toggle `oculto`
  inline, `duplicarPlano` (cópia SEMPRE oculta, slug `-copia[-N]` via
  `gerarSlugCopia`), arrastar → `reordenarPlanos`. Edição em **tela cheia**
  `/admin/planos/:slug` (AdminPlanoEditor, SEM AdminLayout — gate admin
  próprio) com prévia ao vivo que espelha os MESMOS textos do Pricing.tsx
  (o teste trava a sincronia). Aba "Planos" de Configurações (duplicada,
  só leitura) foi removida.

### tRPC procedures
- `protectedProcedure` só checa login. Se a regra é "apenas dono/gestor", adiciona gate explícito (`exigirAdminProcessos`, `requireFinanceiroVer`)
- Cofre tem 2 procedures distintas: `listarMinhas` (admin gate, edição) vs `listarParaSelecao` (qualquer colaborador, dropdown de seleção)
- View mascarada do cofre retorna `apelido` + `usernameMascarado` — **nunca** `customerKey` ou `username` (esses campos não existem na view)

### Módulos contratáveis (Fase 1 — fundação, 23/08)

- Camada POR ESCRITÓRIO (o que o plano contratou), separada da matriz de
  permissões POR CARGO. Porteiro global no `protectedProcedure`
  (`server/_core/gate-modulos.ts`), **fail-open**: só bloqueia quando o
  plano foi resolvido e a lista NÃO inclui o módulo.
- **Router tRPC novo TEM que se declarar** em
  `shared/modulos-contratacao.ts` (namespace → módulo ou `null` pra core) —
  o teste `modulos-contratacao.test.ts` quebra se faltar, de propósito.
- Client: `ModuloGuard` (rota → tela de bloqueio) + itens do menu com campo
  `modulo` no AppLayout. jurisia/juridico ficam FORA do porteiro (gate
  próprio do add-on).
- Migration 0200 gravou a lista completa em todos os planos existentes
  (grandfather) — restringir é decisão do admin no painel, e aí vale.
- **Fase 3 (cobrança por módulo) entregue 24/08**: catálogo de preços por
  módulo (`modulos_catalogo`, seed 0 = "a definir", editável na aba Planos
  do AdminFinanceiro); assentos por plano (`planos.atendentes_inclusos`
  NULL = sem cobrança por assento — grandfather); módulos avulsos por
  escritório (`escritorio_addons` produto `modulo:<slug>`, preço congelado
  na concessão, o porteiro SOMA avulsos vigentes à cesta do plano);
  desconto por escritório (`escritorios.desconto_*`, % ou fixo, validade);
  fatura composta em `shared/fatura-modulos.ts` (UMA função pura, testada
  — preview do painel e valor aplicado nascem dela no SERVIDOR). Card
  "Módulos & cobrança" na ficha do cliente (AdminClients) mostra fatura ×
  valor cobrado no Asaas e só muda a assinatura via botão explícito
  (`aplicarValorAssinatura`, recalcula server-side, nunca aceita valor do
  client).
- **Fase 2 (pacote Acompanhamento Processual) entregue 24/08**: namespaces
  `clientesEssencial`/`prazos`/`painelProcessual` declarados como módulo
  "processos" (é o que os libera num plano sem clientes/agenda), sobre as
  MESMAS tabelas `contatos`/`agendamentos` — contratar o módulo completo
  depois não migra nada. Client: `/clientes` decide completo × essencial
  pelo contrato; `/prazos` (redireciona pra /agenda quando Agenda
  contratada); menu com `soSemModulo` (item enxuto só aparece sem o módulo
  completo); Dashboard vira variante processual quando
  `pacoteProcessualPuro(contrato)` (processos sem
  atendimento/financeiro/kanban/clientes/agenda); Configurações esconde
  abas de módulo não contratado e o resumo diário ganha cadeado no
  WhatsApp sem Atendimento. Criar o plano em si é no painel (aba Planos):
  montar cesta + preço — nada hardcoded.
- **Superlançamento (25/08)**: planos `monitoramento-essencial` (50
  processos + 10 CPFs, 2 usuários) e `monitoramento-profissional` (200+50,
  5, +calculos/relatorios) criados via migration 0203, TODOS sob consulta
  (`planos.preco_sob_consulta` — LP mostra "Sob consulta" + botão wa.me
  usando `config_sistema.whatsapp_comercial`, editável em /admin/settings;
  checkout self-service recusa sob consulta; trial 14d continua vivo).
  Limites de monitoramento SEPARADOS por serviço:
  `max_monitoramentos_processos` (movimentações) ×
  `max_monitoramentos_cpf` (novas ações), enforcement nos dois criar*
  ANTES de cobrar crédito (fail-open: NULL/cortesia/erro nunca barram).
  Antigos free/basico/intermediario ocultos; completo virou "JuridFlow
  Completo" sob consulta com `cta_demonstracao`. WhatsApp comercial
  gravado (25/08, migration 0204): 5585991080343 — wa.me monta o link
  com o valor cru, então SEMPRE em formato internacional (teste trava).
- **Créditos e limites derivam do catálogo (25/08)**: `cotaMensalDoPlano`
  (escritorio-creditos) = creditosCalculosMes + maxMonitoramentosProcessos×2
  + maxMonitoramentosCpf×15 — plano que vende "vigia N" FINANCIA isso em
  créditos (null/0/ilimitado = sem franquia, planos antigos inalterados);
  conta presa com cota 0 se auto-cura no primeiro getSaldo. `plan-limits.ts`
  (colaboradores/clientes/armazenamento/módulos) agora resolve pela tabela
  `planos` (mapa hardcoded virou fallback) — era ele que dava "1 usuário"
  pro plano de 2. Telas do pacote usam `useClientesVinculaveis` (Processos)
  em vez de `clientes.listar` às cegas.

### Permissões
- Matriz em `checkPermission(userId, modulo, ação)` → `{verTodos, verProprios, criar, editar, ...}`
- `verTodos: true` = dono e gestor (e cargos personalizados com flag)
- Gates devem usar `checkPermission`, não hardcode `cargo === "dono"` (cargos personalizados quebram)

### TOTP / otplib

**NUNCA modificar `authenticator.options` global** — é singleton de processo (compartilhado entre cron + validação manual + qualquer caller). O setter faz MERGE em `_options`, e o getter mergeia defaults+options, então "salvar/restaurar opts" deixa `_options.epoch` fixado num `Date.now()` antigo.

Use `authenticator.clone()` quando precisar epoch custom:

```ts
const inst = authenticator.clone();
inst.options = { epoch: agoraMs + delta };
inst.generate(secret); // não vaza pro singleton
```

Detalhes em `server/_core/totp-singleton-guard.test.ts` (regression tests).

### Observabilidade — falhas que somem

Erros em integrações externas (Resend, Sentry) NÃO podem viver só no response. Padrão:
1. Persistir resultado no DB (ex: `convites_colaborador.emailEnviado` + `ultimoErroEmail`)
2. UI mostra estado real (badge vermelho + botão de retry)
3. Auto-cura: quando integração volta a funcionar, status no DB volta pra "ok"

Caso clássico: validação inicial passou → integração quebrou depois → painel admin mostrava "ok" estagnado. Fix em `admin_integracoes.status` + persist em cada chamada.

### Migration safety

- ALTER TABLE ADD COLUMN sempre com default pra cobrir rows antigas non-destrutivamente
- Boolean novo: `DEFAULT FALSE NOT NULL`
- Texto opcional: `DEFAULT NULL`
- Schema em `drizzle/schema.ts` mantido em sincronia (não esquecer)

## Onde mora o quê

- `server/escritorio/router-*.ts` — tRPC routers do app
- `server/_core/` — utilitários compartilhados (logger, tRPC base, totp guards)
- `server/admin/` — painel admin (Sentry, integrações, etc)
- `client/src/pages/` — páginas top-level (Processos, Clientes, Configuracoes, AdminErros)
- `drizzle/schema.ts` + `drizzle/NNNN_*.sql` — schema + migrations
- `scripts/spike-motor-proprio/poc-2-esaj-login/adapters/` — scrapers Playwright (PJe TJCE)
- `shared/` — types compartilhados client/server

## Infra (estado validado — não re-flagrar)

- Uploads (`/app/uploads`): volume Railway `juridflow-volume` montado e
  **validado fim-a-fim em produção** (arquivo sobrevive a redeploy). ⚠ no
  painel = capacidade → Live resize. Detalhes/histórico em
  `docs/setup-volume-railway.md`. Migração S3 planejada (P2 do relatório).
- `/uploads` é servido com auth de sessão + checagem de escritório
  (exceção pública: `/uploads/pareceres/` — capability-URL por design).

## Pendências ativas (19/08/2026)

Lista completa e priorizada em `docs/auditoria-2026-08-18.md`. As quentes:

-1. **Auditoria pré-lançamento (25/08)** — plano aprovado pelo dono em 4
   passos. ① créditos/limites pelo catálogo: **ENTREGUE 25/08**. Faltam:
   ② botão "Ativar assinatura com valor fechado" no admin (hoje NÃO existe
   caminho pra converter trial sob consulta em pagante — só cortesia ou
   Asaas na mão; precisa criar assinatura Asaas com valor negociado +
   persistir `valorNegociadoCentavos` lido pela fatura, senão
   aplicarValorAssinatura "corrige" pra 0); ③ MRR/relatórios saindo do
   PLANS deprecado (plano novo vira R$ 97 fictício em admin.stats/
   receitaMensal), captcha no signup, e-mails/banner de trial sob consulta
   apontando pro wa.me em vez de tela sem checkout, aviso de credencial no
   DashboardProcessual; ④ onboarding processual (gatilho DISPAROU — é a
   campanha; mockup aprovado já existe). Do dono: plano pago do Resend
   (100 e-mails/dia estoura com campanha) + conferir SENTRY_DSN_BACKEND
   no Railway (painel diz "conectado" mas captura é só por env). Ressalva
   de produto: novas ações (CPF/CNPJ) hoje é SÓ TJCE — LP promete sem
   ressalva.

0. **Avisos de spam da Meta (19/08 E 22/08)** — SEGUNDO aviso chegou em
   22/08 (prazo de análise 20/11), três dias após as correções de 19/08
   (opt-out ampliado, opt-in em envio frio manual, executarManual
   sanitizado, bot se identifica). Vetores automáticos conferidos em 23/08:
   SmartFlow gate ok (`exigirOptin: !veioDeMensagem`), lembretes WhatsApp
   nem existem, resumo diário vai só pro dono. Hipótese principal:
   denúncias atrasadas de envios pré-19/08 e/ou conteúdo de disparos com
   opt-in que ainda soa anúncio. Plano: 14 dias SEM disparo frio (WhatsApp
   só reativo/1:1), NÃO clicar "solicitar análise" antes disso; lembrete
   26/08 atualizado (`trig_01Tg9mU9aGhgVWKbC7ShfuHw`). Aguardando do dono:
   print do "Ver detalhes" do aviso 2 + Quality Rating no WhatsApp Manager.
   Aviso 2 é o gatilho descrito pros itens em STAND-BY (tela de evidência
   de conformidade + botão "cliente autorizou WhatsApp") — dono foi
   lembrado em 23/08; segue sem implementar até ele pedir.
   Relatório completo em `docs/auditoria-meta-whatsapp-2026-08-19.md`.
1. **Robô de jornada varre em 32s** — dono já disse que está errado. A
   instrumentação (tempos por tela + "X de 19 mostraram esqueleto") já grava;
   olhar a primeira medição real e agir.
2. **Termos v2 publicados SEM revisão jurídica final (24/08)** — aceite
   versionado entregue: `shared/termos.ts` (TERMOS_VERSAO=2), trilha
   `aceites_termos` (data/hora/IP/versão), TermosGate bloqueante pro DONO
   (colaborador/admin/impersonação não travam), cadastro com botão travado
   + declaração de responsabilidade. Texto novo em /termos e /privacidade
   inclui papéis LGPD (escritório=controlador), indenidade e suboperadores
   de IA (OpenAI/Anthropic — a antiga pendência de listar operadores está
   RESOLVIDA). O teor é minuta técnica: **dono revisa o texto jurídico**;
   mudança relevante no texto = bump em TERMOS_VERSAO (dispara re-aceite).
3. **HMAC da Meta em modo brando** — sem App Secret cadastrado, o webhook
   aceita com warning. Endurecer em produção.
4. **Conferências do robô de jornada** só rodam pelo Playwright — ligar no
   executor do painel. Depois: cron de staging de hora em hora.
5. **CSP desligado** no Helmet; **body-parser 3GB em memória** (OOM) — sai
   junto com a migração S3.

Corrigidos na auditoria (não re-flagrar): lembretes cross-tenant, canais Meta
sem gate, financeiro no customer360 sem permissão, SSRF no webhook do
SmartFlow, deletarColuna sem gate/satélites, credencial "ativa" recusando o
que o motor usa, casca do PJe virando teor (2 variantes + fonte binária).

## Pendências represadas (decisão do dono)

Coisas conscientemente adiadas. **Não reabrir sozinho** — só trazer de volta
quando o gatilho descrito acontecer, e aí lembrar o dono em vez de executar.

### ESLint + eslint-plugin-react-hooks

`pnpm check` é só `tsc --noEmit`, e TypeScript não enxerga ordem de hooks.
O projeto não tem ESLint nenhum. Foi assim que um `useEffect` colocado depois
de um `return` antecipado subiu pra produção e quebrou o editor do SmartFlow
com React #310 — com 3495 testes verdes e build limpo.

Remendo em pé hoje: `server/__tests__/react-hooks-apos-return.test.ts`, uma
varredura de texto sobre os `.tsx` do client. Cobre esse caso específico e
mais nada — não vê hook dentro de `if`/loop, nem dependência faltando, nem
componente em arrow function com formatação fora do padrão da casa.

**Lembrar o dono quando:** (a) aparecer outro erro de React em produção que
o remendo não pegou; (b) alguém encostar em hooks de um jeito que a
heurística não cobre; (c) entrar mais gente mexendo no client. O custo de
adiar não é o bug de hoje, é o próximo — e o motivo do adiamento é que
plugar ESLint agora acusa uma montanha de coisa acumulada de uma vez.

### Nome próprio por bloco no SmartFlow

Blocos não têm nome — o cabeçalho no canvas mostra sempre o rótulo do TIPO,
e `data.label` do nó nem chega a ser gravado (o save manda só
`tipo/config/clienteId/proximoSe`). Por isso o "(cópia)" aprovado no mockup
do duplicar ficou de fora: apareceria e sumiria no primeiro reload.

**Lembrar o dono quando:** ele reclamar de três "ENVIAR MENSAGEM" iguais no
canvas sem saber qual é qual, ou pedir de novo o sufixo da cópia.

### Onboarding guiado do pacote processual (adiado 24/08)

Mockup pronto e aprovável em `mockup-onboarding-processual.html` (4 cenas:
checklist de 3 passos no primeiro login, conectar credencial com cobertura
transparente de tribunais + "avisar quando chegar", primeiro monitoramento
pré-preenchido, estado completo). Dono decidiu NÃO implementar por
enquanto ("Por enquanto não vamos fazer isso"). Hoje quem assina o pacote
processual cai no dashboard processual vazio e se vira.

**Lembrar o dono quando:** ele for ligar a campanha de
verificação/monitoramento de processos (tráfego pago → cadastro
self-service), ou quando contas novas do pacote processual começarem a
chegar e não ativarem (sem credencial/monitoramento no dia 1). Sem o guia,
clique de anúncio tende a morrer na tela vazia — era o atrito nº 1 mapeado
pro funil da campanha.

## Anti-patterns conhecidos

- ❌ `authenticator.options = X` (modifica singleton)
- ❌ Frontend lendo `c.customerKey` ou `c.username` da view do cofre (não existem)
- ❌ Procedure mostrar erro só no response sem persistir
- ❌ Hardcode `cargo === "dono"` (use checkPermission)
- ❌ confirm() nativo do browser pra ações destrutivas (use AlertDialog)
- ❌ Gate admin em procedure usada por dropdown user-level
- ❌ Hook (`useEffect`/`useState`/…) DEPOIS de `return` antecipado no
  componente — a contagem muda entre renders e o React derruba a tela
  (#310). Saída antecipada vai embaixo de todos os hooks; pra economizar
  query use `enabled`, não `return` mais cedo
