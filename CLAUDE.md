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

### tRPC procedures
- `protectedProcedure` só checa login. Se a regra é "apenas dono/gestor", adiciona gate explícito (`exigirAdminProcessos`, `requireFinanceiroVer`)
- Cofre tem 2 procedures distintas: `listarMinhas` (admin gate, edição) vs `listarParaSelecao` (qualquer colaborador, dropdown de seleção)
- View mascarada do cofre retorna `apelido` + `usernameMascarado` — **nunca** `customerKey` ou `username` (esses campos não existem na view)

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

0. **Aviso de spam da Meta (19/08)** — causas corrigidas e em produção no
   mesmo dia (opt-out ampliado + alerta de intenção, opt-in exigido em envio
   frio manual, executarManual sanitizado, bot se identifica como assistente
   virtual). Conta verificada, zero template rejeitado/recategorizado.
   Lembrete agendado (26/08, trigger `trig_01Tg9mU9aGhgVWKbC7ShfuHw`): se a
   semana rodou limpa, dono clica "solicitar uma análise" (prazo 17/11).
   Em STAND-BY por decisão do dono (19/08): tela de evidência de
   conformidade (mockup enviado) e botão "cliente autorizou WhatsApp" no
   cadastro do contato — não implementar sem ele pedir.
   Relatório completo em `docs/auditoria-meta-whatsapp-2026-08-19.md`.
1. **Robô de jornada varre em 32s** — dono já disse que está errado. A
   instrumentação (tempos por tela + "X de 19 mostraram esqueleto") já grava;
   olhar a primeira medição real e agir.
2. **Política de privacidade sem OpenAI/Anthropic** — o sistema manda teor de
   decisão e conversa de WhatsApp pra IA; LGPD exige listar operadores.
   Texto é jurídico: dono revisa antes de publicar.
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
