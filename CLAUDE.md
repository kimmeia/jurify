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

**Entregue 03/09 (noite), P1 por causa-raiz — aprovado com o mockup
navegável `mockup-correcoes-p1.html`**:
- **Fuso (11)**: servidor — `distribuirLead` decide expediente no fuso do
  escritório; prazo data-só do Kanban é gravado como MEIO-DIA UTC e
  "atrasado" = passou o fim do dia civil no fuso (`corteVencimentoCalendario`
  em `_core/dates.ts`; cron `verificarPrazosKanban` faz um UPDATE por
  fuso); filtro "Criado em", Dashboard/`notificarPrazos` (hora no fuso,
  "vence hoje" por dia civil), `cobrancas-scheduler` ("vencida" só com ≥1
  dia civil de atraso) e `prazosSugeridos.aprovar` (`dataCalendarioNoFuso`).
  Telas — `shared/data-calendario.ts` (`formatarDataCalendario` em UTC,
  `dataLocalHoje` pelas partes locais) aplicado em Movimentações,
  Processos, drawer, Kanban, financeiro (cobrança/despesa) e admin. Fica
  anotado sem mexer: `Processos.tsx` `abrirAprovar` cai em "agora" UTC no
  fallback; `dataEvento` das movimentações segue formatada local.
- **Lembretes (4)**: `criarAgendamento` grava `dispararEm` e destinatário =
  responsável; cron filtra por `colaboradores.id`; `NovoCompromissoDialog`
  desabilita E-mail/WhatsApp com "em breve" (mesmo padrão da Agenda);
  Agenda zera lembretes ao hidratar o form. Resíduo pré-existente: salvar
  a edição antes de `listarLembretes` responder manda lista vazia.
- **DDI (6)**: `telefoneParaWaMe` (shared) nos 3 hrefs da Agenda e na
  assinatura; `maskPhoneBR`/`formatTel` viraram wrappers de
  `mascararTelefoneBR`; contato duplicado corrigido na LEITURA
  (`buscarContatoPorTelefone` casa formas com/sem 55 e com/sem 9) — NÃO na
  gravação, de propósito: normalizar mudaria como o número aparece na
  lista de Clientes (mudança visível sem mockup). `wa.me` à mão que
  ficaram de fora (mesmo bug, fora do pedido): `Atendimento.tsx` popup de
  chamada, `fila-chamadas.tsx`, `Acordos.tsx`.
- **Aviso de clique (26)**: `avisarFalhaSemTratamento` no MutationCache
  (`main.tsx`) — toast só quando a mutation não tem `onError` nem
  `meta.semAvisoGlobal` (só "Esqueci a senha", decisão do dono); texto em
  `shared/mensagem-de-falha.ts`.
Amarras: `fuso-escritorio-servidor`, `fuso-escritorio-crons`,
`data-calendario`, `fuso-telas-usam-helper`, `lembretes-compromisso`,
`lembretes-dialogo-canais`, `telefone-wame`, `contato-telefone-sem-ddi`,
`ddi-telas-usam-helper`, `aviso-global-mutation` — 86 mutações conferidas
(31+22+13+13+7), todas vermelhas.

**Entregue 03/09 (madrugada), mockup `mockup-correcoes-p1b.html` — o dono
aprovou SÓ as abas Kanban e Processos/Cofre ("o resto não entendi"; as
abas Permissões, Admin: planos e Outros seguem aguardando)**:
- **Kanban (5 de 6)**: painel do card manda `""`/`null` e o servidor grava
  vazio (`editarCard` aceita `prazo: null`, normaliza cnj/descrição/tags
  vazios pra NULL); `atrasado` recalculado em `editarCard` (prazo novo) e
  `moverCard` (conclusão = false; coluna normal = pelo prazo, via
  `cardVenceAtrasado`), cron `verificarPrazosKanban` exclui colunas de
  conclusão por subconsulta e o quadro não pinta card concluído; excluir
  coluna: `previaExcluirColuna` conta no SERVIDOR (total/no quadro/
  arquivados, sem filtro, só do escritório) e `deletarColuna` ganhou
  `modo: "arquivar"` — arquiva os do quadro, MOVE todos pra coluna vizinha
  (`colunaVizinha`: anterior, senão seguinte; funil de coluna única →
  PRECONDITION_FAILED) e apaga só a coluna; lixeira do card abre
  AlertDialog Cancelar/Arquivar/Excluir e "Card excluído" tem toast;
  `criarCard` SOMA as tags marcadas às do cadastro (`unirTags`,
  `shared/kanban-tags.ts`) e o form já vem com as tags do cliente escolhido.
  `moverCard` passou a recusar coluna de destino de outro escritório (era
  o kanban-x2, veio junto porque a consulta do tipo da coluna já é
  escopada). **kanban-x1 (prazo em branco vira 15 dias) NÃO foi feito** —
  o dono ainda não escolheu entre A (em branco = sem prazo) e B (rótulo
  "padrão 15 dias" editável no funil); o default continua no `criarCard`.
  Amarras: `kanban-campo-vazio-atraso-coluna-tags`,
  `kanban-atrasado-cron-conclusao`, `kanban-excluir-coluna` (atualizado
  pros textos novos) — 21 mutações conferidas, todas vermelhas.
- **Processos e Cofre (5)**: `criarMonitoramento` busca monitor existente
  (escritório + tipo + `searchKey` mascarado) ANTES do limite e da cobrança
  e devolve `{ jaExistia: true, custoCred: 0, status }` — as 3 mutations da
  tela avisam "já está monitorado — nada foi cobrado" e o botão trava com
  `isPending`; `executarAdvbox` lê `verificarLimiteMonitoramentos` uma vez
  e, a partir da vaga esgotada, NÃO cobra nem insere: linha vai pra `erros`
  com "Limite do plano (N processos vigiados)" e conta em
  `monitoramentosLimitePlano` (card "Fora do limite do plano" no dialog);
  "Cadastrar e testar login" agora testa: `cadastrarMinha` continua só
  inserindo, mas o client encadeia `validarAposCadastroMut` (hook próprio
  de `validarMinha`, com ramificação certa ok/semCobertura/erro — o
  `validarMut` do botão "Validar" ficou intocado, é o processos-4, fora do
  pedido) e os seletores de Novas Ações/Importar aceitam `validando` (o
  servidor da importação também: `inArray(status, ["ativa","validando"])`);
  menu do card de monitoramento usa `pausado` (`status === "pausado" ||
  "paused"`) — Pausar/Reativar nunca apareciam porque testavam
  created/updated/paused do Judit, e `pausarMut`/`reativarMut` ganharam
  onError; `configPorSistema` aceita `pje_trfN` (regex
  `/^pje_((?:tj|trf)[a-z0-9]+)$/`) e `sistemasQueAtendem(tribunal)` =
  [específico se está no REGISTRO, nacional] alimenta `escolherCredencial`
  em `consultarCNJ`/`consultarCNJSincrono` — sem isso a credencial
  `pje_trf1` nunca era escolhida pra processo do TRF1 porque
  `sistemaCofrePorTribunal("trf1")` é a nacional (isso NÃO mudou; o import
  depende). Amarra: `processos-cofre-lancamento` (26 testes) — 14 mutações
  conferidas, todas vermelhas. Dois `expect` de `cofre-multi-tribunal` e
  `monitoramento-credencial` foram atualizados pro literal novo.

**Entregue 04/09 (manhã), Novas Ações separadas por polo — mockup
`mockup-novas-acoes-polo.html`, "pode fazer" do dono (as duas decisões
ficaram na proposta: não identificado CONTA como alerta; polo ativo
aparece na gaveta dele, sem alerta)**. Origem: print dele — ação que o
próprio escritório ajuizou veio como "Novo" + "Polo não identificado",
porque o TJCE escreve a parte como "NOME - CPF: 810… (AUTOR)" numa célula
e o matcher só olhava o campo de documento; "não sei" alerta de
propósito. O que mudou:
- `eventos_processo.poloClienteEvento` (migration 0214, backfill do
  `$.poloDoCliente` do JSON com CASE/JSON_VALID; e `lido=FALSE` pros
  pendentes silenciados SÓ por `polo_ativo`, pra aparecerem na gaveta do
  autor — baseline/pré-cadastro seguem quietos). Cron grava
  `poloCliente` e `lido: !isRelevante && motivoSilencio !== "polo_ativo"`:
  o alerta do autor é barrado pelo POLO, não pelo lido (sino/notif
  continuam só pro relevante).
- `shared/nova-acao-polo.ts`: `GAVETAS` (passivo = passivo+terceiro,
  ativo, desconhecido — terceiro fica com o alerta, como sempre foi),
  `gavetaDoPolo`, `contaComoAlerta`, `documentosNoTexto` (CPF/CNPJ por
  PADRÃO dentro do texto — substring de dígitos casaria CPF dentro de
  CNPJ), `normalizarOab`/`textoMencionaOab`.
- `polo-matcher`: camada 1 também casa o documento escrito dentro do nome
  da parte. A OAB do escritório (`escritorios.oab`) vira
  `capa.advogadoDoEscritorio` → selo "Ajuizada pelo escritório" — só
  informação, NÃO decide polo (inferência que poderia silenciar caso real).
- `listarNovasAcoes` aceita `polo` (gaveta), devolve `poloCliente` e
  `contagemPorPolo` (contado com as condições da caixa, sem a gaveta);
  `totalNaoLidas` exclui `ativo`. `definirPoloNovaAcao({id, polo})`
  grava coluna + JSON (`poloDoCliente`, `capa.poloDoCliente`,
  `poloManual{userId,em}`), escopado por escritório, só `nova_acao`.
- Tela: chips das 3 gavetas (abre no passivo), aviso por gaveta, card lê
  `a.poloCliente` antes da capa/dedução, `ehAlerta = !lido && !ativo`
  (sem "Novo"/borda vermelha no autor), botões Réu/Autor/Terceiro no card
  sem polo (optimistic: sai da gaveta na hora), empty states por gaveta.
Amarras: `novas-acoes-polo-gavetas` (28 testes; caller test do
`definirPoloNovaAcao`), `cron-monitoramento-novas-acoes` (3 `expect`
atualizados: autor entra `lido=false` + `poloCliente="ativo"`),
`novas-acoes-capa` (selo também com polo gravado à mão).

**Entregue 08/09, "Meu plano" no combinado + WhatsApp obrigatório no
cadastro — mockup `mockup-meu-plano-whatsapp.html`, "pode fazer" do dono
com as 4 decisões: toggle Anual some sem preço anual; colaborador
convidado NÃO informa WhatsApp; conta antiga NÃO é cobrada no login;
"Testar grátis 14 dias" do Completo na LP permanece.** Origem: print de um
trial novo mostrando Essencial a R$ 5,00 com "Fazer Downgrade" (checkout
REAL no Asaas), R$ 497,00 no cabeçalho de um plano sob consulta e dois
"Mais escolhido". Essencial/selo eram DADO editado no painel depois da
0203; o cabeçalho e o toggle eram código.
- Migration 0216 devolve o Essencial ao combinado (sob consulta ON,
  popular OFF, preço 0, anual NULL) e deixa popular só no Profissional.
  **Não mexe no preço mensal do Completo (49700 da 0108) de propósito**: a
  fatura composta de quem já assina lê esse número; a tela passou a
  respeitar `precoSobConsulta` (`sobConsultaAtual` no hero → "Sob
  consulta · o valor é fechado na conversa" + botão "Fechar valor com a
  gente" via wa.me comercial).
- Servidor: `exigirPlanoContratavel(planId, interval)` em `createCheckout`
  E `changePlan` (antes só o checkout recusava sob consulta) — recusa sob
  consulta (PRECONDITION_FAILED) e ciclo anual sem preço anual
  (BAD_REQUEST; sem isso cobrava 12× o mensal vendido como "−2 meses");
  `plans` devolve `temPrecoAnual`; `editarPlano`/`criarPlano` com
  `popular=true` zeram os outros (`apagarPopularDosOutros`, `ne(slug)`).
- Plans.tsx: toggle Mensal/Anual só com `temPrecoAnual` (pill mostra a
  economia real, não "−2 meses"); `intervalo` derivado substitui o estado
  cru nas mutations; um só selo (`popularId`); Completo com
  `ctaDemonstracao` = "Agendar demonstração"; setas ↑/↓ nunca no botão de
  conversa.
- WhatsApp: `users.whatsapp` (migration 0215, só dígitos sem DDI —
  `normalizarWhatsappCadastro` em `shared/telefone.ts`: 10/11 dígitos,
  celular exige o 9, corta 55 só com ≥12 dígitos). `auth.signup` exige
  quando NÃO há `conviteToken` (trava no servidor, mensagem
  `MENSAGEM_WHATSAPP_OBRIGATORIO`); `auth.loginGoogle` pra e-mail SEM
  conta devolve `{ precisaWhatsapp: true }` sem criar nada — o form abre
  "Falta só o seu WhatsApp" (número + aceite dos termos) e chama de novo
  com o mesmo idToken; conta nova nasce com número e aceite gravado
  (`aceites_termos` contexto cadastro). Conta existente entra como sempre;
  `conviteToken` pendente pula. `upsertUser` whitelist ganhou `whatsapp`;
  painel admin mostra na ficha (link wa.me), coluna "WhatsApp" na lista e
  botão "Abrir conversa no WhatsApp" no "Marcar contato".
  Fora do pedido, anotado: `admin.criarCliente` não pede WhatsApp (conta
  criada pelo painel fica NULL).
- Review adversarial antes do merge (4 leitores + céticos) pegou e foi
  corrigido: `planoTemPrecoAnual` IGNORA plano sob consulta — o Completo
  ainda carrega `preco_anual_centavos=497000` da seed 0108 e trazia o
  toggle de volta; cada plano tem o SEU ciclo (`cicloDoPlano`: sem anual
  fica no mensal com "só no mensal", senão o card mostrava 12× o mensal e
  o servidor recusava o clique); quem já tem `valorNegociadoCentavos` vê o
  valor fechado no hero, sem botão de fechar de novo (`valorFechado`);
  `conviteEstaPendente` confere o E-MAIL do convite (senão link de outra
  pessoa criava conta Google sem WhatsApp/aceite) e o login Google do
  convidado chama `aceitarConvite` na MESMA requisição (conta de convidado
  não fica solta sem número se a aba cair; a página /convite só confirma);
  sem `maxLength` nos campos (truncava "+55 …" colado antes do corte do
  DDI); Enter duplo no diálogo do Google; migration 0216 também LIGA
  popular no Profissional.
  **Os dois pré-existentes que o review achou foram autorizados e
  corrigidos em seguida ("pode corrigir os 2 itens")**:
  `admin.trocarPlanoAdmin` (painel → ficha → "Trocar plano") passa pela
  MESMA `exigirPlanoContratavel` (sob consulta virava assinatura Asaas de
  R$ 0) e só cancela a assinatura atual DEPOIS de a nova existir no Asaas
  (antes cancelava primeiro — falha do Asaas deixava o cliente sem
  nenhuma); e `admin.criarCliente` exige WhatsApp (mesma regra e mensagem
  do cadastro público; campo "WhatsApp (com DDD) *" no
  `CriarClienteDialog`).
- **Entregue 09/09, "Trocar plano" pelo catálogo — mockup
  `mockup-trocar-plano-catalogo.html`, "pode fazer" do dono com as 3
  decisões da proposta**: (1) a assinatura atual ESPERA o pagamento da
  nova — `trocarPlanoAdmin` NÃO cancela mais nada (nem Asaas, nem banco;
  o texto de 08/09 acima, "só cancela DEPOIS", ficou superado): pagante
  ganha linha `incomplete` e o webhook de pagamento encerra a anterior
  (`encerrarOutrasAssinaturas`), igual ao `changePlan` do cliente; (2)
  `admin.planosAtuais` lê o catálogo (`getAllPlanos`, visíveis primeiro
  por `ordem`, ocultos no fim; `PLANS` só com tabela vazia) e o diálogo
  mostra os ocultos numa dobra "Fora da vitrine" com selo "oculto" —
  escolhíveis, nada some; (3) cliente em teste que troca converte a
  PRÓPRIA linha (planId novo, `trialing`, `trialExpiraEm` = max(atual,
  +7d), `trialConvertido`) — teste em cortesia não é mexido (linha nova).
  `trocarPlanoAdmin` aceita `cpfCnpj` (exigido ANTES do Asaas quando o
  cliente não tem `asaasCustomerId`; o diálogo mostra o campo só nesse
  caso) e devolve `invoiceUrl` (toast "Abrir link", mesmo padrão do
  Ativar). Plano SOB CONSULTA escolhido no diálogo abre valor fechado +
  CPF/CNPJ + ciclo e chama `ativarAssinaturaNegociada({..., planId})`
  ("Fechar valor e trocar"): a procedure ganhou `planId` opcional
  (`planoAlvoSlug`), deixa PAGANTE trocar de plano (linha nova
  `incomplete` com `valorNegociadoCentavos`; mesmo plano continua
  recusado → card Módulos & cobrança) e só cancela assinatura Asaas
  pendurada de NÃO pagante; sem `planId` faz o que sempre fez. Plano
  atual na lista = "(atual)" + botão travado com a dica dos dois
  caminhos. Amarras: `trocar-plano-catalogo` (25 testes; 21 mutações
  vermelhas em `scratchpad/mutar-trocar-plano.py`) + 3º teste do trio em
  `meu-plano-vitrine-sob-consulta` reescrito pra "NÃO cancela" e o
  literal do `externalReference` em `ativar-assinatura-negociada`
  atualizado pra `planoAlvoSlug`.
- **Entregue 09/09 (noite), "Um número, um cadastro" — mockup
  `mockup-reconhecer-cadastro.html`, "Gostei, pode fazer" do dono com as
  4 decisões da proposta.** Origem: print do 131047/131049 do Francisco +
  "salvo um número e quando esse cliente fala ele entra como novo contato".
  Diagnóstico: a LEITURA do WhatsApp já casava com/sem 9/55/máscara
  (03/09); duplicava pelo caminho inverso — `clientes.criar`, Financeiro
  (`criarClienteAsaas`), webhook e adoção do Asaas conferiam só CPF — e a
  conversa ficava presa à ficha magra porque `chatIdExterno` nunca era
  atualizado e o Mesclar era manual. O que mudou:
  - `db-crm`: `condicoesMesmoTelefone` + `buscarContatosPorTelefone`
    (lista, `excetoId`; `buscarContatoPorTelefone` virou wrapper) e
    `TABELAS_VINCULO_CONTATO` (11 pares tabela/coluna que `unificarContatos`
    percorre — a MESMA lista que o Desfazer usa).
  - `server/escritorio/reconhecer-cadastro.ts` (regras puras exportadas):
    `ehFichaMagra` (sem CPF, sem e-mail, lead, sem processo — mesma régua
    do "Vincular"), `escolherSobrevivente` (decisão 3: CPF, empate → mais
    antiga, empate → menor id), `agruparPorTelefone` (`chaveTelefoneBR`),
    `atualizarEnderecoDeResposta` (só JID telefone; @lid não),
    `reconhecerCadastroNaEntrada` (chamado pelo handler via import dinâmico
    em try/catch DEPOIS de resolver conversa/contato e ANTES de salvar a
    mensagem — os testes antigos do handler mockam `db-crm` com objeto
    fixo, por isso módulo à parte), `unificarComRegistro` (fotografa a
    ficha absorvida + ids movidos por tabela + `principalAntes` em
    `contatos_unificacoes`, migration 0218, e só então roda o
    `unificarContatos` de sempre), `desfazerUnificacao` (7 dias =
    `JANELA_DESFAZER_MS`; recria a ficha com o MESMO id, UPDATE por lista
    de ids, restaura email/cpf/observações/secundários da sobrevivente) e
    `unificacaoRecente` (alimenta o aviso da conversa).
  - Procedures: `clientes.verificarTelefone` (≥10 dígitos; devolve a ficha
    que sobreviveria + conversas abertas/atendente), `clientes.criar` com
    `completarContatoId` (UPDATE na ficha existente, exige MESMO telefone,
    responsável só entra se não tinha, vira `cliente`) / `forcarSeparado`
    (sem ele, telefone existente = CONFLICT `[ID:n]`, mesmo formato do CPF
    duplicado), `clientes.possiveisDuplicadosTelefone` +
    `mesclarDuplicados` (permissão `clientes.excluir`, registro manual),
    `crm.unificarContatos` passou a registrar (desfazível),
    `crm.unificacaoRecente`/`crm.desfazerUnificacao`;
    `asaas.criarClienteAsaas` com `usarContatoId`/`forcarSeparado` e
    telefone como 2ª chave; webhook `CUSTOMER_CREATED` e
    `asaas-adocao-orfas` caem no telefone quando o CPF não bate.
    `enviarMensagem` (resposta manual) conta a janela de 24h por cliente ×
    canal (`ultimaEntradaDoContatoNoCanal`), como o "Nova conversa".
    `listarConversas` devolve `contatoCadastroCompleto` (booleano — nunca o
    CPF) e `contatoOrigem`.
  - Telas: `NovoClienteDialog` (Clientes) e o do Financeiro ganharam o card
    "Este WhatsApp já está em um cadastro" (debounce 400ms) com "Completar
    esse cadastro"/"Usar esse cadastro" × "Criar separado" (lembrado por
    número; Cadastrar travado enquanto espera a escolha — decisão 1);
    Atendimento: selo "✓ cadastro reconhecido"/"contato do WhatsApp",
    aviso "Duas fichas com este número foram unificadas" com Abrir
    cadastro/Desfazer (`crm.unificacaoRecente`), telefone via
    `mascararTelefoneBR` (decisão 4 — só exibição; o gravado não muda);
    Clientes: lista e ficha com `mascararTelefoneBR`, botão "Possíveis
    duplicados (N)" (`clientes/possiveis-duplicados.tsx`, só aparece com
    permissão e grupos).
  - **Vincular a cliente NÃO mudou** (segue `unificarContatos` direto, sem
    registro — o teste `crm-vincular-conversa` usa banco falso sem
    `execute`). Importação de processos e "clientes essencial" não têm
    telefone: ficam fora por natureza. Instagram/Facebook idem.
  Amarras: `um-numero-um-cadastro` (33) + `um-numero-handler` (4) — 26
  mutações vermelhas (`scratchpad/mutar-um-numero.py`; a de "@lid vira
  endereço" é mutante equivalente: `isLidJid` e o regex de JID-telefone
  barram os dois, de propósito).
- **Entregue 09/09 (madrugada), Conferência de cadastros — mockup
  `mockup-conferencia-cadastros.html`, "aprovado, pode fazer" do dono com
  as 4 decisões da proposta** (CPFs diferentes travam; "Não é duplicado"
  existe e é reversível; página própria em Clientes; planilha com CPF
  inteiro). Origem: "quero verificar quantos contatos duplicados, dados
  divergentes e etc. — o botão possíveis duplicados não gera o relatório
  para conferência". Achado do estudo: o `unificarContatos` nunca teve
  trava pra duas fichas com CPFs diferentes (descartava o CPF da absorvida
  em silêncio) e não existia jeito de dizer "são pessoas diferentes".
  - **Um cálculo, três saídas**: `server/escritorio/conferencia-cadastros.ts`
    — `carregarBaseConferencia` (fichas + contagens por ESCRITÓRIO + nomes
    dos responsáveis + ignorados) e `montarConferencia` PURA (grupos por
    telefone via `agruparPorTelefone`, por CPF pelos dígitos, cruzamento
    `tambemNoTelefone`, divergências, `faltasDasFichas`, resumo).
    `conferenciaParaTela` mascara o CPF e troca a chave do grupo de CPF por
    `cpf-<sobrevivente>` (a chave É o CPF — nunca sobe pro client; por isso
    `marcarNaoDuplicado`/`desmarcarNaoDuplicado` recebem `contatoId` e
    `chaveDoNaoDuplicado` resolve no servidor, escopado). Planilha
    `gerarConferenciaCsv` (`;` + BOM, 16 colunas, telefone e CPF como
    gravados, divergências separadas por VÍRGULA dentro da célula — o
    mockup escrevia "17 colunas" e "ponto-e-vírgula": contagem errada e
    conflito com o separador, ajustados); PDF em `conferencia-pdf.ts` (só
    Helvetica: sem emoji/seta, o pdfkit imprime lixo).
  - Regras em `shared/conferencia-cadastros.ts`: divergência = campo
    PREENCHIDO nos dois lados com valores diferentes (cpf, nome, email,
    responsavel; `telefone` só no grupo de CPF); `nomesCompativeis` = o
    nome curto cabe no longo, na ordem, por prefixo ("Maria C." em "Maria
    Clara", "Fran" em "Francisco"); `nomeIncompleto` é chip cinza, não
    divergência; `telefoneInvalido` (DDD da lista `DDDS_BR`, 11 dígitos
    exige o 9, DDI estrangeiro = inválido, vazio NÃO é inválido);
    `mascararCpfCnpj`; `classeDoGrupo` (cpfs_diferentes > com_divergencia >
    so_falta) e `grupoPassaNoFiltro`.
  - `possiveisDuplicadosTelefone` passou a ler a MESMA conferência (mesmos
    grupos, mesmos ignorados — o "(N)" do botão é o N do card; teste trava)
    e devolve `cpfsDiferentes`; `mesclarDuplicados` ganhou a trava: par com
    dois CPFs preenchidos e diferentes vira falha `MENSAGEM_CPFS_DIFERENTES`
    sem mesclar, salvo `confirmarCpfDiferente: true` (a tela pede
    confirmação nomeando o CPF descartado; "Mesclar todos" pula esses — no
    diálogo antigo E na página). `crm.unificarContatos` (Mesclar da
    ficha/Vincular) NÃO ganhou a trava: não foi pedido.
  - `contatos_nao_duplicados` (migration 0219, UNIQUE escritório+tipo+chave,
    entra no backup). `listar` ganhou `conferencia: <falta>` (mesmos ids de
    `faltasDasFichas`; categoria vazia = `1 = 0`, não a base inteira);
    Clientes lê `?conferencia=` da URL, mostra chip "Conferência: …" e o
    "limpar tudo" apaga junto.
  - Tela `client/src/pages/clientes/ConferenciaCadastros.tsx` em
    `/clientes/conferencia` (rota ANTES de `/clientes` no App.tsx; cai no
    módulo clientes por prefixo). Botão "Conferência de cadastros" no
    cabeçalho de Clientes só com `podeExcluirCliente`; a página, o Mesclar,
    o "Não é duplicado" e os arquivos exigem `clientes.excluir`. 6 cards, 4
    abas (Mesmo telefone · Mesmo CPF · Faltando ou inválido · Não é
    duplicado), filtros, 20 por página, célula divergente em amarelo (CPF
    em vermelho), "Mesclar todos os 'só falta preencher'" em lotes de 50
    com AlertDialog. "Duplicatas (PDF)" e "Possíveis duplicados" continuam.
  Amarras: `conferencia-cadastros` (37 testes) — 28 mutações vermelhas
  (`scratchpad/mutar-conferencia.py`); `um-numero-um-cadastro` ajustado
  (a trava consulta os CPFs antes de cada par).
  - **Ajustes de 09/09 à noite, depois de o dono testar em produção
    ("pode fazer" + "vamos consertar")**: origem `manual` virou rótulo
    "Cadastro manual" na página, no diálogo Possíveis duplicados e no PDF
    ("Clientes" ao lado de "Lead" lia como se a pessoa fosse cliente); o PDF
    quebrava nome/e-mail/origem em 2 linhas dentro da coluna mas avançava
    altura fixa — agora a linha da tabela mede `heightOfString` de cada
    célula (máx. 3 linhas, `ellipsis`) e avança pela maior; a planilha leva
    a HORA em `cadastrado_em` (fuso de Brasília) — quatro fichas iguais no
    mesmo minuto = clique repetido. Conferência visual do PDF: renderizado
    com pdfjs no Playwright (`scratchpad/pdfview/`: `gerar.mts` via tsx +
    `python3 -m http.server` + `shot.mjs`), não a olho.
    **Caso Tirzah (4 fichas iguais, lead, manual, sem responsável, mesmo
    dia)**: o único caminho que cria lead + origem manual + sem
    responsável é o "Novo Lead"/"Novo Contato" do Atendimento
    (`crm.criarContato` → `criarOuReutilizarContato`). Em junho a
    reutilização por telefone comparava só a forma canônica com `eq`, e
    esses diálogos gravam o número COMO DIGITADO ("(85) 8811-1508") —
    nunca casava, cada "Adicionar" criava ficha nova ("Tirza" com o 9 e
    "Tirzah" sem o 9 é o mesmo número escrito de dois jeitos). Fechado em
    03/09 (`buscarContatoPorTelefone` com REPLACE da máscara, com/sem 9 e
    55); hoje o mesmo diálogo reaproveita a ficha.
  - **Ficha presa na anterior ao trocar na lista lateral (dono, 09/09:
    "intermitente, vale olhar")** — print com cabeçalho "Tirza" e o
    formulário com "Tirzah". Cabeçalho e `EditarForm` leem o MESMO
    `clientes.detalhe`, o form já é recriado por `key={cliente.id}` desde
    10/08, `main.tsx` não tem `placeholderData`, e não há `setData` na
    chave — o mecanismo da corrida NÃO foi reproduzido. Blindagem em duas
    camadas (`ficha-troca-na-lista.test.ts`): `ClienteDetalhe` só usa o
    registro cujo `id === id` pedido (outro id = esqueleto,
    `registroDeOutroId`), e `EditarForm` re-hidrata todos os campos em
    `[cliente.id, cliente.updatedAt]` (`camposExtrasDe` extraído). Se
    voltar a acontecer, o próximo passo é gravar no Sentry o par
    (id pedido, id recebido) no momento do esqueleto.
  - **Entregue 10/09, "Mesclar com outro cliente" da ficha — mockup
    `mockup-mesclar-cpf-diferente.html`, "pode fazer" do dono.** Duas coisas
    no mesmo diálogo. (1) Ele prometia "operação definitiva" e "não há como
    desfazer": falso desde 09/09, porque o Mesclar manual passa por
    `unificarComRegistro` e fica desfazível por 7 dias — os dois textos
    passaram a dizer o prazo real, e o comentário do componente (que
    documentava a premissa velha, "rollback no futuro precisaria de
    migration") foi corrigido junto. (2) `unificarContatos` só copia o CPF
    quando o principal está VAZIO (db-crm), então duas fichas com CPF
    diferente mesclavam caladas e o da absorvida sumia: `cpfsConflitam`
    (shared, dois lados preenchidos e dígitos diferentes — máscara não
    conta) alimenta a trava em `crm.unificarContatos`
    (PRECONDITION_FAILED + `MENSAGEM_CPFS_DIFERENTES`, escapa com
    `confirmarCpfDiferente`, consulta escopada por escritório) e a tela:
    selo "CPF diferente" por candidato, aviso âmbar nomeando quem fica e
    quem é descartado, botão que vira "Mesclar mesmo assim" e o CPF
    descartado escrito na confirmação final. `mesclarDuplicados` da
    Conferência passou a usar o MESMO helper (era cópia local da conta —
    comportamento idêntico, teste antigo confirma). **"Vincular a cliente"
    NÃO ganhou a trava**, de propósito: chama `unificarContatos` do db-crm
    direto e não foi pedido; há teste travando isso.
    O aviso com **Desfazer** passou a aparecer também na ficha do cliente
    (`crm.unificacaoRecente`/`desfazerUnificacao`, hooks ANTES da saída
    antecipada) — só existia no Atendimento, e quem mescla pela ficha sem
    conversa de WhatsApp não achava a saída que o texto novo promete; o
    aviso do Atendimento ficou intacto. Amarra:
    `mesclar-cpf-diferente` (25 testes) — 27 mutações vermelhas
    (`scratchpad/mutar-mesclar-cpf.py`; uma delas MOVE o hook para depois
    do `return` antecipado, o React #310 que o remendo de hooks não pega).
  - **Escolher campo a campo o que fica ao mesclar — proposta entregue
    10/09 (`mockup-mesclar-escolher-campos.html`), AGUARDANDO decisão.**
    Ideia do dono ("quando dados divergentes, poder escolher quais serão
    mesclados"). O estudo mapeou a regra silenciosa de hoje: telefone do
    absorvido vira secundário (não perde); e-mail/CPF/observações só
    entram se o principal estiver vazio; nome e responsável nunca mudam;
    tags, endereço e campos extras nunca entram. Proposta: passo entre
    escolher a ficha e confirmar, só quando os dois lados têm valor
    diferente, com o padrão já marcado no que o sistema faria sozinho, e a
    ficha final escrita antes de confirmar. **Cuidado achado**: o
    `principalAntes` do registro só guarda 4 campos (email, cpfCnpj,
    observacoes, telefonesSecundarios), então trocar nome/responsável/tags
    exige guardar esses também, senão o Desfazer devolve a ficha absorvida
    e deixa a sobrevivente com o nome trocado (cabe no JSON que já existe,
    sem migration). Duas decisões pendentes: a escolha vale também no
    Mesclar um-a-um da Conferência? e o responsável entra na lista (mexe
    no padrão de comissão e no rodízio do atendimento)?
- **Entregue 10/09 (URGENTE do dono): o robô falava por cima do atendente.**
  Print dele: mensagens do atendente às 10:12 e uma do bot às 10:15, com a
  conversa marcada "Em atendimento · Bot pausado". "Bot pausado" não é flag
  próprio — é `conversas.status === "em_atendimento"`. Havia duas portas
  conferindo isso, e **as duas são movidas por mensagem do cliente**:
  `dispararMensagemCanal` no topo e o laço de envio do whatsapp-handler
  (que re-checa antes de cada resposta). A terceira porta é movida pelo
  RELÓGIO e não conferia nada: `retomarExecucao` (scheduler, timeout do
  `whatsapp_aguardar_resposta` ou `esperar` vencido). Nessa retomada o
  engine marca `__retomadaPorTimeout`, o que zera `temCanal` e faz o texto
  sair DIRETO pelo canal (`exec.enviarWhatsApp`, proativo) em vez de voltar
  como `resposta` pro handler — pulando as duas travas. Era esse o caminho
  do print. Fix: `retomarExecucao` lê a conversa da execução (escopada por
  escritório) e, se estiver `em_atendimento`, **cancela a execução**
  (`status: "cancelado"`, erro "Atendente assumiu a conversa") sem rodar
  cenário nenhum. A conferência fica DEPOIS do claim atômico de propósito:
  antes dele a execução ficaria com `retomarEm` no passado e o ciclo
  tentaria de novo pra sempre; cancelada, ela sai da fila (o scheduler só
  busca `rodando`). Execução SEM conversa (lembrete de cobrança,
  agendamento) não é afetada. Amarra: `bot-pausado-retomada` (9 testes) —
  9 mutações vermelhas (`scratchpad/mutar-bot-pausado.py`; duas delas só
  ficaram vermelhas depois de ancorar a busca, porque o trecho aparece
  mais de uma vez no dispatcher e o mutante caía no guard vizinho).
  **Achados NÃO corrigidos (fora do pedido, decisão do dono)**: (a)
  `enviarWhatsApp` do executor não confere conversa nenhuma — disparo
  proativo de verdade (pagamento vencido, lembrete de agendamento) ainda
  entra numa conversa que o atendente está tocando; (b) dentro de
  `enviarResposta` as bolhas da mesma resposta não re-checam o status
  entre si (janela de segundos); (c) conversa `resolvido`/`fechado` NÃO
  barra a retomada — só `em_atendimento`, que é o que o dono relatou.
  E fica registrado que a correção **encerra** o fluxo: reativar o bot
  depois não retoma de onde parou.
  Conferido de passagem: `retomarExecucao` só é chamada pelo scheduler, e
  execução com `conversaId` só nasce em `dispararMensagemCanal` (os fluxos
  de cobrança não passam por lá) — a trava não alcança lembrete nenhum.
- **09/09, autorizado ("pode corrigir também")**: `metricasChurn` (LTV/
  ARPU da Visão Geral) deixou de somar o `PLANS` fixo (R$ 497 por
  "completo" sob consulta) — agrega no banco com a MESMA regra do
  `receitaMensal`: `COALESCE(valorNegociadoCentavos, planos.preco)`, só
  ativas sem cortesia. Ainda leem `PLANS` (não autorizado): `criarCupom`
  (valida `planosIds` contra a lista fixa → recusa slugs novos),
  `health.plansCount`, `db.ts` getPlanName/getPlanPrice e o limite legado
  de créditos em `getUserCreditsInfo` (`planosAtuais` saiu da lista em
  09/09 — lê o catálogo).
- **Decisões do dono 09/09**: plano sob consulta é SÓ venda consultiva
  (cliente nunca escolhe); pediu um pacote NOVO de 3 planos com
  Atendimento em todos contra Advbox/Astrea — proposta
  `mockup-pacote-3-planos.html`, revisada a pedido dele ("vamos baratear
  mais, aumente os processos, inicial em 147") e **aprovada ("pode
  fazer") na v2**. Sites dos concorrentes bloqueados daqui: os números
  deles vieram de buscas de 09/09 (Advbox Essencial R$ 220 + taxa, Banca
  Jurídica R$ 800, Elite R$ 1.800; Astrea Up R$ 209/2 usuários/150
  processos, Smart R$ 379/5/500, Company R$ 689, VIP R$ 1.249) — conferir
  antes de publicar.
- **Entregue 09/09, migration 0217 `pacote_3_planos`**: `atende`
  (R$ 147, 2 usuários, 1 WhatsApp, 1 IA, 300 processos, 15 CPFs, 20
  cálculos, 2 GB), `escritorio` (R$ 297, 5, 2, 3, 1.000, 50, 100, 10 GB,
  + financeiro/contratos/smartflow/relatorios, ÚNICO `popular`), `escala`
  (R$ 597, 15, 5, 10, 2.500, 150, 300, 50 GB, + comissoes/ponto/backups/
  jurisia com 200 msgs). Anual = 10× (toggle da tela volta com economia
  real), `trial_dias` 14, `preco_sob_consulta` FALSE → checkout
  self-service funciona nos três. `monitoramento-essencial`/`profissional`
  viram `oculto` (quem está em teste continua); `completo` vira "Sob
  medida" (sob consulta + demonstração, ordem 4, preço mensal NÃO tocado).
  Cartões citam "novas ações: TJCE por enquanto" (decisão 4). **Sem
  mecanismo, ficou pendente**: extras avulsos (usuário R$ 29, +100
  processos R$ 29, número extra R$ 49) — `max_usuarios` trava
  colaboradores e não existe limite por escritório pra processos/números;
  `atendentes_inclusos` ficou NULL de propósito (assento não cobra). LP:
  o texto "Superlançamento" do Pricing.tsx não mudou (mockup próprio se
  ele pedir). Amarra: `pacote-3-planos` (11 testes, 6 mutações vermelhas).
Amarras: `meu-plano-vitrine-sob-consulta` (21) e
`cadastro-whatsapp-obrigatorio` (20) — 44 mutações conferidas, todas
vermelhas (`scratchpad/mutar-plano-whatsapp.py`).
- **Entregue 09/09 (noite), Relatório Comercial: funil 20 × 18, leads por
  canal e recebido por origem — mockup navegável
  `mockup-relatorio-comercial-funil-origem.html` (revisado por 5 céticos do
  diagnóstico + 4 críticos do HTML), "tudo no mockup aprovado" do dono.**
  Origem: print dele (card Contratos fechados 20 × barra Ganho 18; "Contatos
  por canal" 28+11 que não batia com nada; pediu o pago por origem).
  - Funil em dois blocos (`montarEtapasFunil`): etapas abertas por
    `createdAt` (quem ENTROU), Ganho/Perdido por `fechadoEm` (quem foi
    DECIDIDO — a data do card) + `funilResumo` (entraram total/emAberto/
    jaDecididos; por decisão "N entraram no período · N antes"). Os dois
    comentários que afirmavam que card e funil batiam foram corrigidos.
  - "Contatos por canal" (cadastros com whitelist `ORIGENS_LEAD` + lead no
    período) virou `leadsPorCanal`: os MESMOS leads do funil pelo
    `contatos.origem`, qualquer canal (`asaas` ganhou rótulo). A soma é o
    total do funil. `ORIGENS_LEAD` só sobrevive na procedure `comercial`,
    que não tem consumidor no client. Por que "Manual" engorda: Novo
    Cliente, Novo cliente do Financeiro, Novo lead do Atendimento,
    importação e Clientes essencial gravam `manual`, e o canal nunca é
    corrigido depois; mensagem de canal Instagram/Facebook grava
    `whatsapp` — conserto é no cadastro (não pedido).
  - Fechamentos por origem com recebido: `atribuirRecebidoAosFechamentos`
    distribui as MESMAS cobranças do card Recebido (filtros idênticos ao
    `agg`) pelo fechamento do cliente — dia civil no fuso (`dataHojeBR`),
    o mais recente ≤ dia do pagamento, mesmo dia conta, empate → menor id,
    antes de todos → o primeiro, busca entre TODOS os fechamentos do
    cliente no período (não só os do filtro — senão a atribuição mudaria
    com o filtro). Cada cobrança entra UMA vez: Σ origens = card Recebido.
    Balde `ORIGEM_SEM_OU_FORA_DO_FILTRO` junta fechamento sem origem (antes
    sumia do card) e pagamento cujo fechamento está fora do setor/atendente
    filtrado — este só com cliente e recebido (verProprios não vê
    fechamento alheio). `chaveOrigem` junta "Google"/"google" (rótulo = a
    grafia do fechamento mais recente; `origemLead` é texto no lead, o
    catálogo só alimenta a lista — renomear no catálogo não mexe nos
    antigos). Situação pago/parcial/nada É NO PERÍODO (a pendência das
    quinzenas do card Recebido segue aberta; se mudar lá, muda aqui junto).
    `mesmoCliente` marca cliente com N fechamentos listados.
  - PDF segue o payload (`funilResumo` opcional, tabela Canal/Leads/%,
    subtabelas com Recebido/Situação, nota de metodologia). A aba Comercial
    NÃO tem botão de e-mail/programar (o servidor aceita; sem UI).
  Amarras: `relatorio-comercial-funil-canal-origem` (19) — 17 mutações
  vermelhas (`scratchpad/mutar-relatorio-comercial.py`);
  `relatorios-fechamentos-origem` e a fixture do PDF atualizadas.
- **Entregue 09/09 (noite), controle de contratos cancelados — mockup
  `mockup-cancelados-contrato.html`, "pode fazer" do dono com as 5 decisões
  da proposta** (cancelado CONTINUA em "Contratos fechados" do mês em que
  fechou, com linha "N cancelado(s) depois"; lista fixa de motivos;
  diálogo oferece "encerrar também o serviço" marcado; arrastar Ganho →
  Perdido no Pipeline pergunta "cancelado ou perdido?"; "Lançado por
  engano" fica gravado mas FORA de card/barra/lista — engano não é churn).
  Antes só existia Perdido (que mantém o `fechadoEm` original) ou excluir.
  - Modelo: o lead segue `fechado_ganho` (nenhuma contagem de "fechados"
    muda) + 4 colunas aditivas em `leads` (migration 0220 — nasceu 0219 e
    foi renumerada no merge porque a conferência de cadastros já tinha
    publicado a 0219; o executor distingue pelo nome do arquivo, então a
    renumeração é só convenção:
    `canceladoEmLead`, `motivoCancelamentoLead`, `detalheCancelamentoLead`,
    `canceladoPorLead`; no schema `canceladoEm`/`motivoCancelamento`/
    `detalheCancelamento`/`canceladoPor`). `shared/cancelamento-contrato.ts`:
    `MOTIVOS_CANCELAMENTO` (desistencia · inadimplencia · outro_escritorio ·
    sem_retorno · engano · outro), `contaComoCancelamento`,
    `contratoCancelado`, `descricaoCancelamento`, `motivoServicoAoCancelar`.
  - `server/escritorio/cancelar-contrato.ts`: `cancelarContrato` (só Ganho
    do escritório, não cancelado; data ≤ hoje e ≥ dia do fechamento, gravada
    como MEIO-DIA local — mesmo idioma das datas-só; `encerrarServico` grava
    `contatos.situacaoServico=cancelado` com a MESMA data e motivo
    "Contrato cancelado: <motivo>"), `reativarContrato` (limpa os 4
    campos), `cancelarContratosDoContato` (Ganho ainda abertos do contato —
    `isNull(canceladoEm)`, senão sobrescreveria cancelamento antigo).
    Procedures `crm.cancelarContrato`/`crm.reativarContrato` (permissão
    `pipeline.editar` com fallback kanban, auditoria `lead.cancelar_contrato`
    / `lead.reativar_contrato`); `clientes.encerrarServico` aceita
    `cancelarContratos` (só tipo cancelado/rescindido) e devolve quantos
    cancelou; `listarLeads` (crm e clientes) devolve os campos +
    `canceladoPorNome`.
  - Relatório (`comercialDashboard`): `cancelamentoConta` = canceladoEm
    preenchido E motivo ≠ engano; card Cancelados por `canceladoEm` no
    período (+ período anterior/variação, `canceladosFecharamNoPeriodo`),
    card Contratos fechados ganha `contratosFechadosCanceladosDepois`/
    `valorFechadosCanceladosDepois` (sem tirar do total); funil ganha o 3º
    bloco `cancelado` (`montarEtapasFunil(entraram, decididos, cancelados)`
    → `funilResumo.cancelados` {total, valor, fecharamNoPeriodo,
    fecharamAntes}); origem: fechamento cancelado fica na origem dele com a
    marca (`cancelados` do grupo não conta engano); `contratosCancelados`
    (lista) com `recebidoAntes` = `recebidoAntesDeCancelar` (cobranças até
    o dia do cancelamento, atribuídas entre TODOS os fechamentos do cliente
    com a mesma regra do recebido por origem). Dashboard geral: `cancelados`
    no `desempenhoComercial`. PDF: 5º cartão, 3º bloco do funil, "Cancelado"
    na Situação, seção "Contratos cancelados no período", nota de método.
    Os cartões do PDF passaram a MEDIR antes de desenhar (fonte encolhe até
    caber, sub2/rodapé quebram em 2 linhas, altura = maior cartão) — com 5
    colunas o texto invadia a linha de baixo; e o cabeçalho do PDF tinha
    a 2ª linha (Atendente/Emitido em) desenhada em cima da 1ª desde sempre
    (`y + 21 - 4`) — corrigido de passagem (caixa 48pt, 2ª linha em +26).
  - Telas: `atendimento/cancelar-contrato-dialog.tsx`
    (`CancelarContratoDialog` data/motivo/detalhe/encerrar serviço;
    `CanceladoOuPerdidoDialog`); Pipeline: coluna recolhida "Cancelados"
    (mês atual), card com faixa, gaveta com "Cancelar contrato" ×
    "Reativar contrato", etapa travada quando cancelado, `moverLeadPara`
    pergunta no Ganho → Perdido; Clientes: linha do fechamento com selo
    CANCELADO + motivo/quem, botões Cancelar/Reativar, "Situação do
    serviço" com checkbox "Cancelar também os N contratos fechados";
    Relatórios: 5 KPIs, funil 3 blocos, `FechamentosPorOrigemCard` com a
    marca, `ContratosCanceladosCard`.
  Amarras: `cancelar-contrato` (17; `makeDb` do teste captura o WHERE e
  renderiza com `MySqlDialect` — foi o que pegou a mutação do
  `isNull(canceladoEm)`, invisível pro banco falso) + 7 mutações novas no
  `mutar-relatorio-comercial.py` (31 no total, todas vermelhas). Fora do
  pedido, anotado: estorno do Asaas continua sumindo do Recebido em
  silêncio (não fala com o cancelamento).

Só o dono pode fazer (fora do código): variáveis do Railway — App Secret
da Meta **no painel admin** (Integrações → WhatsApp Cloud) ou em
`META_APP_SECRET_EXTRA` (é isso que alimenta o HMAC do webhook;
`META_APP_SECRET` de env é do Embedded Signup e NÃO vale pro HMAC),
`TURNSTILE_SECRET_KEY`, `SENTRY_DSN_BACKEND`, `RESEND_API_KEY`/`FROM_EMAIL`,
`VAPID_*`, `ENCRYPTION_KEY`/`CANAIS_ENCRYPTION_KEY`, `APP_URL`; quais
eventos de webhook estão ligados na conta Asaas (decide o auth-3); cadastros
nos tribunais + "Testar tudo" (**o dono está fazendo, dando certo — 03/09,
resolvido**); Meta (14 dias sem disparo frio — **dono deu por resolvido em
03/09**); revisão jurídica dos Termos v2 (**dono deu por resolvida em
03/09**). Só `JWT_SECRET` e `DATABASE_URL` derrubam o boot se
faltarem — o resto falha em silêncio.

Conferido com o print do Railway (03/09, fim do dia): faltam só
`TURNSTILE_SECRET_KEY`+`VITE_TURNSTILE_SITE_KEY` (captcha desligado —
**decisão do dono 03/09: não quer o Turnstile por ora; não lembrar de
novo, só se ele pedir ou se aparecer cadastro em massa de robô**) e
`CANAIS_ENCRYPTION_KEY`. Resend, VAPID, APP_URL, OpenAI, DataJud e App
Secret da Meta se resolvem pelo painel admin/banco/default — o dono
confirmou Meta cadastrada e verificada, e os eventos `PAYMENT_RECEIVED`/
`PAYMENT_CONFIRMED`/`PAYMENT_OVERDUE` ligados no Asaas. Pra
`CANAIS_ENCRYPTION_KEY` o dono escolheu código em vez de variável:
`server/integracoes/agentes-api-key-crypto.ts` grava a chave da OpenAI
colada NUM AGENTE com `CANAIS_ENCRYPTION_KEY` → `ENCRYPTION_KEY` (antes,
sem a env, era `"0".repeat(64)`) e lê tentando as duas e depois a de
zeros, então nada gravado precisa de recadastro. A chave colada em
Configurações → Apps externos → ChatGPT sempre usou `ENCRYPTION_KEY`
(crypto-utils) — não era o problema. Amarra: `agentes-api-key-crypto.test.ts`
(6 mutações vermelhas).

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
que batem — não batem). **Resolvido 09/09**: funil em dois blocos
(Ganho/Perdido por `fechadoEm`), ver a entrega de 09/09 (noite).

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
e o "Funil de Vendas" do Relatório Comercial contava por `leads.createdAt`,
então a barra "Ganho" podia não bater com o card "Contratos fechados" da
mesma tela (**resolvido 09/09**, funil em dois blocos).

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
**03/09: o dono está fazendo os cadastros e está dando certo — item sai
da lista de pendências; não cobrar de novo.**

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
   **03/09: o dono deu o assunto Meta por resolvido — não cobrar print nem
   Quality Rating de novo; só reabrir se chegar aviso novo.**
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
2. **Termos v2 publicados SEM revisão jurídica final (24/08) — 03/09: o dono
   deu a revisão por resolvida; não cobrar de novo.** Histórico: aceite
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
