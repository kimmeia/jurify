# JuridFlow — guia rápido para sessões Claude Code

## Comandos essenciais

```bash
pnpm check              # typecheck + lint
pnpm test               # vitest (server/**/*.test.ts) — 4.696 verdes em 03/09/2026 (327 arquivos, ~4 min)
pnpm vitest run <file>  # roda 1 teste específico
pnpm dev                # dev server local
```

## Branches e deploy

- Branch de trabalho: `claude/platform-audit-failures-jbb66j` (a sessão recebe a sua; esta é a de 03/09)
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

### Nunca remover sem autorização expressa (regra do dono, 27/08/2026)

Nenhuma remoção — campo de tela, bloco, procedure, coluna, funcionalidade,
comportamento — sem o dono autorizar EXPRESSAMENTE aquela remoção
específica. "Pode fazer X" autoriza ADICIONAR X, não remover outra coisa
no caminho; refatorar não é licença pra apagar; código "aparentemente
morto" também não sai sem perguntar. Na dúvida, pergunta antes. (Origem:
ele estranhou um suposto sumiço do timeout do Atendente IA — era alarme
falso, mas a regra fica.)

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

### Tela pública não pode depender de rota autenticada (28/08)

Em 10/08 `/uploads` deixou de ser estático e passou a exigir sessão +
tenancy (LGPD). O commit escreveu no comentário "o assinante EXTERNO não
usa este caminho" — **usava**: o botão "Abrir documento para leitura" de
`/assinar/:token` fazia `window.open(doc.documentoUrl)`, e documentoUrl é
`/uploads/assinaturas/escritorio_<id>/...`. O cliente do escritório, que
nunca teve login, levava `{"error":"Não autenticado"}` no celular. No
computador do advogado abria (cookie presente) — **por isso passou 18 dias
sem ninguém ver: quem testa está logado**.

Regras que ficam:
- Fechar rota que já existe = varrer QUEM chama, não afirmar por dedução.
  Comentário não é prova; nesse caso ele documentou a premissa errada.
- Numa tela sem login, campo de resposta do tRPC **não vira destino de
  navegação** — do lado do client é string opaca e ninguém revisa a rota
  que a serve. Sirva por rota com capability própria (o token do link É a
  credencial). Caso legítimo (link externo do cadastro) se declara com o
  marcador `url-do-servidor-ok: <motivo>` na linha de cima.
- Amarras: `pagina-publica-url-autenticada.test.ts` (proveniência, lista
  de páginas públicas DERIVADA do App.tsx — rota pública nova entra
  sozinha), `assinatura-link-publico.test.ts` (contrato da rota por
  token), `superficie-publica-contrato.test.ts`.

Fechamento do assunto (28/08, autorizado item a item pelo dono): documento
cancelado/vencido para de abrir pelo link (`motivoBloqueioPublico` na rota,
403 + `no-store` + HTML legível, **antes** do redirect externo — senão
Google Docs cancelado passava pelo 302); e o payload público perdeu
`documentoUrl`/`documentoAssinadoUrl`, trocados por `temDocumento`
(calculado com os MESMOS helpers da rota, `urlExternaSegura`/`caminhoInterno`
— booleano cru deixaria o botão aparecer pra `mailto:`/`data:`). O mapper do
OPERADOR (`listarPorCliente`) NÃO mudou: o painel segue com os dois campos e
os dois botões, e há teste travando isso.

`assinadoAt` decide ANTES do status no bloqueio, de propósito: assinar não
limpa a validade padrão de 30 dias, então todo assinado fica com
`expiracaoAt` no passado depois de um mês — bloquear por status ou por data
tiraria de quem assinou o acesso ao que assinou. Bug pré-existente corrigido
junto: `visualizarPorToken` expirava QUALQUER status, então reabrir o link no
31º dia gravava "expirado" por cima de "assinado" (o cron sempre teve a
guarda certa; a leitura pública não). Registros já corrompidos continuam
assim — reparo por SQL não foi autorizado, o dono decide.
Amarras conferidas por mutação (quebrar o código e ver o teste ficar
vermelho) — foi assim que se descobriu que a 1ª versão da amarra da guarda
de expiração era vazia.

Compatibilidade de celular que saiu junto: rota por token serve com
Range/ETag (visualizador do iOS pede faixas de bytes antes de renderizar),
`pdfjs` no build **legacy** nas duas telas (o moderno usa
`Promise.withResolvers`, ausente em iOS < 17.4 e Samsung Internet antigo —
biblioteca e worker TÊM que ser da mesma variante, misturar dá
"sendWithPromise null"), e o canvas da assinatura preserva os traços em
resize (teclado do Android apagava a assinatura desenhada).

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

## Auditoria de lançamento (03/09/2026) — LER ANTES DE MEXER EM QUALQUER COISA

Lançamento comercial **10/09**. Relatório em
`docs/auditoria-lancamento-2026-09-03.md` (15 bloqueadores conferidos um a
um no código, P1 agrupado por causa-raiz, ordem proposta pros 7 dias);
lista completa com arquivo:linha, sintoma e fix de cada um dos 237 achados
em `docs/auditoria-lancamento-2026-09-03-achados.md`. **Nada foi corrigido
na auditoria** — valem a regra do mockup e a de nunca remover.

P0 em uma linha cada (detalhe e linhas no relatório):
- **A · cruzamento entre escritórios (8)** — `id` do client usado sem
  `escritorioId`: `crm.enviarMensagem` (grava e ENVIA pelo WhatsApp alheio),
  `iniciarConversa`/`criarConversa` (canalId), `criarLead`/`iniciarChamada`
  (contatoId), `kanban.deletarFunil`, `criarCard`/`editarCard`,
  `permissoes.atualizarCargo`, `assinaturas.excluir`,
  `atendimentoIa.linhaTempoUnificada`. Fix sem tela: amarrar como as
  procedures vizinhas já fazem; teste por mutação em cada uma.
- **B · assinatura do próprio JuridFlow (4)** — trocar de plano cancela a
  paga ANTES de pagar a nova; "Continuar para pagamento" derruba o trial na
  hora; webhook `SUBSCRIPTION_*` ativa sem pagamento; "Começar grátis" e
  cadastro via Google nunca iniciam o trial (**decisão do dono**: plano
  padrão × botão "Testar grátis").
- **C · dinheiro** — taxa do Asaas vira despesa 2× (webhook + cron do extrato).
- **D · admin** — "Excluir conta permanentemente" na Equipe exclui o DONO
  (`AdminClients.tsx:1693` usa `userId` do prop, não `current`).
- **E · Twilio** — "Ligar" liga pro CLIENTE com mensagem de teste
  (**decisão do dono**: esconder o botão é remoção).

Regressão da entrega de 02/09 que entra no P1: o `maskPhoneBR` local do
Atendimento (`Atendimento.tsx:471`) não corta o DDI — deep-link
`?telefone=` com número do cadastro `5585…` preenche `(55) 85997-9657` e o
envio vai pra número inválido. Fix: delegar pra `mascararTelefoneBR` do
shared (atendimento-x1).

**Entregue 03/09 (aprovado item a item pelo dono, mockup
`mockup-correcoes-bloqueadores.html`)**: A (8 amarrações — helpers
`contatoDoEscritorio`/`conversaDoEscritorio`/`canalDoEscritorio` em
router-crm; Kanban carrega o funil ANTES de apagar e valida
coluna/cliente/responsável; cargo, assinatura e linha do tempo da IA
conferem o escritório, cobranças da linha do tempo só com
`financeiro.ver`), B (assinatura: `changePlan` NÃO cancela mais a atual —
quem encerra as anteriores é `encerrarOutrasAssinaturas` no webhook de
PAGAMENTO, poupando cortesia; `createCheckout` no trial mantém `trialing` e
estende `trialExpiraEm` a ≥7 dias como prazo de pagamento, igual ao
"Ativar assinatura negociada"; `statusAposEventoDeAssinatura` faz
SUBSCRIPTION_* nunca promover — row nova nasce `incomplete`; procedures
novas `trialDisponivel`/`trocaPendente`/`desistirTroca`; Plans.tsx ganhou
faixa "troca aguardando pagamento", botão "Testar grátis por N dias" por
plano (decisão do dono: opção 2) e o polling espera a assinatura CERTA
virar active — sem isso a atual, que continua ativa, "confirmava" na
hora), C (extrato pula `PAYMENT_FEE` que já é despesa `taxa_asaas` da
mesma cobrança e grava `cobrancaOriginalId`; o webhook pula quando o extrato
passou antes; `REFUND_REQUEST_FEE` ficou de fora de propósito — o webhook
nunca lança essa taxa, amarrar sumiria com despesa real), D (AdminClients
excluir/retirar créditos usam `current`, diálogo mostra "Conta que será
excluída"). **E (Twilio) em stand-by por decisão do dono.** Amarras:
`tenancy-crm-chamadas`, `kanban-tenancy-funil-card`,
`tenancy-cargo-assinatura-linha-tempo`, `asaas-taxa-sem-duplicata`,
`assinatura-troca-sem-cancelar`, `admin-excluir-conta-alvo` — 58 mutações
conferidas (12+16+9+8+13), todas vermelhas.

Só o dono pode fazer (fora do código): variáveis do Railway — App Secret
da Meta **no painel admin** (Integrações → WhatsApp Cloud) ou em
`META_APP_SECRET_EXTRA` (é isso que alimenta o HMAC do webhook;
`META_APP_SECRET` de env é do Embedded Signup e NÃO vale pro HMAC),
`TURNSTILE_SECRET_KEY`, `SENTRY_DSN_BACKEND`, `RESEND_API_KEY`/`FROM_EMAIL`,
`VAPID_*`, `ENCRYPTION_KEY`/`CANAIS_ENCRYPTION_KEY`, `APP_URL`; quais
eventos de webhook estão ligados na conta Asaas (decide o auth-3); cadastros
nos tribunais + "Testar tudo"; Meta (14 dias sem disparo frio); revisão
jurídica dos Termos v2. Só `JWT_SECRET` e `DATABASE_URL` derrubam o boot se
faltarem — o resto falha em silêncio.

## Fila combinada com o dono (31/08/2026)

Ordem que ele pediu. Não pular sem ele mandar. Estado conferido em 03/09:
A aberto (aguarda o dono escolher), B entregue como F, C parcial (abaixo),
D parado na decisão dele, E/F/G/H entregues.

### A. JurisIA — auditoria feita 31/08, aguardando ele escolher por onde começar

Motor pronto, lado comercial inacabado (~1-2 semanas). O que IMPEDE vender,
conferido linha a linha:
1. **Cobrança cruzada**: `MODULO_JURISIA = "jurisia"` mas a fatura composta só
   soma addon com prefixo `modulo:` (`PRODUTO_MODULO_PREFIXO`) — o preço
   digitado no cartão JurisIA NUNCA entra na fatura; e conceder pelo dialog de
   módulos avulsos cobra e NÃO libera. Corrigir aceitando `modulo:jurisia` no
   gate (some nada) — a alternativa (tirar da lista de avulsos) é remoção e
   precisa de autorização.
2. **Nenhum plano libera hoje**: regra é `modulos.includes("jurisia") &&
   jurisiaMensagensMes > 0`. Planos do superlançamento (0203) nasceram com
   cota 0 E sem o módulo na cesta; os antigos (0200) têm o módulo mas cota 0
   (default de 0172). Só liberação manual funciona.
3. **Não existe como comprar**: zero menção na LP e no Pricing; a tela de
   bloqueio não tem botão nenhum (nem wa.me comercial, que já existe).
4. **`SeletorCaso` usa `clientes.listar`** → nos planos de Monitoramento o
   porteiro recusa e a caixa diz "Nada encontrado" pra qualquer nome. Fix já
   existe no repo: `useClientesVinculaveis` (usado em Processos).
5. Risco jurídico barato: prazos do CPC cravados no prompt sem ressalva de
   Juizado/trabalhista/prazo em dobro; DOCX sai sem aviso de minuta de IA e
   com `[D] [F] [A]` literais; resposta sem acervo tem a mesma cara de
   resposta fundamentada (a base do escritório tem essa guarda, o acervo não).
6. **Zero Sentry no módulo inteiro** — erro da OpenAI vai cru pro advogado e
   fica gravado no histórico dele; e não há visão de consumo/custo (tabela
   `jurisia_uso` não é lida por nenhuma tela).
Decisões pendentes do dono: tirar ou não o "beta"; JurisIA some do menu de
quem não contratou ou vira vitrine; e se o módulo é vendido junto com
Clientes ou ganha "anexar documento" na própria conversa (hoje "ela lê os
documentos do cliente" não se sustenta nos planos vendidos).

### B. Tribunais — cobertura de credenciais (pedido 31/08)

Ele validou vinculação em OUTRO estado (TJMT ok além do TJCE) e quer cobrir
todos. Print do Cofre: 2 validados, 10 com "login falhou". Achado dele que
muda o desenho: **no PJe às vezes o acesso é separado por 1º e 2º grau**, e
tem **Justiça Federal** além da estadual. **→ ENTREGUE como F (01/09)**;
segue com o dono criar os cadastros nos tribunais e rodar "Testar tudo".

### C. Nome do contato no Atendimento (mockup entregue 31/08)

`mockup-nome-contato.html`. Duas coisas: (1) editar o nome inline no
cabeçalho da conversa (lápis no hover, só com permissão `clientes.editar`);
(2) o clique no nome que gira pra sempre. Causa do (2), confirmada:
`clientes.detalhe` devolve `null` em QUATRO casos (sem permissão, contato de
outro escritório, `verProprios` + responsável diferente, banco fora) e
`ClienteDetalhe` faz `if (!cliente) return <spinner>` — "sem permissão" nunca
deixa de ser "sem dado", então gira eternamente. Só a Milena vê porque o
cargo dela é verProprios e o lead não é dela. Fix: separar carregando de
vazio (vale pra tela toda). Decisão do dono em aberto: quem ATENDE a conversa
deveria poder abrir a ficha do contato? (mudar isso mexe na regra de acesso).
**Estado 03/09**: (2) resolvido — `Clientes.tsx:2919` separa carregando de
vazio ("Não foi possível abrir este cadastro", com cadeado) e a decisão de
acesso virou a entrega H; (1) editar o nome inline NÃO foi feito, aguarda o
"pode fazer" dele.

### D. Card "Recebido" do Relatório Comercial — PARADO na decisão do dono (01/09)

Ele puxou 01–15/08 (54.100) + 16–31/08 (29.150) e o mês inteiro deu 102.750.
Causa confirmada: `comercialDashboard` exige que as DUAS datas caiam na janela
— pagamento em `asaasCobrancas.dataPagamento` E cliente com lead
`fechado_ganho` na mesma janela (subquery `contatosFechadosAtual`, usada em 4
queries: KPI topo, período anterior, ranking por atendente, série diária; e de
novo em `detalheAtendenteComercial`). Cliente que fecha 01/08 e paga 20/08 dá
0 na 1ª quinzena (pagamento fora), 0 na 2ª (fechamento fora) e o valor cheio no
mês — os 19.500 que sumiram. O PDF sai certo sozinho: `exportarComercialPdf`
chama as duas procedures por caller.

**Impossível ter as duas coisas**: "só clientes do período" e "as quinzenas
somam o mês" se excluem por aritmética. Âncora possível:
- **pagamento** → soma, mas cliente de abril que pagou em agosto entra em agosto
  (ele recusou: "fechou em agosto e pagou em setembro não conta em setembro");
- **fechamento** (safra) → soma E só clientes do período; o pagamento conta no
  mês do contrato. Custo: o número de um mês fechado continua subindo depois, e
  contraria o exemplo que ele mesmo deu antes (queria o recebimento na quinzena
  em que caiu). Desempate necessário: cobrança é ligada ao CLIENTE, não ao lead
  — cliente com duas ações, uma em cada quinzena, não tem como saber de qual
  contrato veio o pagamento;
- **deixar como está** → nunca soma; só cabe uma nota na tela.

Dono viu as três e não escolheu ("anote isso"). NÃO implementar antes da
escolha. `mockup-relatorio-recebido.html` está na âncora de PAGAMENTO — refazer
na regra escolhida antes de codar.

Verificado de passagem e sem mexer: o lado "Fechado" já conta por
`leads.fechadoEm` (aditivo, e data retroativa do lançamento grava nele);
bordas de dia batem exatas (`fimDoDiaNoFuso` = 23:59:59.999); robô LEA-01 já
acusa lead fechado sem `fechadoEm`. Comissão NÃO aparece nessa tela (grep em
`Relatorios.tsx` = zero) e é do Financeiro — não tocar. Achado solto: o "Funil
de Vendas" da mesma tela conta por `leads.createdAt`, então a barra "Ganho"
pode não bater com o card "Contratos fechados" (o comentário no código afirma
que batem — não batem). Sugestão barata: só rotular a seção, sem mexer no
cálculo. Não autorizado ainda.

### E. Comissão de gestão — ENTREGUE 01/09

Gestor ganha % sobre o RECEBIDO de todos os clientes que fecharam a partir
de uma data de corte, não importa quem vendeu; base é o pagamento, não o
valor fechado (fechou 2.000 em 2x e pagou 1.000 → comissiona 1.000).

O motor era mono-beneficiário: `simularComissao` descarta cobrança já
incluída em fechamento comissionável do escritório, então rodar o gestor
sobre o mesmo pool daria ZERO (o vendedor já consumiu). Daí
`comissoes_fechadas.tipo` ('venda'|'gestao', migration 0211): cada trilha
tem o seu anti-duplicidade e as duas incidem sobre a MESMA cobrança. O
NOT EXISTS da venda ganhou `tipo='venda'` (no-op sobre o acervo, que é
todo de venda); o da gestão é escopado também pelo GESTOR — dois gestores
comissionam a mesma cobrança, o mesmo gestor não repete.

Na gestão a cobrança já comissionada NÃO some da consulta: entra em "ficam
de fora" com o motivo, ao lado de `fechou_antes_do_corte`. Sai do cálculo
sem sair da tela — é assim que o dono confere que a parcela não pagou
duas vezes. Bruto recebido segue somando tudo do período (o card não muda
de significado entre trilhas). Percentual + corte por gestor em
`comissao_gestao` (nova; `regra_comissao` é singleton por escritório);
corte aplicado congela em `dataCorteUsada`. UNIQUE de dedup passou a
incluir `tipo` — gestor que também vende tem os dois fechamentos no mesmo
período. Elegibilidade compara `leads.fechadoEm >= corte` com o cliente
real (COALESCE beneficiário/pagador). Amarras em `comissao-gestao.test.ts`,
conferidas por mutação (8 quebras → 8 vermelhos).

Premissas assumidas, escritas no mockup e ainda não confirmadas por ele:
gestor ganha sobre TODOS os fechamentos do escritório (não por equipe — não
existe hierarquia no banco); categorias não comissionáveis também ficam
fora; base é o valor cheio da cobrança (sem descontar taxa do Asaas), igual
à comissão de venda. Faixas progressivas do escritório NÃO valem na gestão
(sempre flat); valor mínimo e dia de vencimento da despesa continuam os do
escritório. O cron automático segue fechando SÓ a trilha de venda.

Achados registrados e NÃO corrigidos (fora do pedido): `simular` e
`diagnosticar` aceitam `atendenteId` de outro escritório (só enumeração —
as cobranças continuam filtradas por escritorioId; `exportarPdf` valida);
e o "Funil de Vendas" do Relatório Comercial conta por `leads.createdAt`,
então a barra "Ganho" pode não bater com o card "Contratos fechados" da
mesma tela (o comentário no código afirma que batem — não batem).

### F. Cofre por grau + Justiça Federal — ENTREGUE 01/09

Credencial do Cofre passou a ter linha por GRAU (migration 0213,
`cofre_credencial_tribunais.grau` na UNIQUE): no PJe o acesso de 1º e 2º
grau costuma ser cadastro separado. `REGISTRO_G2` (tribunais-pdpj.ts) mapeia
o 2º grau dos tribunais que fogem do padrão (tjrj `/2g/`, tjrn `pje2g.`,
tjpe `/2g/`, tjdf host `dft`, tjpa/tjro sem 2º grau) — o cron JÁ consultava
2º grau e, nesses seis, apontava pra URL genérica e engolia a falha em
silêncio (movimentação de recurso sumia). Grau 2 não mapeado devolve
`semCobertura` e nem tenta logar. Sessão só é salva no grau 1.
Justiça Federal entrou com TRF1/2/3/6 (`pdpjTrfConfig`, padrão
`pje{N}g.trf{N}.jus.br`); TRF4 é eproc (adapter próprio, não feito) e TRF5
segue só consulta pública — os dois ficam FORA do seletor de CPF de
propósito, e há teste travando isso. Erro de login na grade virou resumo
legível (`shared/cofre-erros.ts`, `resumirErroCofre`) com o texto cru dentro
de `<details>`; "Testar tudo" roda a bateria em série.
**Pendente do dono**: criar os cadastros nesses tribunais e rodar "Testar
tudo" — os endereços dos TRFs foram deduzidos do padrão e NÃO puderam ser
conferidos daqui (o proxy do ambiente bloqueia os portais).

### G. Telefone e dados do contato no Atendimento — ENTREGUE 01–02/09

Três entregas encadeadas, todas a partir de print do dono:

1. **Clicar no telefone abre a conversa** (01/09). `caminhoConversaDoEvento`
   (Agenda.tsx) usa `/atendimento?contatoId=` quando há cliente vinculado e
   a rota NOVA `/atendimento?telefone=` quando só há número. Comparação em
   `shared/telefone.ts` (`chaveTelefoneBR` = DDD + 8 dígitos finais) — o
   mesmo número existe gravado como "8597965706", "5585997965706" e com
   máscara. WhatsApp Web não saiu: virou o ícone ao lado.
2. **O compromisso passou a LEVAR os dados** (02/09). Eram duas falhas:
   o diálogo mandava `contatoId` mas não o telefone (a coluna
   `agendamentos.contatoTelefone` só era preenchida à mão na Agenda), e
   `agenda.listar` devolvia `contatoNome` NAS TAREFAS e não nos
   compromissos. Agora o compromisso resolve o nome pelo contato e usa o
   telefone do cadastro como RESERVA (`ag.contatoTelefone ||
   doContato?.telefone`) — **conserta retroativamente** todo compromisso já
   gravado com cliente vinculado, sem migration. O selo do diálogo aparece
   também sem `contatoId` (lead que ainda não é cliente).
3. **Nova Conversa avisa número repetido** (02/09). `crm.conversaPorTelefone`
   (leitura, gate `atendimento/ver`) usa `buscarContatoPorTelefone` — a MESMA
   função do envio, senão o aviso mentiria. Decisão pura em
   `shared/conversa-existente.ts` (`estadoDoNumero`): livre · cadastrado ·
   aberta · encerrada · sem_acesso. **Decisão do dono (02/09): quando a
   conversa é de outro atendente e a pessoa só vê as próprias, AVISAR** —
   mas seco, sem nome, sem histórico e sem botão (o payload não os manda).
   `mascararTelefoneBR` (shared) passou a cortar o DDI antes de formatar:
   colar `5585997965706` virava `(55) 85997-9657` e era ESSE número que ia
   pro envio.

4. **A conversa aberta responde por si** (02/09). Os dados do contato eram
   lidos do array já carregado do Inbox, que é filtrado por período: conversa
   de 13 dias não está lá e o cabeçalho vinha "Contato · Sem atendente" com o
   cliente vinculado o tempo todo. `crm.conversaPorId` (e `conversaDoContato`
   pro deep-link) buscam pelo id; `listarConversas` ganhou filtro `ids` que
   IGNORA período e pasta — quem tem o id está apontando pra conversa e ela
   tem que ser achada onde estiver, inclusive arquivada. verProprios continua
   valendo. Os dois links da Agenda passaram a PERGUNTAR ao servidor e a
   ESPERAR a resposta antes de concluir que não existe conversa: sem isso o
   caminho que existe pra evitar duplicata estava criando uma. Faixa âmbar
   "fora do filtro atual" + "Mostrar na lista" (joga o número na busca, a
   única vista que varre tudo).

Amarras: `agenda-telefone-inbox.test.ts`,
`agendar-conversa-dados-contato.test.ts` (15 mutações conferidas),
`conversa-fora-do-filtro.test.ts` (13 mutações).
Achado NÃO corrigido: o payload do compromisso na tela ganhou nome, mas o
deep-link segue silencioso quando o colaborador não tem permissão no
contato de destino.

### H. Acesso do atendente ao cadastro — ENTREGUE 02/09

Quem ATENDE a conversa passou a poder **ver, editar e transformar em
cliente** (registrarFechamento e definirEstagio) o contato que atende.
Antes ficava trancado: contato de WhatsApp nasce sem responsável, e o acesso
de Clientes só olhava responsável do cadastro OU responsável de um lead.

**O achado que decidiu o desenho** (e que derrubou duas propostas minhas):
`contatos.responsavelId` tem TRÊS usos, não dois — acesso, padrão de
comissão, e **stickiness do atendimento** (`pegarResponsavelDoContato` no
whatsapp-handler: conversa nova de cliente com responsável nasce direto com
ele e NÃO passa pelo rodízio). Por isso a distribuição do SmartFlow recusa
gravar o campo de propósito: gravar grudaria o cliente no primeiro atendente
pra sempre. Não repetir a ideia de "a distribuição adota o contato órfão" —
ela quebra o rodízio e contraria o cenário de nova ação com outro atendente.

Outros fatos conferidos (para não re-investigar): a comissão de venda vem
EXCLUSIVAMENTE de `asaasCobrancas.atendenteId`, congelado no nascimento da
cobrança (`inferirAtendentePorCobranca`: `atendente:N` no externalReference →
senão `contatos.responsavelId` → senão NULL). `reconciliarCobrancasOrfas` só
toca em cobrança órfã e roda quando o responsável muda NA FICHA. Não existe
vínculo cobrança↔lead (só `cobranca_acoes` → processo), então "a ação carrega
quem fechou" não tem onde se apoiar hoje. Cada ação é um lead
`fechado_ganho` com o responsável = quem fechou.

Implementação: helper `atendeConversaDoContato` (só leitura) somado em
QUATRO pontos — `detalhe`, `atualizar`, `registrarFechamento`,
`definirEstagio`. O portão compartilhado `ehResponsavelPeloContato` ficou
INTACTO de propósito: ele alimenta `podeVerCliente`, que gateia 17
procedures, várias destrutivas (apagar arquivo/pasta, excluir cliente). Há
teste contando os 4 usos pra a liberação não escapar. Trocar o responsável
do cadastro continua só de quem vê tudo — é o que impede acesso de virar
redistribuição de comissão. Amarras em `atendente-acessa-cadastro.test.ts`
(12 mutações conferidas).

Resolve de quebra um impasse: `registrarFechamento` exigia ser responsável
pelo contato, então quem fechou a venda não conseguia registrá-la —
registrar era o que criaria o lead que daria o acesso.

**Ficou de fora (decisão do dono pendente)**: arquivos e pastas do cliente
continuam bloqueados pra quem só atende (a aba de documentos vem vazia); e o
cliente não aparece na LISTA de Clientes dela — ela chega nele pela conversa.

## Pendências ativas (19/08/2026)

Lista completa e priorizada em `docs/auditoria-2026-08-18.md` — cada item
de lá tem o estado conferido no código em 03/09 (bloco "Estado em
03/09/2026" no próprio arquivo). Dos abaixo, 1, 3, 4 e 5 seguem abertos;
2 depende só do dono. As quentes:

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
   Bloco "Enviar template" (follow-up fora da janela de 24h): **ENTREGUE
   27/08** (aprovado com a condição "se respeita a documentação da Meta").
   Tipo novo `whatsapp_enviar_template`: reusa o builder do modo template
   do Enviar mensagem (`ConfigWhatsappTemplateBuilder` com `comOpcoes` —
   grava categoria + snapshot dos quick-replies) e o envio
   `enviarTemplateWhatsApp`; payload estável `qr<index>` vai no envio
   (sub_type quick_reply) e volta no clique (case "button" do parse) →
   saídas `cond_qr<N>` + outra_resposta + sem_resposta (timeout default
   1440min); template SEM botão não pausa (saída default). Anti-punição:
   MARKETING recusa envio sem `confirmoMarketing` (checkbox com aviso no
   painel; validação do editor acusa); o guard existente já força
   opt-in (= contato iniciou conversa), honra opt-out, pausa proativo em
   qualidade RED e aplica teto diário/rate limit. validarGrafo cobre o
   bloco (erro sem nenhuma saída com botões; aviso nomeando botão solto;
   ciclo por ele é seguro). Amarras em `smartflow-template-opcoes.test.ts`.

-0.4. **Timeout configurável do Atendente IA — ENTREGUE 27/08** (aprovado
   com DUAS condições do dono: teto de 24h pra ficar dentro da janela do
   WhatsApp, e sem seta ligada = comportamento padrão, só termina).
   Implementação: `ConfigIaAtendente.timeoutMinutos` (clamp 1..1440,
   ausente = 1440); handleIaAtendente trata __resumindoWaitMotivo ===
   "timeout" ANTES de rodar o agente → saída "nao_respondeu" (regressão
   consertada: antes o timeout RE-EXECUTAVA o agente — resposta nova pra
   cliente sumido); painel ganhou seção "Se o cliente sumir" (campo em
   HORAS, max 24) e o nó a saída "não respondeu (Nh)" sempre visível
   (amber, corDaEdge). Amarras em `atendente-timeout.test.ts`. Nada
   removido — acumularSegundos e o resto intactos.

-0.3. **Filtro de período do Inbox pelo INÍCIO do atendimento — ENTREGUE
   27/08** (mockup aprovado). Regra do dono: período conta pelo início do
   ATENDIMENTO — primeira mensagem da conversa; atendimento encerrado
   (resolvido/fechado) + cliente voltou = NOVO início. Implementação:
   coluna `conversas.atendimentoIniciadoEm` (migration 0210 com backfill
   pela 1ª mensagem; set em criarConversa; re-set no whatsapp-handler
   quando entrada chega com statusAtual resolvido/fechado);
   condicoesConversa ganha `modoPeriodo` "inicio" (DEFAULT — compara
   COALESCE(atendimentoIniciadoEm, createdAt)) × "mensagens"
   (comportamento antigo via EXISTS, mantido como opção — nada removido);
   pills contam com o MESMO critério. Tela: seletor "O período conta
   pelo…" no popover, preset "Hoje", tags "iniciado/reaberto" nos cards
   (reaberto = iniciadoEm − createdAt > 60s) e nota âmbar
   `conversasForaDoPeriodo` ("Fulano e +N fora do filtro · mostrar mesmo
   assim" → troca pro modo antigo). Amarras em
   `filtro-inicio-atendimento.test.ts` + `crm-filtro-periodo.test.ts`
   (atualizado pro novo default).

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
   Refinamento do opt-out (27/08, decisão do dono): SAIR continua
   bloqueando disparo frio até VOLTAR, MAS se o contato voltou a escrever
   DEPOIS do SAIR e a última entrada dele no canal tem <24h, ele mesmo
   reabriu a conversa (é a mensagem dele que abre a janela da Meta) — o
   envio proativo do fluxo passa. `optOutVigente` (pura) em
   whatsapp-optout.ts; comparação ESTRITA (a mensagem do próprio SAIR não
   reabre; registro sem data não reabre). Qualidade RED/teto/rate/restrito
   seguem valendo sempre. Amarras em whatsapp-envio-guard.test.ts.
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
