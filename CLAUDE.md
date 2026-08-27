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
  (AdminSaude, aba "Visão rápida" compõe as queries existentes); `/admin/ia`
  tem 3 abas: Agentes IA · Base Jurídica (`BaseJuridicaTab`, o bloco RAG que
  morava dentro de AdminAgentesIA) · JurisIA. V2 "que se explica" (26/08,
  aprovada após v1 rejeitada por poluição visual): cada aba abre com
  `ContextoAba` no hub (1 linha + "entenda como funciona" expansível — os
  agentes são DA PLATAFORMA, não dos escritórios), Subir decisão da Base
  virou dialog (`decisaoOpen`), ferramentas técnicas do JurisIA colapsadas
  (`mostrarFerramentas`). Rotas antigas redirecionam com `?aba=` — não
  recriar itens de menu pra elas (teste `admin-layout-novo.test.ts`
  quebra). Badge vermelho no menu = erros unresolved do Sentry (mesma
  query/cache da Visão rápida, staleTime 5min).
- Clientes = funil de remarketing (25/08): 3 cartões "Pra falar hoje"
  (`admin.funilRemarketing` — nunca ativou/teste vencendo/teste vencido,
  regras PURAS em `server/admin/funil-remarketing.ts`, janela 30d, contato
  marcado tira da conta), coluna Situação com motivo comercial (situacao
  calculada no server em `allUsers`), "Marcar contato"
  (`marcarContatoComercial`: users.ultimoContatoComercialEm/Canal
  migration 0207 + nota categoria comercial na ficha), deep-link
  `?funil=`, card violeta "SEM ATIVAÇÃO" na Visão Geral. Filtro do funil
  usa os MESMOS ids que o cartão contou (teste trava). past_due = "ativa"
  (inadimplência tem fluxo próprio, não é remarketing). Cortesia/ativação
  manual CONFIRMA o e-mail do user (26/08, `confirmarEmailPorAcaoAdmin` +
  backfill 0208) — demo com e-mail fictício ficava presa no "confirme seu
  e-mail". "Criar cliente" no painel (26/08, `admin.criarCliente` +
  `CriarClienteDialog`): conta nasce confirmada com escritório, cortesia
  (validade opcional) OU trial (marca jaUsouTrial), senha provisória só no
  client (nunca volta do server), termos NÃO forjados (gate pede no 1º
  login), recusa e-mail duplicado, auditado.
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
   passos. ① créditos/limites pelo catálogo: **ENTREGUE 25/08**.
   ② "Ativar assinatura paga" (valor fechado): **ENTREGUE 25/08** —
   `admin.ativarAssinaturaNegociada` cria a assinatura Asaas com o valor
   negociado (billingType UNDEFINED, link da 1ª cobrança volta pro toast),
   estende o trial +7d como prazo de pagamento (webhook ativa),
   `subscriptions.valor_negociado_centavos` (migration 0205) vira o preço
   do pacote na fatura composta (aplicarValorAssinatura deixa de "corrigir"
   pra 0); e-mails de trial + TrialBanner apontam pro wa.me quando o plano
   é sob consulta. ③ métricas reais + captcha + aviso de credencial:
   **ENTREGUE 25/08** — MRR/receitaMensal/inadimplentes saem do PLANS
   deprecado (tabela planos + valorNegociado; trial/cortesia não são
   receita; stats perdeu planBreakdown); Turnstile no signup (fail-open:
   servidor exige só com TURNSTILE_SECRET_KEY, widget só com
   VITE_TURNSTILE_SITE_KEY no build — dono ainda precisa criar as chaves
   na Cloudflare e colar no Railway). ④ onboarding processual: **ENTREGUE
   25/08** — `GuiaProcessual` no DashboardProcessual (3 passos que abrem
   os fluxos REAIS via deep-link `?novo=1` em cofre/clientes/novas-acoes;
   passo 3 trava sem o 1; some quando credencial+monitoramento existem;
   linha de sucesso via sessionStorage só pra quem acabou de completar —
   substituiu o aviso amber de Cofre vazio); pré-seleção do único cliente
   no dialog de novas ações; "avisar quando chegar" no Cofre grava
   interesse em tribunal fora da cobertura (`interesse_tribunais`,
   migration 0206, `registrarInteresseTribunal`). Amarras em
   `onboarding-processual.test.ts`. E-mail: domínio juridflow.com.br
   VERIFICADO no Resend em 25/08 (DNS na Hostinger, região sa-east-1;
   teste real de "esqueci senha" chegou na inbox — dono confirmou). Dono
   decidiu upgrade do Resend SÓ quando estourar → monitor de limite
   entregue 25/08 (`server/_core/email-limite.ts`, cron horário): amarelo
   aos 80% + vermelho no estouro (card na faixa "Precisa de você" via
   `adminEmailLog.limiteDiario`), e-mail de aviso (tipo
   `alerta_limite_email`, dedup = 1 sucesso/dia UTC — no estouro o aviso
   falha por 429 e sai sozinho quando a cota renova) e reenvio automático
   dos falhados por limite (48h, confirmações primeiro, para no 1º 429).
   Vermelho SÓ com recusa real do Resend (plano pago nunca dispara);
   config `resend_limite_diario` em config_sistema (default 100; "0"
   desliga o amarelo pós-upgrade — sem UI, gravar via SQL quando o dono
   pedir). Amarras em `alerta-limite-email.test.ts`. Do dono: conferir se
   existe FROM_EMAIL no Railway apontando pra endereço errado + conferir
   SENTRY_DSN_BACKEND no Railway (painel diz "conectado" mas captura é
   só por env) + chaves do Turnstile. Ressalva de produto: novas ações
   (CPF/CNPJ) hoje é SÓ TJCE
   — LP promete sem ressalva.

-0.5. **SmartFlow: botão que "não dispara" + follow-up por template (27/08)**
   — caso real do dono (fluxo #TESTE, clique em "Podemos sim" sem efeito).
   Diagnóstico: seta do botão não ligada → `resolverProximo` devolve null e
   o fluxo encerra EM SILÊNCIO. Entregue 27/08: validarGrafo agora dá ERRO
   pra Pergunta com opções sem nenhuma saída e AVISO nomeando botão sem
   seta; walker loga o ramo morto; parseMensagemCloud ganhou case "button"
   (resposta de botão de TEMPLATE — {payload, text}) que antes virava
   "[button]" e nunca retomava o fluxo. Pedir ao dono: reabrir o fluxo,
   conferir a seta do "Podemos sim" e salvar (a validação acusa na hora).
   PRÓXIMO PASSO: bloco "Enviar template" pro follow-up fora da janela de
   24h — mockup `mockup-followup-template.html` entregue 27/08, AGUARDANDO
   aprovação. Desenho: lista templates aprovados do WhatsApp Manager
   (badge Utility/Marketing + status), botões do template viram saídas
   `cond_<payload>` (mesma amarração da Pergunta com opções, retomada já
   funciona com o case novo), variáveis mapeadas, timeout "sem resposta".
   Anti-punição (conta com 2 avisos!): follow-up = categoria UTILITY;
   Marketing só com confirmação extra (Meta limita ~2 marketing/contato/
   dia e denúncia derruba qualidade); 1 follow-up por contato.

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

### Onboarding guiado do pacote processual — ENTREGUE 25/08

Estava represado desde 24/08; o gatilho (campanha) disparou e o dono
aprovou ("pode fazer"). Implementação descrita na pendência -1 item ④.
Métrica pra acompanhar: % de contas da campanha que completam os 3 passos
no dia 1 — é o número que diz se o anúncio vai pagar.

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
