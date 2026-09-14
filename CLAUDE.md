# JuridFlow — guia rápido para sessões Claude Code

> ## ⚠ Leia primeiro: correções de 12/09/2026
>
> Uma auditoria de leitura conferiu este arquivo contra o código. **Onde este
> texto e o código discordam, o código ganha.** O estado atual do produto está
> em **`docs/ESTADO-DO-SISTEMA.md`** — comece por lá.
>
> Correções já aplicadas aqui: a contagem de testes, e as cinco citações
> `arquivo:linha` (as cinco apontavam pro lugar errado; agora citam o símbolo).
>
> **Trechos abaixo que estão DESATUALIZADOS e não foram reescritos** (reescrever
> narrativa do dono sem autorização seria remoção; a correção está no documento
> de estado):
>
> - **Fila item A (JurisIA)** diz "Nenhum plano libera hoje" e "não existe como
>   comprar". **Falso desde 09/09:** a migration 0217 criou o plano `escala` com
>   `jurisia_mensagens_mes = 200` e `'jurisia'` na cesta, e a lista de vantagens
>   do plano vende "JurisIA: pesquisa jurisprudencial (200 consultas por mês)".
>   Está vendido. Os itens A.1 (cobrança cruzada), A.6 (zero Sentry, nenhuma tela
>   de consumo) seguem abertos — e agora valem em produção.
> - **"novas ações (CPF/CNPJ) hoje é SÓ TJCE"** — desatualizado. O adapter é
>   genérico (o próprio `cnj-parser.ts` diz "adapter genérico em pje-tjce.ts
>   cobre todos"), `consultarTjcePorCpf` recebe a config do tribunal, e o cron
>   percorre os tribunais do monitoramento. `shared/tribunais-pje.ts` oferece 16.
>   O que segue verdade: só o TJCE foi validado em campo. Escreva "ligado para
>   16, comprovado em 1".
> - **Pendência 4 (conferências do robô de jornada)** está certa, e é pior: o
>   painel grava `conferenciasTotal` — quantas existem — sem rodar nenhuma.
> - **Entregas de 11/09 sem registro:** botões do fluxo na conversa, assinado sem
>   comprovante (migration 0220) e **crédito virou teto mensal por plano**
>   (migration 0221, `escritorio_uso_mensal`). A última troca uma regra de
>   negócio central e não tem uma linha aqui.
> - **Duas migrations numeradas 0220** coexistem (`0220_assinatura_comprovante_erro`
>   e `0220_lead_cancelamento`).
> - **Anti-pattern "hardcode `cargo === 'dono'`"** está na prática limpo: as 13
>   ocorrências são o resolvedor da matriz, proteção do registro do dono,
>   governança deliberada e um fallback documentado. Não gastar tempo aqui.

## Comandos essenciais

```bash
pnpm check              # typecheck + lint
pnpm test               # vitest (server/**/*.test.ts) — 6.176 verdes em 14/09/2026 (414 arquivos, ~2min)
pnpm test:e2e           # Playwright. Robôs sob demanda: ROBO_ACAO=1 (ação) · ROBO_JORNADA=1 (rotas)
pnpm vitest run <file>  # roda 1 teste específico
pnpm dev                # dev server local
```

## Branches e deploy

- Branch de trabalho: `claude/scraping-bot-error-detection-45eq8o` (a sessão recebe a sua; esta é a de 08–10/09)
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

#### O mockup é NAVEGÁVEL e sai do sistema RODANDO (regra do dono, 12/09/2026)

Palavras dele: *"gere o mockup em html navegável para eu visualizar como
ficará no mundo real e aprovar ou não. adote como regra."*

Antes disso, em 11/09, ele reprovou um mockup desenhado à mão: *"para poder
sugerir melhoria você precisa saber como é o sistema hoje, seus mockups não
retratam o de uso real hoje, fez uma cópia barata e muito mal feita"*. Estava
certo — a proposta havia nascido de `grep` no código, e o desenho inventava
telas que não existem (afirmava que Clientes e Financeiro não tinham
cabeçalho; os dois têm *hero* com nome, subtítulo e KPI, melhores do que o
que eu propunha).

**As três regras que ficam:**

1. **Nada de desenhar tela de memória.** Suba o app
   (`docs/rodar-o-app-localmente.md`, ~5 min neste ambiente), povoe com dados
   (`scratchpad/estudo-telas/povoar.sql`) e trabalhe sobre o que aparece.
   **Tela vazia esconde defeito**: sem dados o estudo dizia "nenhuma tela rola
   de lado no celular"; com dados, quatro rolavam.
2. **O "antes" é captura, nunca desenho.** E o "depois" também: mude o código
   numa branch descartável e capture o resultado. Um typecheck verde não
   prova aparência — no conserto do KPI do Financeiro, `whitespace-nowrap`
   trocou a quebra de linha por um vazamento por cima do cartão vizinho, e
   **só a foto mostrou**.
3. **O navegável é montado com a MARCAÇÃO REAL do app**, serializada do
   navegador — não reescrita à mão. Receita completa em
   `docs/mockup-navegavel.md`; scripts em `scratchpad/estudo-telas/`
   (`povoar.sql` · `serializa.mjs` · `fontes.mjs` · `gera-navegavel.mjs` ·
   `confere-navegavel.mjs`). Ele precisa ter: troca de tela pelo menu, chave
   **Antes ⟷ Depois** e chave **Computador ⟷ Celular**, tudo num HTML
   auto-contido. E tem que ser **dirigido por Playwright** antes de entregar
   — combinação que sai em branco não aparece sozinha.

4. **Navegar não é comparar (12/09, resposta dele ao 1º navegável):**
   *"o antes e depois tá a mesma coisa, não consegui entender as
   diferenças."* Estava certo. O arquivo abria no COMPUTADOR e cinco dos seis
   consertos só aparecem no CELULAR; a chave Antes/Depois exige memória; e o
   quadro de 390px CORTA o vazamento, que é justamente o defeito. Toda
   comparação agora sai do `gera-comparador.mjs`: **uma comparação por
   achado**, já aberta na tela e no tamanho onde ele acontece, os dois lados
   ao mesmo tempo com o MESMO recorte e a MESMA rolagem, **anel** no elemento
   que mudou, **linha tracejada da borda da tela** (o anel cruza no antes e
   não cruza no depois — é esse par que torna o vazamento visível), régua
   medida, uma frase "Onde olhar" e o botão **Piscar** (sobrepõe os dois
   alternando). `mede-alvos.mjs` confere se o alvo do anel realmente MUDA
   entre os estados — três dos dez estavam no elemento errado e o anel saía
   igual nos dois lados.

O "sem JavaScript" da skill `mockup-juridflow` vale para o mockup-retrato;
**o navegável é a exceção pedida por ele**, e o JS nele só troca classe.

### Nunca remover sem autorização expressa (regra do dono, 27/08/2026)

Nenhuma remoção — campo de tela, bloco, procedure, coluna, funcionalidade,
comportamento — sem o dono autorizar EXPRESSAMENTE aquela remoção
específica. "Pode fazer X" autoriza ADICIONAR X, não remover outra coisa
no caminho; refatorar não é licença pra apagar; código "aparentemente
morto" também não sai sem perguntar. Na dúvida, pergunta antes. (Origem:
ele estranhou um suposto sumiço do timeout do Atendente IA — era alarme
falso, mas a regra fica.)

### Documento vivo do estado do sistema (regra do dono, 12/09/2026)

`docs/ESTADO-DO-SISTEMA.md` é o retrato de onde o produto está. **Toda
entrega atualiza esse arquivo no MESMO commit da entrega** — não depois,
não num commit separado de "docs". Se a mudança não cabe no documento,
ela não está pronta.

O que cada entrega revisita lá:
- **Baseline** — rodou `pnpm test`? o número é o que o terminal mostrou
- **Módulos** — algum módulo mudou de estado (casca → parcial → completo)?
- **Pendências** — fechou item? abriu item? mudou o prazo de algum?
- **Dependências externas** — mexeu em Meta, Asaas, OpenAI/Anthropic,
  DataJud, Resend, Twilio ou BACEN? então versão, endpoint e data de
  conferência mudam
- **Regras de negócio** — mudou regra que decide dinheiro, permissão ou prazo?

Três regras de escrita, cada uma nascida de um erro medido neste repo:
1. **Cite símbolo, nunca linha.** `exigirPlanoContratavel` em
   `planos-repo.ts`, não `planos-repo.ts:147`. Em 12/09/2026 as CINCO
   citações `arquivo:linha` deste CLAUDE.md apontavam todas pro lugar
   errado. Linha apodrece em dias; nome de função não.
2. **Número medido, ou número nenhum.** Contagem de teste, de achado, de
   tabela só entra junto com o comando que a produziu. Este arquivo dizia
   "5.526 testes em 378 arquivos"; o real era 5.570 em 380.
3. **Estado, não diário.** O documento responde "onde estamos hoje". O
   histórico de como chegamos aqui fica aqui no CLAUDE.md e no git.

**Regra de leitura, a que mais importa:** quando este CLAUDE.md e o código
discordam, **o código ganha** — e corrigir o CLAUDE.md faz parte da tarefa
que descobriu a diferença.

Por que a regra existe, em um exemplo: o commit `e2e3c0b` (11/09) trocou
uma regra de negócio central — crédito parou de decidir operação, entrou
teto mensal por plano (migration 0221) — e este arquivo não tem uma linha
sobre isso. Pior: por causa da defasagem, a seção da fila abaixo afirma
que o JurisIA "não tem como ser vendido", quando ele **já está sendo
vendido** no plano Escala desde 09/09, com os riscos jurídicos que o
próprio texto classificou como "pode esperar, ninguém compra ainda".
Documentação velha não é inútil: ela faz tomar decisão errada.

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

### Chamadas à Anthropic passam pelo helper (12/09/2026)

Toda chamada a `api.anthropic.com` monta o corpo com `montarBodyAnthropic` e lê a
resposta com `textoDaRespostaAnthropic` (`server/_core/anthropic-http.ts`).
Motivo medido: Opus 4.7+ e toda a família Claude 5 devolvem **400** se recebem
`temperature`/`top_p`/`top_k`, e `ai-call.ts` mandava `temperature` pro
`claude-opus-4-7` — Atendente IA, captura de campos e JurisIA quebrados em
silêncio. O helper também troca modelo **retirado** pelo substituto oficial
(`claude-sonnet-4-20250514` era o padrão do JurisIA e está retirado desde
15/06/2026) e, na família 5, protege o `max_tokens` do raciocínio. Amarra:
`anthropic-http.test.ts` — quebra se um arquivo do servidor mandar
`temperature` por fora, ler `content[0]` ou usar modelo retirado como padrão.
Mesma ideia do `montarBodyOpenAIChat` que já existia pro lado OpenAI.

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
  (em `AdminClients.tsx`, o botão usava `userId` do prop, não `current`).
- **E · Twilio** — "Ligar" liga pro CLIENTE com mensagem de teste
  (**decisão do dono**: esconder o botão é remoção).

Regressão da entrega de 02/09 que entra no P1: o `maskPhoneBR` local do
Atendimento (`Atendimento.tsx`) não cortava o DDI — deep-link
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
  - **Entregue 10/09, escolher campo a campo o que fica ao mesclar — mockups
    `mockup-mesclar-escolher-campos.html` + `mockup-mesclar-decisoes.html`,
    com as duas decisões do dono: 1 = A (a escolha aparece nos DOIS lugares
    que mesclam um par por vez: o Mesclar da ficha e o Mesclar da linha na
    Conferência; o lote "Mesclar todos" NÃO pergunta) e 2 = B (o responsável
    ENTRA na lista de campos escolhíveis).** Regras puras em
    `shared/mesclar-campos.ts` (`linhasDaMesclagem` monta as linhas —
    `escolha` quando os dois lados têm valor e discordam, `um_lado` quando só
    um tem, `somam` pra telefone e tags; campo igual ou vazio dos dois lados
    não vira linha). O padrão de cada linha é o que a mesclagem faria sozinha
    — e-mail/CPF/observações preenchem buraco vazio, nome e responsável NÃO —,
    então quem não mexer termina com o resultado de antes; a tela manda só
    `escolhasQueMudam`. `crm.unificarContatos` e `clientes.mesclarDuplicados`
    aceitam `escolhas`; `clientes.camposParaMesclar` (permissão
    `clientes.excluir`, escopada, nome do responsável por join em `users`)
    serve as duas telas. Aplicação em `unificarComRegistro`, DEPOIS do
    `unificarContatos` de sempre (antes, a mesclagem sobrescreveria a
    decisão). **Tags passaram a SOMAR** (`unirTags`) em toda mesclagem
    registrada, inclusive a automática — é aditivo e o Desfazer devolve as
    originais; se o dono não quiser, é aqui que se tira.
    **O ponto sensível**: `principalAntes` passou a fotografar nome, tags e
    responsável além dos quatro de sempre, e `desfazerUnificacao` restaura o
    que estiver fotografado (`"campo" in antes`) — registro antigo não tem
    essas chaves e escrever `?? null` neles apagaria o que ninguém tocou.
    Client: `clientes/mesclar-escolher-campos.tsx` (hook + tabela, usado pelas
    duas telas); a ficha ganhou o passo do meio (`passo` substituiu o booleano
    `confirmacao`, com Voltar) e a Conferência abre `MesclarComEscolhaDialog`,
    que caminha par a par quando o grupo tem 3+ fichas e pula sozinho o par
    sem divergência. Amarra: `mesclar-escolher-campos` (23 testes) — 28
    mutações vermelhas (`scratchpad/mutar-mesclar-campos.py`; uma só morreu
    depois de a amarra olhar a CHAMADA em vez do import).
  - **Proposta original (superada pela entrega acima)
    `mockup-mesclar-escolher-campos.html`:**
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
- **Entregue 10/09, "encerrei a conversa e o robô voltou a falar" + convite
  de instalar o app no link de assinatura — mockup
  `mockup-robo-encerrada-e-app.html`, "pode fazer" do dono; fiz pelas quatro
  opções recomendadas (1-A, 2-A, 3-A e A no app).** Origem: print dele — o
  fluxo marcado "1x por dia" voltou a falar depois de ele encerrar a
  conversa e o cliente escrever de novo; e um cliente que recebeu link de
  assinatura ganhou junto o botão de baixar o app. **Não reiniciou:
  RETOMOU.** Três coisas se somavam — roteiro que espera resposta fica
  `rodando` com prazo por até 24h; encerrar a conversa mexia só no status
  (quem cancelava roteiro parado era só `excluirConversa`, e o comentário de
  lá já dizia por quê: "a conversa ressuscita"); e `atingiuLimitePorContato`
  só é consultado quando um roteiro COMEÇA — retomada é a mesma passagem.
  - `encerrarRoteirosParadosDaConversa` (db-crm, exportada) cancela as
    execuções `rodando` da conversa **que estejam paradas** (`retomarEm` OU
    `aguardandoMensagemContatoId` não nulos), chamada por `atualizarConversa`
    quando o status vira `resolvido`/`fechado`. O filtro de "parada" existe
    pra não sobrescrever o desfecho da execução que está rodando naquele
    instante — inclusive a do próprio bloco "Encerrar conversa", que escreve
    na conversa por `aplicarEfeitosNaConversa`, fora deste caminho.
    `excluirConversa` continua cancelando TUDO dela (mais amplo, de
    propósito). Efeito colateral bom: o scheduler não tem mais o que acordar,
    então some o "você ainda está aí?" horas depois numa conversa encerrada
    (era o item (c) da lista de não-corrigidos acima).
  - **Recado interno** (decisão 2): quando o limite cala o robô,
    `registrarRoboSilenciado` grava na conversa uma `mensagens` tipo
    `sistema` com o texto de `shared/limite-por-contato.ts`
    (`recadoRoboSilenciado`) e o marcador `robo_silenciado` no payload —
    **um por atendimento** (dedup pela janela `atendimentoIniciadoEm ??
    createdAt` + `like` no marcador), silencioso em caso de falha. Ninguém
    escrevia `mensagens` tipo `sistema` até agora (o enum existia e os
    leitores já pulavam), então o Atendimento ganhou o desenho: nota cinza
    centralizada com "Recado interno — o cliente não vê."
  - **Rótulos** (decisão 3-A, nada muda de comportamento): a conta continua
    janela deslizante de 24h/7d/30d; os textos passaram a dizer isso
    (`ROTULO_LIMITE_CONTATO`: "1x a cada 24h"…), e editor + zod do router
    leem a MESMA lista (`LIMITES_POR_CONTATO`).
  - **Convite de instalar o app**: `<InstallPWA />` é montado fora do
    `<Switch>` (segue lá — nada foi tirado do App.tsx) e no iPhone aparece
    sozinho 3s depois do load, sem depender de `beforeinstallprompt`. Agora
    consulta `conviteInstalarAppPermitido` (shared, via `useLocation`,
    DEPOIS de todos os hooks): fica no login/cadastro/convite/esqueci/
    redefinir/confirmar-email/checkout e dentro do app; **sai de `/assinar`,
    da página inicial, dos termos, da privacidade e do /404**. A tela de
    assinatura NÃO manda link de app na mensagem — era só o banner.
  - Amarras: `encerrar-conversa-encerra-roteiro` (31) e
    `convite-instalar-app` (31; as duas listas de rotas são conferidas
    contra `rotasPublicas()`, derivada do App.tsx em `_paginas-publicas.ts`
    — rota pública nova quebra o teste até ser classificada). 37 mutações
    vermelhas (`scratchpad/mutar-encerrar-e-app.py`; duas só morreram depois
    de ajustar a amarra: o `z.enum` aparece 2× no router, e "/termometro" não
    é prefixo de "/termos" — o caso que discrimina é "/termos-de-uso").
  - **Continuam NÃO corrigidos** (itens (a) e (b) do bloco acima): disparo
    proativo de verdade não confere conversa, e as bolhas da mesma resposta
    não se reconferem entre si. **11/09 o dono fechou o (a)**: disparo
    proativo NUNCA acontece sozinho — tudo que sai é fluxo criado por ele.
    O (b) foi corrigido em 11/09 (bolhas param quando o atendente assume).
- **Entregue 11/09, "Polo ativo" na natureza da ação e card sem nada —
  mockup `mockup-novas-acoes-capa-errada.html`, "pode fazer" do dono com as
  3 decisões (lista do tribunal vale como fonte, DataJud entra como reserva,
  "Carregar detalhes" passa a guardar).** Print dele: 2 buscas e apreensões
  chegaram com NATUREZA DA AÇÃO = "Polo ativo", sem partes, sem vara, na
  gaveta "Não identificado". Causa única: `consultarPorCnj` clica no
  resultado e, se a página do processo NÃO abre, o adapter extraía da
  **tabela de resultados** que ficou na tela — `lerEmListaDefinicao` casava
  o `<th>Classe judicial</th>`, não achava `<td>` na linha de cabeçalho e
  o XPath `following-sibling::*[1]` devolvia o `<th>` vizinho: "Polo ativo".
  Como `conseguiuExtrair = capa.classe || …`, o lixo passava por sucesso
  (e, no poll de movimentações, `hashUltimasMovs` era regravado com o hash
  de ZERO movs — avalanche de "novas" no ciclo seguinte).
  - **Adapter**: `estaNaPaginaDoProcesso` (recusa só o caso certo — tem
    grade `[id*='processosTable']` e nenhum marcador de detalhe; layout
    desconhecido passa), 2 tentativas de clique e, sem abrir,
    `categoriaErro: "detalhe_nao_abriu"` em vez de ler a tela errada; o
    XPath de fallback aceita só `dd`/`td`; valor igual a rótulo é recusado
    (lista inline no `evaluate`, espelho do shared).
  - **`shared/nova-acao-capa.ts`**: `ROTULOS_DE_TABELA` + `ehRotuloDeTabela`
    (sem acento/caixa/":"), `valorDeCampo` em classe/órgão/assuntos na
    GRAVAÇÃO e na LEITURA (limpa retroativamente o que já está gravado),
    `capaTemConteudo` decide o `return null` de `lerCapaNovaAcao`, e
    `lerFalhaDeCapa` passou a contar capa que não sobrevive à leitura como
    falha — é o que devolve o aviso âmbar aos 2 cards do print. Campo novo
    `fonte` ("processo" | "lista" | "datajud", null em capa antiga).
  - **Lista do tribunal como fonte**: `extrairLinhasDaBusca` lê a grade
    pelos TÍTULOS das colunas (título mudou = vem vazio, nunca campo
    trocado); `consultarPorCpf` devolve `linhas` e `consultarPorCnj` também
    (inclusive no erro). `server/processos/capa-da-lista.ts` (`linhaDoCnj`,
    `capaBrutaDaLinha`, `capaDoScraperTemConteudo`) é puro. O CPF escrito
    dentro do nome ("NOME - CPF: …") já era casado pelo polo-matcher, então
    a cliente cai sozinha na gaveta Réu.
  - **DataJud como reserva** (`server/processos/capa-datajud.ts`): mesma
    chave pública/BASE que a JurisIA usa, índice derivado do próprio CNJ
    (`api_publica_<codigoTribunal>`), traz classe/assuntos/órgão/data e
    NUNCA partes. Não cobra consulta nem usa credencial; nunca lança.
  - **Cron**: ordem processo → lista → DataJud (`montar` devolve
    `{capa, polo, data}`; capa sem conteúdo não é escolhida), e o UPDATE de
    `capaJson`/`partesJson` virou `...camposDaCapa` — **capa vazia não
    apaga capa boa** de processo vigiado (era o mesmo defeito com raio
    maior).
  - **Tela/procedures**: `consultarCNJSincrono` aceita `acaoId` e GRAVA a
    capa no card (`gravarCapaNoCard`; `conteudoComCapaNova` protege
    marcação manual e polo já conhecido — leitura sem partes não zera
    polo); `completarCapaPeloDataJud` (grátis, escopada) no botão "Buscar a
    natureza no DataJud" do aviso âmbar; selo de procedência embaixo da
    natureza; "1 cred" virou "1 consulta" e "Tentar de novo" virou "Tentar
    no tribunal de novo".
  - Amarra: `capa-da-pagina-certa` (36 testes) — 40 mutações vermelhas
    (`scratchpad/mutar-capa.py`; a do escopo de escritório só morreu depois
    de a amarra CONTAR as 2 ocorrências, porque escapar só na leitura
    deixava o literal de pé no UPDATE). Dois `expect` atualizados:
    `novas-acoes-polo-gavetas` (opções de `montarCapaNovaAcao` cresceram) e
    `novas-acoes-capa` (texto do botão).
  - **Não conferido daqui**: o ambiente bloqueia os portais dos tribunais e
    o `api-publica.datajud.cnj.jus.br` (proxy 403). O desenho saiu do código;
    o teste real é o dono abrir a aba.
- **Entregue 11/09 (urgente do dono): "WinAnsi cannot encode Ş (0x015e)".**
  Print: quatro documentos assinados com "Assinado, mas o PDF carimbado não
  foi gerado". As 14 fontes padrão do PDF só escrevem WinAnsi (Latin-1 + 27
  símbolos), e o nome do assinante era "Alexandre Yirtici **Ş**ahin":
  `estamparAssinatura` estourava e o cliente ficava com a assinatura
  registrada e sem comprovante. `shared/texto-pdf-winansi.ts`
  (`textoParaPdfWinAnsi`) filtra todo texto de fora antes do `drawText` —
  a letra impossível vira a mais próxima (Ş→S, ğ→g, ı→i por mapa, o resto
  por NFD sem os acentos), **português passa intacto**, e escrita sem
  equivalente latino vira "?" (`precisaFonteUnicode` avisa) em vez de
  derrubar o documento. O nome como a pessoa digitou continua no banco e na
  tela de dados da assinatura; para o PDF sair com o "Ş" exato seria
  preciso embutir fonte Unicode (fontkit + arquivo de fonte, não feito).
  `gerarComprovante` refaz o PDF dos já assinados e limpa `comprovanteErro`.
  Amarra: `pdf-texto-winansi` (8 testes, carimba PDF de verdade com nome
  turco) — 8 mutações vermelhas. Mesma família NÃO corrigida (pdfkit não
  estoura, imprime caractere errado): `comissao-pdf` e `conferencia-pdf`.
- **Entregue 12/09, excluir documento de assinatura — mockup
  `mockup-excluir-documento-assinado.html`, decisões do dono: apaga do
  servidor, só atendente do cliente e gestores, sem "arquivar" (o documento
  já fica guardado em Documentos).** A lixeira existia, mas era desenhada
  só com `a.status !== "assinado"` — documento assinado não tinha caminho
  nenhum para sair da lista. Agora aparece em todos os estados.
  - `assinaturas.excluir` apaga também os arquivos do disco (documentoUrl,
    documentoAssinadoUrl, assinaturaImagemUrl) passando por `caminhoInterno`
    — link externo não é nosso para apagar — e arquivo preso não impede a
    exclusão do registro (senão o documento voltava para a lista).
  - Status `assinado` exige `podeVerCliente` (que passou a ser EXPORTADA de
    router-clientes) sobre o `contatoId` do documento: responsável do
    cadastro, de lead, ou `verTodos`. Documento não assinado segue sem trava
    de cargo, como sempre foi. Quem só ATENDE a conversa não exclui — a
    liberação de 02/09 (`atendeConversaDoContato`) continua nos 4 usos de
    sempre, e o teste que os conta não foi tocado.
  - `registrarAuditoria("assinatura.excluir")` guarda título, status,
    contatoId, assinante, data e quantos arquivos sumiram: depois de
    excluído não existe mais o que consultar.
  - Tela: confirmação forte no assinado (nomeia documento e assinante,
    lista o que some, checkbox de aceite que zera a cada abertura, botão
    travado sem ele); documento não assinado mantém o texto curto de antes.
  Amarra: `excluir-assinatura` (16 testes) — 15 mutações vermelhas (a do
  cliente conferido só morreu depois de a amarra olhar a CHAMADA, porque
  `contatoId` também aparece na auditoria). `tenancy-cargo-assinatura-
  linha-tempo` atualizado (a resposta ganhou `arquivosApagados`).
- **Mockup entregue 11/09, aguardando "pode fazer": app preso em versão
  antiga** (`mockup-versao-nova-atualizar.html`). O dono relatou pela
  terceira vez "cache no módulo Clientes: o nome do cabeçalho troca e os
  campos não". As duas proteções (remount por `key={cliente.id}` desde
  10/08 e re-hidratação desde 09/09) estão em produção e tornam o sintoma
  impossível no código de hoje — mas `client/public/sw.js` **não muda desde
  09/08**, então `updatefound` nunca dispara (o aviso de versão nova em
  `pwa.ts` está morto na prática) e a casca (`/` e `/index.html`) cacheada
  no install nunca é regravada: uma navegação com rede ruim carrega o app
  de 09/08 — um dia ANTES do conserto do formulário. Decisão do dono: faixa
  "Nova versão · Atualizar" (não recarregar sozinho com campo preenchido).
  Proposta: versão do cache por build, casca regravada a cada abertura boa,
  Salvar carregando o id de quem preencheu a tela, `key={selId}` na ficha
  inteira e versão à vista + registro no Sentry.
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

- **Entregue 08–10/09, robô de ação + o que ele achou.** Origem: "quero um
  robô que acessa meu sistema pra procurar erros e inconsistências", depois
  refinado por ele pra "agir como usuário e cruzar o mesmo número entre
  telas". Mockup `mockup-robo-de-acao.html`.
  - **O robô** (`tests/e2e/robo/`, sob demanda com `ROBO_ACAO=1
    pnpm test:e2e`; `ROBO_ACAO_ROTAS=/a,/b` fatia). Duas decisões carregam o
    resto. (1) A superfície NÃO é lista de seletor à mão — foi isso que
    deixou metade dos specs deste diretório em `fixme`, e catálogo fixo mede
    o que alguém lembrou de cadastrar, nunca o que o app tem; `descoberta.ts`
    conta controles visíveis, habilitados e com nome acessível, fora da
    navegação, marcando cada um com `data-robo-acao`. (2) `ok` EXIGE prova:
    "nada explodiu" e "fez o que promete" são afirmações diferentes, então
    clique sem prova registrada vira `nao_verificada` com o motivo escrito.
    O relatório nasce quase todo âmbar de propósito — esse número é a dívida
    de instrumentação e só cai quando alguém escreve prova em `catalogo.ts`.
    `cercas.ts` guarda o que a conta isolada não protege (integração que
    dispara no mundo real, credencial de tribunal que bloqueia OAB, painel
    admin, logout). Escritório descartável do robô nasce com termos aceitos
    (`escritorio-descartavel.ts`) — sem isso o `TermosGate` cobre a tela e
    **48 ações de 4 rotas voltaram como falha, todas o mesmo bloqueio**.
  - **Três falhas do próprio robô, achadas rodando contra o app** (subi
    MariaDB + app do zero no container): prontidão era ausência e não
    afirmação — no `domcontentloaded` a SPA tem 0 botões E 0 spinners, e ele
    varria a tela em branco fechando com "0 de 0, nenhum problema";
    identidade dependia de dado (abas colam contador no rótulo, "Clientes5"
    virava "Clientes" na 2ª carga); e `[role="progressbar"]` é o papel que o
    Radix dá à barra de créditos do /dashboard, **conteúdo permanente lido
    como spinner** — 11 de 11 ações da rota voltaram "tela travada" sem nada
    travado. A régua virou `aria-valuenow` em `SELETOR_CARREGANDO`
    (page-helpers), fonte única — **o robô de jornada carregava a mesma
    heurística ruim** (é candidato a explicar a varredura de 32s do item 1).
  - **Provisionamento de banco novo** (achado ao subir do zero): primeiro
    boot deixava o schema incompleto e o app subia com health check VERDE —
    `contatos.telefonesSecundarios` não era criada e todo INSERT de contato
    morria com "Unknown column". Só se curava no restart seguinte.
    `runMigrations` agora REPASSA o que falhou (até `MAX_PASSADAS_MIGRATION`
    = 3, para quando uma passada não aplica nada) porque ordem alfabética
    não é ordem de dependência; o alerta ao Sentry saiu de dentro do laço
    (falha que se resolve na passada seguinte virava incidente). `0022`
    perdeu o `AFTER telefonesAnteriores` (posição de coluna é cosmética e
    criava dependência real de um `ensureContatoColumns` que roda DEPOIS do
    laço); `0035` e `0084` indexavam `escritorioId` em tabelas cujo nome
    físico é `escritorioIdContato`/`escritorioIdModCt` — a propriedade TS se
    chama `escritorioId` nas duas, então quem escreveu olhando o código
    acertou a propriedade e errou a coluna, e as migrations acusavam FATAL em
    todo boot de todo ambiente desde sempre; `0196` fixou o COLLATE do
    `CONVERT(0xEFBFBD USING utf8mb4)`, que herda o padrão DO BANCO e quebra
    onde o default é `general_ci`. Medido com banco vazio e um só boot: de
    187/192 com 5 erros para **222/222 com zero**. Amarra:
    `migrations-colunas-de-indice.test.ts` (confere todo índice de migration
    contra o nome físico em schema.ts).
  - **Vazamento entre escritórios (10/09, autorizado e mergeado)**:
    `agentesIa.listarCapturadosDoContato` é `protectedProcedure` e passava o
    `contatoId` cru pra leitura SEM `escritorioId` — **qualquer usuário
    logado lia os campos capturados de qualquer contato da plataforma**, e o
    filtro por definições do próprio escritório não protege (chave que os
    dois definem passa); a agenda gravava `contatoId` sem conferir dono nas
    três procedures (a leitura escopada que existia só rodava dentro do
    `if (!responsavelId && input.contatoId)`), e depois toda tela que junta
    agendamento e contato exibia o nome alheio sem bug nenhum nessas telas;
    `getEscritorioPorUsuario` decidia o escritório da sessão INTEIRA com
    `LIMIT 1` sem `ORDER BY` — dois vínculos ativos (removido de um, abriu o
    próprio, restaurado no primeiro) davam escritório indefinido. O portão
    `contatoEhDoEscritorio` estava copiado e privado em `router-crm` e
    `router-kanban` e faltava na agenda: virou fonte única em
    `contato-do-escritorio.ts`, usada pela agenda — **as duas cópias
    continuam lá** (dedup não foi autorizado, e não era troca justa na
    véspera). Amarras: `tenancy-vinculo-por-id` (5) +
    `numero-whatsapp-um-escritorio` (6), conferidas por mutação.
  - **Um número de WhatsApp, um escritório**: a dedup de canal só olhava
    DENTRO do escritório, então o mesmo `phoneNumberId` entrava em dois — e
    `findCanalByPhoneNumberId` devolvia o primeiro do scan, sem olhar status:
    a mensagem do cliente de uma banca caindo na caixa de outra. Agora os
    TRÊS caminhos que criam canal (Embedded Signup, CoEx, manual via
    `criarCanal`) recusam número já CONECTADO em outro escritório
    (`numero-whatsapp-unico.ts`; só o que está no ar barra — abandonado lá
    libera, é a migração de quem troca de sistema), e o webhook junta todos
    os candidatos: um resolve, empate com um único conectado roteia com
    aviso, **dois conectados não são roteados** e viram alerta no Sentry
    (mensagem que não chega é problema; chegar na banca errada é pior e
    silencioso).
  - **Caso "Pedro Yuri" — investigado e FECHADO, não reabrir.** O dono viu um
    cadastro em outro escritório com os dados de um cliente do Boyadjian e
    suspeitou de vazamento. Não era: `loginMethod=google`, conta criada
    05/09 15:18 BRT, termos aceitos 15:44 (26 min depois, clique humano),
    nenhuma impersonação nossa em 05 ou 06/09, e ele não é nem foi
    colaborador do Boyadjian. É o SOBRINHO do cliente, que fechou contrato
    lá, chegou ao site (o link `juridflow.com.br/assinar/<token>` que ele
    recebeu pra assinar é a única superfície do produto que põe o domínio na
    mão do cliente final), entrou com Google e cadastrou o tio. CPFs
    DIFERENTES nas duas fichas, caixa e acentuação diferentes — digitação
    independente, não cópia. **O dono CONFIRMOU em 11/09 que foi ele mesmo
    quem se cadastrou** — assunto encerrado. Conclusão de produto, não de
    bug: o cadastro self-service está aberto pra quem é CLIENTE de
    escritório, não advogado.

## Frente de frontend (10–12/09/2026) — "o sistema mais lindo e intuitivo"

Pedido do dono em 10/09, com duas regras explícitas: **não mexer em
backend, só telas**, e **documentar tudo** (feito, stand-by, corrigido) para
outro agente conseguir continuar. Decisão de ritmo dele: *"mockup hoje,
código depois do lançamento"* — ou seja, proposta visual nasce mockup e só
vira código quando ele aprovar.

### Fatia 1 — escala tipográfica: ENTREGUE e MERGEADA (10/09, "pode mergear")

Eram **2.856 `text-[Npx]`** escritos à mão no client, em 33 valores
distintos, e o que caía no menor deles era o que mais importa (o selo
"2º grau?" e o PRAZO saíam em 9px na lista de Processos). Agora há 7 tokens
em `client/src/index.css` (`--text-micro` 11px · `--text-apoio` 11.5px ·
`--text-corpo` 13px · `--text-secao` 15px · `--text-titulo` 20px ·
`--text-numero` 22px · `--text-pagina` 26px), aplicados em **673 lugares**
nas 6 telas do dia a dia. **Piso de 11px**: abaixo disso não entra nada —
quem lê é advogado, lê o dia inteiro, boa parte usa óculos. Onde faltar
contraste, a saída é PESO e COR, não um tamanho novo.
Os tokens são declarados **sem `line-height` de propósito**: `text-[10px]`
também só mexia no font-size, então trocar por token não pode arrastar o
espaçamento vertical e mudar layout que ninguém pediu.
Amarra: `server/__tests__/escala-tipografica.test.ts` (9 testes, 5 mutações
vermelhas) — a lista `TELAS_MIGRADAS` cresce a cada fatia, de propósito.
Correção de fato que ficou registrada: **título de tela é Inter 700, não
Poppins**. Poppins (`--font-display`) é só a marca "J" e as telas de login.

### Fatia 2 — REPROVADA (11/09), e por quê

Mockup desenhado à mão foi reprovado: *"para poder sugerir melhoria você
precisa saber como é o sistema hoje, seus mockups não retratam o de uso real
hoje, fez uma cópia barata e muito mal feita"*. Ele estava certo. A proposta
havia nascido de `grep`, e **`grep '<h1'` mede a TAG, não o título**:
Clientes e Financeiro "não tinham cabeçalho" no diagnóstico e na verdade têm
*hero* com selo, subtítulo e KPI, melhores do que o `PageHeader` proposto; a
saudação do Dashboard/Atendimento é decisão de produto (trocar por
"Dashboard" seco seria remoção); e `/movimentacoes` é a MESMA tela de
Processos, contada como duas.

### Estudo refeito das telas REAIS (11/09) + ambiente local

`docs/estudo-frontend-telas-reais-2026-09-11.md` — app subido de verdade,
povoado e fotografado em 1600px e 390px. Receita do ambiente em
`docs/rodar-o-app-localmente.md` (MariaDB por apt — Docker Hub é bloqueado
pelo proxy; `pnpm dev` roda as 225 migrations sozinho).
**Tela vazia esconde defeito**: sem dados o estudo dizia "nenhuma tela rola
de lado no celular"; com dados, quatro rolavam — e com tarefas/conversas
povoadas (12/09) apareceu uma quinta e uma sexta.

### Entregue 12/09 — 7 consertos de tela, APROVADA ("pode fazer") e MERGEADA

Mergeada em `develop` e em `main` no mesmo dia, com os pré-requisitos da casa
conferidos na ponta final DEPOIS de trazer `develop` para dentro da branch:
`pnpm check` limpo, **5.602 testes verdes (383 arquivos)** e `vite build`
passando. O único conflito do merge foi em `CLAUDE.md` (as duas pontas
escreveram no mesmo lugar) — resolvido mantendo os DOIS lados, o bloco do
`develop` antes da seção nova.

O que foi aprovado saiu do comparador `comparador-antes-depois.html` (ver
regra 4 acima). Mockup navegável
`mockup-navegavel-telas-reais.html` (antes ⟷ depois, computador ⟷ celular,
telas serializadas do app rodando). Medido no navegador, largura do conteúdo
num celular de 390px: Dashboard 461→390 · Processos 449→390 ·
Movimentações 449→390 · Tarefas 437→390 · Financeiro 443→390 ·
Acordos 430→390. **11 de 11 telas cabem; eram 5 de 11** — e as três causas
eram diferentes (tira de abas em linha reta; fileira de botões sem
`flex-wrap`; grid sem coluna declarada abaixo de `lg`, onde a coluna
implícita vale `auto` e cresce até o conteúdo). Mais quatro:
pílula "AGORA" da Agenda (103px num vão de 48px, invadia a coluna das horas
e cobria o nome do compromisso) virou duas linhas; na linha da tarefa o
aviso de atraso era desenhado em cima da data (`10/09/2026⚠`); coluna do cliente em Movimentações (220px fixos, cortava
"Maria Aparecida Nogueir…" com 1.065px vazios) cresce até 380px em monitor;
e `R$ 10.7k` — ponto decimal inglês — virou `R$ 10,7 mil` por
`shared/formato-numero.ts` (`moedaBR`/`moedaCurtaBR`/`numeroBR` em cima do
`Intl`), única fonte: os dois arquivos que tinham a função duplicada,
idêntica e com o mesmo defeito (`financeiro/helpers.tsx` e
`dashboards/common.tsx`) passaram a reexportar dali. Amarra:
`server/__tests__/formato-numero.test.ts` e
`server/__tests__/telas-cabem-no-celular.test.ts` (8 testes, **14 mutações
vermelhas** em `scratchpad/mutar-telas-celular.py` — as duas primeiras
versões da amarra passavam com a classe apagada porque o trecho vizinho
tinha a palavra; foi preciso ancorar no `className` do elemento certo).
O navegável foi dirigido por Playwright (46 combinações, nenhuma vazia) e
`confere-fidelidade.mjs` confere DENTRO do iframe os números medidos no app
(coluna 220→380px, pílula 103px/1 linha→48px/2 linhas, `R$ 10.7k`→
`R$ 10,7 mil`, valor no celular 48px→20px): 7/7.
**Regressão que só a FOTO pegou** (typecheck e 4.696 testes passaram nas
duas versões): `whitespace-nowrap` no KPI do Financeiro trocou a quebra de
linha por vazamento por cima do cartão vizinho, truncando "Asaas" em "As…".
Conserto certo foi `grid-cols-1 sm:grid-cols-2`.
**Fora do pedido, anotado e NÃO mexido**: avisos empilhados do Financeiro
(esconder é remoção); os 5 tamanhos de título de tela (mexe em hero e
saudação, precisa de mockup próprio); tabela do Financeiro virar cartão no
celular (hoje rola dentro da moldura — virar cartão é redesenho); contraste
do valor verde-escuro no hero verde (decisão de cor).

### A cor do menu — DUAS decisões colidiram em 13/09; o dono desempatou:
### fundo `#07060f`, resto da família violeta

Duas sessões receberam pedidos diferentes sobre o MESMO token no mesmo dia, e
os dois foram aprovados por ele:

- **Tarde** (mergeada em `develop` e `main`): o menu veste a cor da LOGO —
  fundo roxo-quase-preto `#191229`, «Jurid» em branco puro, «Flow», item
  aberto e anel em violeta. Pedido: *"Vamos deixar a cor desse menu mais
  alinhado com a logo real?"*. Seção 19 do `docs/ESTADO-DO-SISTEMA.md`.
- **Noite** (esta): `--sidebar: #07060f`, a cor do header do Devular, *"para
  o menu de juridflow e também para o menu de devular"* — aprovada no
  `mockup-cor-do-menu-devular.html` (variante B; renomeado porque a outra
  sessão usou o mesmo nome de arquivo).

**Como ficou.** Segurei a troca e mostrei as duas juntas
(`mockup-menu-duas-decisoes.html`, fotografadas na mesma tela, `#191229` ×
`#07060f`), porque o mockup aprovado aqui fotografou o "hoje" ainda no
azul-ardósia — ele nunca tinha comparado as duas propostas entre si. Ele
desempatou: *"eu quero a cor do menu que aprovei"*, e disse com todas as
letras que segurar custou tempo dele. **Lição registrada: com duas aprovações
válidas, aplicar a mais recente e mostrar o conflito DEPOIS — o custo de
segurar recaiu nele.**

Entregue: **só o FUNDO** virou `#07060f` (`:root` e `.dark`, sólido). Nada da
entrega da tarde foi desfeito — `--sidebar-accent`, `--sidebar-primary`,
`--sidebar-ring`, `--marca-em-escuro` e o «Jurid» branco do `MarcaJ` seguem
violeta, e sobre o quase-preto o item aberto ganha contraste em vez de
perder. Sonda de pixel no app rodando: `#07060f`.
Amarras: `cor-do-menu.test.ts` (5 testes, 6 mutações vermelhas em
`scratchpad/mutar-cor-do-menu.py`) trava a cor exata e proíbe a transparência
voltar; `menu-cor-da-logo.test.ts` teve **só o primeiro `it` reescrito** (o
fundo saiu dela e virou "escuro e igual nos dois temas") — os outros cinco,
que guardam violeta no realce/anel/marca e marinho como cor de ação do
conteúdo, ficaram intactos.

**O achado que sobrevive à escolha, e que vale pros dois produtos:** "a mesma
transparência" NÃO dá a mesma cor em lugares diferentes, porque o que está
atrás muda. Medido com canvas (não no olho): o header sobre o hero escuro do
Devular rende `#080710`; os MESMOS 80% num menu lateral, que tem a PÁGINA
CLARA atrás, rendem `#37363e` — grafite. Copiar a linha `bg-[#07060f]/80` de
um pro outro parece certo e entrega cinza. Por isso, onde a cor do Devular for
usada num menu, ela vai **sólida**.

- **Devular (`crm-saas`, branch `claude/cor-do-menu-13-09`, NÃO mergeada e NÃO
  conferida visualmente):** lá o menu era quase branco com texto escuro, então
  os cinco tokens mudam juntos (texto, item ativo, contraste do item, borda em
  branco 10%, acento) — trocar só o fundo deixaria texto preto sobre preto.
  Entrou também `color-scheme: dark` na barra, que o JuridFlow já pagou para
  aprender (sem isso o navegador pinta a rolagem nativa em cinza claro cortando
  o menu). **Não foi possível subir aquele app aqui**: o proxy bloqueia
  `codeload.github.com` (403) e uma dependência vem de lá, então `pnpm install`
  falha — sem foto e sem `pnpm check`/`pnpm test`, os pré-requisitos de merge
  da casa não podem nem ser avaliados. A amarra de lá (6 testes, 6 mutações
  vermelhas) foi rodada com o vitest do jurify, porque o teste só lê o CSS.
  **Esta branch também depende da escolha acima**: se o JuridFlow fica no roxo
  da logo e o Devular vai pro `#07060f`, cada produto veste a própria marca —
  que é o que eu recomendo, e não é o que o pedido dele dizia ("nos dois").

### Entregue 13/09 — editar plano cabia 2110px numa janela de 1440

Print do dono: *"aqui também está feio. Vamos refazer essa tela"*. Medido antes
de mexer: `/admin/planos/:slug` pedia **2110px numa janela de 1440** (670 fora
da tela, que é a coluna cortada no print dele) e **1605px num celular de 390**.

**Causa única, e vale como regra:** `flex-1 truncate` na lista "Destaques do
cartão". `truncate` é `white-space: nowrap` e **item de flex nasce com
`min-width: auto`** — juntos, o texto EXIGE a largura inteira dele (1467px
medidos) e estica cartão → coluna → grid → página. Trocar truncate por
`break-words` sem `min-w-0` NÃO resolve: a largura mínima continua sendo a do
conteúdo. Quatro classes no total (destaque, grid
`300px minmax(0,1fr) 330px`, aviso do código interno virando linha de apoio,
grade de limites `grid-cols-1 [&>*]:min-w-0 sm:grid-cols-2 lg:grid-cols-3`).
Nada removido. Detalhe na seção 24 do documento de estado. Amarra: 3 testes
novos em `telas-cabem-no-celular.test.ts` — 21/21 mutações vermelhas.

**O piloto visual do mesmo comparador (`mockup-editor-plano-e-visual.html`)
NÃO entrou** — ele aprovou "a tela editar plano apenas". Raio de 12px,
elevação no cartão e Poppins nos títulos (só tokens) estão escritos e
fotografados na branch `descartavel/editor-plano`, commit `3a691e07`. Dois
fatos que saíram do estudo e valem pra próxima conversa de estética: **a fonte
do anúncio que ele gostou já está no projeto** (Poppins, hoje só na marca e no
login) e **o tema escuro já existe** (preferência `jurify:tema` resolvida pelo
`ThemeContext` — forçar a classe `.dark` no `<html>` por fora não funciona, o
contexto reescreve depois de hidratar). Achado que só a foto do escuro pegou e
NÃO foi corrigido: o "R$ 10,7 mil" do cartão verde do Financeiro é verde
escuro sobre verde, e o vizinho sai violeta.

### Entregue 13/09 — busca no cabeçalho, "outros períodos" fora, abas minimalistas

Pedido dele depois do navegável: *"só gostei do buscar ficar alinhado com nome
do usuário. e pode remover o botão outro período também […] e o navbar geral,
comercial, operacional e financeiro podemos refazer também o estilo para algo
mais minimalista"*. As três feitas no app, não em mockup.

A busca do cabeçalho abre a **mesma** paleta do ⌘K — `AbrirPaletaContexto`
leva o `setPaletaAberta` do `AppLayout` até a tela, senão a tela teria que
duplicar a paleta ou simular tecla. **A busca do rodapé do menu ficou onde
estava**: ele pediu a de cima, não pediu para tirar a de baixo. Abas viraram
texto com sublinhado de 2px na ativa; `max-w-full overflow-x-auto` continua no
invólucro porque é o que impede a tira de empurrar a página no celular (teste
trava). Detalhe na seção 26 do documento de estado.

**As quatro rodadas de redesenho ANTES disso foram reprovadas, e a lição vale
mais que elas**: ele mandou um print do painel que queria (escuro, rico,
cartão arredondado, elevação, gráfico, mapa de calor, avatares) e eu respondi
três vezes com tipografia seca, fio de 1px, sem cartão e sem gráfico —
impondo a minha tese de "menos é mais" por cima da referência que ele
escolheu. A quarta versão, já na linguagem do print dele, está em
`mockup-navegavel-redesenho.html` (3 telas, antes/depois, computador/celular,
12/12 combinações conferidas). Dela ele aproveitou só a busca alinhada.
**Regra que fica: quando o dono manda uma referência visual, ela é o briefing
— não o ponto de partida de um debate.**

### Entregue 13/09 — o cartão do Cofre media 2.566px de altura

Print dele: *"esse card das credenciais está muito comprido, quero que redesenhe
para ficar mais bonito."* Aprovado no comparador
`mockup-cofre-cartao-credenciais.html` (*"pode fazer"*).

**Causa, medida antes de mexer:** a grade dos tribunais mora DENTRO do cartão da
credencial, e o cartão é item de uma lista `lg:grid-cols-3` — feita pra três
lado a lado. A grade ficava com **335px de largura útil e 800px vazios ao
lado**, e cada estado era uma caixa com DUAS caixas dentro (uma por grau): 78
blocos empilhados, 2.143px de altura. Agora cada estado é **uma linha** (sigla à
esquerda, selos de grau à direita, o selo É o botão de testar) e a credencial
nacional ocupa a **fileira inteira**. Cartão: 2.566 → **612px** no computador,
5.069 → **1.831px** no celular.

Regra que fica: **grade de N itens dentro de um cartão de lista herda a largura
do cartão, não a da tela** — se a lista é `grid-cols-3`, a grade tem um terço,
e o custo aparece em altura, não em erro.

Nada removido: os dois graus, os três estados, a contagem de processos, o selo
sem portal, o texto cru do erro e o aviso do "não testado" continuam. Os blocos
de erro repetidos viraram a dobra "Por que N falharam" (o número fica sempre à
vista). Detalhe na seção 31 do documento de estado. Amarras: teste novo em
`telas-cabem-no-celular.test.ts` + `cofre-erros.test.ts` atualizado, 6 mutações
vermelhas.

### Raio-X do design em produção (13/09)

`docs/raio-x-design-2026-09-13.md` — 11 telas medidas no navegador, contando o
que foi REALMENTE pintado dentro do `<main>`. Base factual para a conversa de
estética que ele abriu ("insatisfeito com o layout"): **22 tamanhos de texto**
no sistema (o menor 9px, abaixo do piso de 11px da Fatia 1), **14 raios de
canto** distintos onde o tema declara 4/5/6/8/10, até **17 cores de fundo**
numa tela só, e **UMA sombra** no sistema inteiro — nada tem elevação, é tudo
borda de 1px sobre fundo quase branco. Ferramentas: `raio-x-design.mjs` e
`fotos-producao.mjs` (esconde a faixa "STAGING", que não existe em produção e
pintaria de âmbar o topo de toda foto — achado falso num estudo de estética).
O estudo com as propostas segue aberto.

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

## Entregas de 12–13/09/2026 (resumo; detalhe em `docs/ESTADO-DO-SISTEMA.md`)

- **Mergeado em develop e main (12/09, "pode mergear")**: Instagram "em breve"
  (`canalEmBreve`), texto honesto de tribunais (`coberturaTribunais` na shared,
  migrations 0223/0224, fila "Avisar quando chegar" com e-mail), cancelar
  honrando a cláusula 5 (migration 0225, `emCarenciaDeCancelamento`,
  Reativar), "Sob medida" ≥ Escala (0226), helper único da Anthropic
  (seção acima), D-13 (cadastro nunca apaga conta) e D-15 (cargo só do próprio
  escritório).
- **Mergeado em develop e main (13/09, "pode mergear")**: motor próprio fase 1 — despachante por
  tribunal, TRT2/TRT15 por consulta pública, 24 TRTs com credencial "em teste",
  parsers puros com `linkedom`, migration 0227. Regras de integração que
  ficaram: consulta pública vence a credencial quando existe; busca por CPF só
  onde `tribunalRequerCredencial`; TRTs em teste não entram no número vendido.
  Só o dono valida nos portais (ordem em ESTADO 15.1.1).
- **Na branch, aprovado pelo dono em 13/09 ("menu aprovado")**: o menu lateral
  veste a cor da logo — fundo roxo-quase-preto, «Jurid» em branco puro, «Flow»
  e o item aberto em violeta; o marinho segue sendo a cor de ação do CONTEÚDO.
  O violeta exato da logo não passa de contraste sobre o menu (2,89:1 antes,
  3,18:1 depois, mínimo 4,5); o tom entregue é a clareada mínima, 5,41:1.
  Comparador `mockup-cor-do-menu.html` (opções A e C ficaram lá). Amarra
  `menu-cor-da-logo.test.ts`, 11 mutações vermelhas. Detalhe na seção 19 do
  documento de estado; a skill `mockup-juridflow` foi corrigida junto, porque
  dizia que violeta não é o app.
- **Central de ajuda: entregue 13/09 de manhã e REMOVIDA por inteiro 13/09 à
  noite**, por pedido expresso do dono (*"remova todo o módulo ajuda"*, depois
  de *"remova esse ajuda, irei gravar os vídeos"*). Saíram: `/ajuda` e
  `/ajuda/:tarefa`, o wrapper `ClientAreaSoTermos`, as 5 tarefas + 16 "em
  breve", os 9 prints de `client/public/ajuda/`, o `AjudaDaTela` das 5 telas,
  o botão do menu e o item do avatar no celular, e Primeiros passos por
  completo (`router-ajuda.ts`, `shared/primeiros-passos.ts`,
  `PrimeirosPassos.tsx`, namespace em `modulos-contratacao`) — com as duas
  amarras do módulo. **Ficou de pé**: a Visão rápida de `/admin/saude` em 3
  linhas (`shared/saude-semaforos.ts`; `capturaConfigurada` =
  `SENTRY_DSN_BACKEND || SENTRY_DSN`), que é painel do admin e não faz parte da
  Central, e o `redirect: false` do `serveStatic`. Detalhe na seção 18 do
  documento de estado.

- **Entregue 13/09, monitoramento voltando erro — "pode fazer" do dono, com a
  decisão dele: "processos trabalhistas nega até credencial de verdade".**
  Duas causas, uma de cada entrega recente; detalhe na seção 20 do documento de
  estado. (1) A guarda de 11/09 (`estaNaPaginaDoProcesso`) decidia por sniffing
  de página e recusava página BOA: o PJe também monta o detalhe na MESMA aba, por
  AJAX — a URL continua `listView.seam` e a grade fica no DOM. A decisão passou
  pro RESULTADO da extração: o clique sem confirmação só levanta bandeira, e o
  erro sai se não vier conteúdo. Quem barra a leitura da tabela de resultados é a
  recusa de rótulo, não o sniffing. De passagem, a espera pós-clique virou corrida
  aba-nova × marcador-na-mesma (eram 15s × 2 por processo à espera de uma aba que
  nunca vem). (2) Os 24 TRTs no registro levaram o Cofre de **16 pra 40**
  tribunais e a bateria de **30 pra 78 logins** (medido): `atualizarStatusAposLogin`
  e `marcarCredencialExpirada` escrevem na CREDENCIAL, então o último TRT da fila
  dava a palavra final e a credencial do TJCE terminava "erro".
  `falhaDerrubaCredencial` é a régua: sucesso sempre promove, falha só derruba em
  caminho comprovado; o por-tribunal continua gravado sempre. Candidatos saíram da
  fila do "Testar tudo" (dobra "Em teste", `alvosDaBateria` como fonte única da
  conta) sem sair da tela. Processo trabalhista exige prova = linha `ativa` em
  `cofre_credencial_tribunais` (`tribunal-comprovado.ts`), nas 4 portas + import;
  TRT2/TRT15 ficam fora da exigência porque a consulta pública deles funciona.
  `linkedom` virou dependency (é import de produção com `--packages=external`).
  Amarras: `tribunal-candidato-nao-derruba` (18) e `detalhe-no-lugar-nao-e-falha`
  (10) — 27 mutações vermelhas; 4 sobreviveram na 1ª volta pelo mesmo motivo de
  sempre, o literal de pé em outro lugar do arquivo.
  **Os dois resíduos foram fechados no mesmo dia (novo "pode fazer" dele),
  seção 20.7 do documento de estado**: (a) `consultarCNJSincrono` ganhou o desvio
  de consulta pública — tudo que é do Cofre foi para dentro do ramo que exige
  credencial e o scrape virou `consultarProcesso(codigo, cnj, storageState)`, com
  sessão nula no tribunal aberto; cobra igual e só depois das guardas. (b) A foto
  do erro sobrevive: `print-do-erro.ts` move para
  `./uploads/monitor-erros/escritorio_<id>/` (o adapter não sabe de tenancy, quem
  conhece o dono é que coloca na pasta), migration 0228 guarda a URL em
  `ultimo_erro_print_url`, sucesso limpa nos 4 caminhos, e o card ganhou o link
  «ver a tela do tribunal» quando há erro e foto. Copia e apaga em vez de
  renomear (o volume é outro mount) e nunca lança. Amarra:
  `consulta-publica-e-print-do-erro` (13) — 18 mutações vermelhas.
  **Segue anotado**: `sistemaCofrePorTribunal` devolve `pje_*` pra trt2/trt15
  contra o próprio comentário; falha de TJ comprovado fora do ar ainda derruba a
  credencial inteira (pré-existente); e o laço de novas ações não guarda foto
  (grava falha por tribunal em `varreduraJson`, sem campo pra isso).

- **Entregue 13/09, bloco comercial ("pode fazer" do dono, com os extras SOMANDO
  ao teto do plano — recomendação dele aceitada). Detalhe na seção 21 do
  documento de estado.** Origem: ele perguntou o que melhorar no serviço; a
  resposta que virou código foram três coisas que custavam venda.
  (1) **Cupom**: `criarCupom` conferia `planosIds` contra a lista fixa de
  `products.ts`, mas a tela lista o CATÁLOGO por slug — a tela oferecia o que o
  servidor recusava, e nenhum dos três planos vendidos podia entrar em promoção.
  Agora confere catálogo ∪ lista fixa (a fixa fica como reserva).
  (2) **Extras avulsos** (usuário, processos, CPFs, número de WhatsApp): sem
  migration, moram em `escritorio_addons` com produto `extra:<chave>`,
  `limiteMensal` = quantidade e `precoCentavos` = total mensal congelado (é
  PACOTE, não unidade — "200 por R$ 49" tem que caber). Regra pura em
  `shared/extras-avulsos.ts`. **A sutileza que decide**: os tetos discordam sobre
  o que é zero — em monitoramento `0` é SEM TETO, em conexões de WhatsApp `0` é
  NENHUMA; por isso cada extra declara `zeroEIlimitado` e `somarAoTeto` exige a
  opção explícita. Enforcement em 4 tetos; nas conexões de WhatsApp a conta
  estava copiada em 3 lugares e virou `limiteConexoesWhatsapp`. Fatura ganhou
  `ItemFatura.tipo = "extra"` e `extras` opcional (caller antigo = fatura de
  antes). Painel: botão «Extra» no cartão Módulos & cobrança, auditado como
  `extra.avulso`.
  (3) **JurisIA cobrava OU liberava, nunca os dois**: o cartão grava produto
  `jurisia` seco (a fatura varre `modulo:%` e não o via → guardava o preço e não
  cobrava); o diálogo de avulsos grava `modulo:jurisia` (a leitura de acesso
  buscava só o seco → cobrava e não liberava). Fechados os dois lados,
  aditivamente, sem cobrar dobrado quando as duas concessões existem.
  Amarra: `bloco-comercial-extras-cupom-jurisia` (22) — 24 mutações vermelhas;
  2 sobreviveram na 1ª volta (a do botão conferia o `onClick` e não o rótulo; a
  do prefixo só morreu com `"modulousuarios"`, o caso que discrimina).
  **Anotado**: `getUserCreditsInfo`, `health.plansCount` e os dois getters de
  `db.ts` seguem no `PLANS`; o extra não aparece pro cliente (mostrar pede
  mockup); JurisIA segue sem Sentry e sem tela de consumo (resto do A.6).

- **Entregue 13/09, retorno do teste de uso do dono (seção 22 do documento de
  estado).** Ele entrou como cliente e trouxe quatro coisas; **duas não eram
  defeito**, e isso fica registrado pra ninguém "consertar" o que está certo:
  (a) **Termos não aparecem** quando o cadastro foi pelo SITE (`auth.signup` já
  grava o aceite — a caixa de marcar está no próprio formulário) nem em
  IMPERSONAÇÃO (`termos.status` devolve false com `impersonatedBy`, de
  propósito). **Consequência**: testar a experiência impersonando não mostra a
  experiência real.
  (b) **"Meta API não configurada"**: `getMetaAppConfig` devolve null em QUATRO
  situações (env sem os DOIS; banco sem appId+appSecret; decrypt falhando;
  sem banco) e as quatro viram a mesma frase. `META_APP_SECRET_EXTRA` é do HMAC
  do webhook e NÃO serve pro Embedded Signup. Gap achado e **não corrigido**: o
  formulário do painel não tem campo pro `config_id` da Meta (só
  `META_CONFIG_ID` de env), então `config.configId` do banco é caminho morto —
  sem ele o popup abre Facebook Login genérico, não o onboarding do WhatsApp.
  (c) **`PrimeirosPassos` saiu do Dashboard** a pedido expresso dele. NÃO foi
  apagado: vive em `/ajuda` (`PrimeirosPassosResumo`), e a amarra
  `primeiros-passos` inverteu — trava que não volta e que o conteúdo continua lá.
  O `GuiaProcessual` (variante processual) ficou, aguardando a palavra dele.
  (d) **Diálogo "Cadastrar credencial"**: não tinha teto de altura nem rolagem e
  passava da tela num notebook (título cortado em cima, botões embaixo) — 41
  diálogos do client usam `overflow-y-auto` e 19 usam `max-h-[90vh]`; este era a
  exceção. E o campo pedia «CPF ou OAB»: o login do PJe é CPF, virou «CPF». O
  manual da Central de ajuda mudou no MESMO commit (regra do «»).
  Amarras: `dialogo-credencial-cabe-na-tela` (5) + `primeiros-passos` reescrita —
  8 mutações vermelhas.

- **Entregue 13/09, módulo Ponto fora de produção + 5 remoções na tela de
  Processos (seção 23 do documento de estado).** Dois pedidos dele em sequência,
  no mesmo teste de uso. Remoção de elemento NOMEADO não passou por mockup: não
  há desenho novo pra aprovar, e ele listou item por item.
  - **Ponto** ("remover por enquanto de produção e em stating deixar com a
    etiqueta beta"): **nada de código foi apagado**. `MODULOS_BETA` em
    `shared/modulos-por-ambiente.ts` é lida pelas TRÊS portas que decidem se um
    módulo existe — menu (`itemVisivelNoMenu` no AppLayout), rota
    (`ModuloGuard`, tela nova `ModuloEmTestes`) e procedures
    (`conferirModuloDoPath` → FORBIDDEN `modulo_em_beta`). Três listas divergindo
    daria item escondido no menu com a API aberta. Três decisões que valem
    lembrar: ambiente DESCONHECIDO conta como produção (na dúvida, não mostrar);
    a recusa vem ANTES do atalho de admin e da conta de contrato nas duas portas
    de acesso, **única exceção consciente ao fail-open do gate** (cesta
    indeterminada não pode abrir módulo tirado do ar); e cesta `null` continua
    `null` (transformar em lista vazia trocaria o fail-open inteiro por efeito
    colateral da lista). `subscription.modulosContratados` passou a devolver
    `ambiente` nos DOIS ramos — sem ele o client trata tudo como produção e
    esconde o Ponto em staging. Pra devolver: apagar `"ponto"` da lista, nada
    mais. **Pendência que o pedido não cobria**: o plano **Escala** (0217) tem
    `'ponto'` na cesta e o cartão vende "ponto da equipe" — a migration NÃO foi
    tocada, então em produção o cartão anuncia o que a conta não mostra; mudar o
    texto é outra remoção e depende dele. Amarra:
    `modulo-ponto-fora-de-producao` (16), com o par oposto (aparece em staging E
    não aparece em produção — esconder nos dois seria remoção não pedida).
  - **Processos**: saíram a aba Alertas, a pastilha de créditos, os botões
    «Resumo diário» e «Consultar CNJ» e as três pastilhas de contagem
    (monitorados · parados · nova ação). **A conferência antes de tirar a aba
    Alertas**: ela era o painel de aprovar prazo sugerido e só `Processos.tsx`
    toca `prazosSugeridos` no client — se fosse o único caminho, tirá-la deixaria
    o cron enchendo tabela que ninguém lê. Não é: a timeline do Monitoramento tem
    «Requer prazo» + «＋ Criar prazo» chamando a MESMA `prazosSugeridos.aprovar`.
    **Ficou sem tela**: `descartar` (era só da aba); sugestão não aprovada fica
    pendente com o selo. As pastilhas repetiam o número do badge da aba logo
    abaixo (`MonitoramentosCount`, `NovasAcoesBadge`) e as 2 queries eram cópia
    das deles — `CabecalhoProcessos` ficou sem props e sem query. `?tab=alertas`
    cai na Central em vez de abrir aba inexistente.
    **NÃO removidos de propósito** (ele autorizou o BOTÃO, não o código):
    `ConsultarTab` fica no arquivo sem porta, com o motivo escrito no topo;
    `ConfigResumoDiario` segue exportado em `Movimentacoes.tsx`; e o aviso
    «Saldo baixo» + os textos de custo em crédito dos diálogos continuam —
    **pergunta aberta pro dono**. Amarra: `processos-cabecalho-enxuto` (10);
    `movimentacoes-na-carteira` e `telas-cabem-no-celular` ATUALIZADAS pra
    verdade nova (a 1ª confere o MECANISMO — estado e montagem —, porque o rótulo
    «Consultar CNJ» segue escrito no comentário que explica a decisão; a 2ª trava
    o `flex-wrap` da tira de abas, que virou quem segura os 390px);
    `fuso-telas-usam-helper` perdeu a metade que exigia a pill da aba e manteve a
    que protege. **31 mutações vermelhas**
    (`scratchpad/mutar-ponto-e-processos.py`; 1 sobreviveu na 1ª volta — a amarra
    conferia a POSIÇÃO da recusa de ambiente e dava pra desarmar a condição no
    lugar; agora confere que o `if` é incondicional).

- **Entregue 13/09, dois achados do dono usando o sistema — "ok faça" (seção 25
  do documento de estado).** Os dois foram REPRODUZIDOS no app rodando antes de
  consertar, e o "antes" de cada um é foto.
  - **A Central escondia movimentação pendente** ("tudo marcado como resolvido e
    movimentações ainda mostra 11"). A lista pede o período ordenado por DATA e
    cortado em `limite` (80), e só DEPOIS do corte separava resolvida de
    pendente: com 91 no período e as 11 pendentes mais ANTIGAS que as 80 que
    couberam, elas caíam fora da consulta — não eram mal contadas, eram
    **inalcançáveis** por aquela tela (90 dias piora; só a busca alcançava,
    porque roda antes do corte). O badge conta o BANCO sem teto, a tela contava
    a PÁGINA — daí os dois números discordarem, e o «Resolvidas (80)» ser o
    tamanho da página. Conferido antes de acusar: contador e lista filtram o
    mesmo recorte, e `prazos_sugeridos` tem UNIQUE em `evento_id` (o leftJoin
    não duplica) — o teto era a única diferença. Conserto em duas garantias que
    só valem juntas: **ordem** `asc(lido), desc(dataEvento)` (pendente primeiro,
    é o que impede o teto de comer trabalho) e **janela** (contagem à parte no
    banco, por estado, em `triar(...).janela`). `contagem` segue descrevendo a
    página e encolhendo com o filtro de tipo — decisão antiga, preservada e
    testada. A tela passou a usar a janela no texto do vazio, na decisão "nada
    no período" × "tudo resolvido" e no rótulo Resolvidas, e ganhou o aviso
    «Mostrando 69 de 80 resolvidas…», que só aparece quando falta algo.
  - **Cliente em teste não conseguia pagar o plano que testava** ("clico em
    adicionar pagamento e não acontece nada"). Três portas fechadas: a faixa
    mandava pra `/configuracoes?tab=meu-plano`, a tela em que ele JÁ estava
    (navegar pra rota atual é não-evento); o bloco do plano atual só tinha botão
    pra sob consulta e pra carência; e o cartão do próprio plano travava em
    «✓ Você está aqui» (texto de quem já paga), com o rótulo «Continuar com este
    plano» — escrito pra esse caso — **inalcançável**. O servidor sempre esteve
    pronto (`createCheckout` tem o "Cenário B: conversão trial → pago" e não
    recusa o plano atual). Pagar só dava escolhendo plano DIFERENTE. Conserto:
    botão «Adicionar pagamento» no bloco (só teste + preço fechado + fora de
    carência, vira «Ver o pagamento» com cobrança aberta), `travadoPorSerOAtual`
    separando quem paga de quem testa, e `irPagar()` na faixa (de outra tela
    navega; já em Meu plano rola e foca o botão). `billingOk === false` continua
    travando os dois, como antes.
  Amarras: `central-nao-esconde-pendente` (12) e `pagar-o-plano-em-teste` (14) —
  **31 mutações vermelhas** (`scratchpad/mutar-pendente-e-pagamento.py`); 3
  sobreviveram na 1ª volta pelo motivo de sempre (a amarra conferia o NOME, não
  quem alimentava o número — dava pra reatribuir a variável à página com o
  literal de pé em outro lugar). `central-grupos` ganhou 2 testes e teve o
  `expect` de objeto inteiro atualizado; os 17 de comportamento, intocados.

- **Entregue 13/09, a moeda "crédito" saiu do produto + o cartão do Escala parou
  de vender o Ponto (seção 27 do documento de estado).** Autorização dele:
  *"remova ponto da equipe do cartão / tudo referente a creditos pode excluir
  caso pois não usaremos mais isso"*.
  - **Por que era seguro**: crédito já não decidia nada desde 11/09.
    `consumirCredito` (chamada pelos 4 routers de cálculo) por dentro chamava o
    TETO MENSAL e não encostava em saldo — o NOME sobreviveu à troca e era ele
    que fazia a tela dizer "Seus créditos acabaram. Adquira mais créditos",
    mandando comprar o que não estava à venda. Virou `contarCalculoNoMes`.
  - **Por que era urgente**: `cobrarMonitoramentosMensais` rodava **a cada 6h em
    produção**, debitava 2 cred/mês por processo e 15 por CPF e, sem saldo,
    marcava o monitoramento como **`pausado`** com notificação "pausado por
    falta de créditos". O saldo só voltava por outro cron. A moeda estava viva
    o bastante pra **desligar vigia de processo** por uma conta que ninguém
    olhava — os dois crons saíram juntos, e remover pela metade seria pior que
    não remover.
  - **Saiu**: os módulos `escritorio-creditos`, `custos-creditos` e
    `migrate-legacy-credits`; as procedures `processos.saldo/pacotes/transacoes/
    adicionarCreditos`, `dashboard.credits` e `admin.concederCreditos/
    retirarCreditos/migrarCreditosLegacy`; o chip de saldo e todos os textos de
    custo em Processos; "consome 1 crédito" nos cálculos; o cartão de créditos
    do painel; a barra do Dashboard. Cada um já tinha substituto: teto mensal
    (`contarUso`), vaga do plano, `aumentarLimiteDoMes` e `UsoDoMes`.
  - **Mudança de porta que vale saber**: acesso virou **só assinatura**.
    `hasAccess = hasSubscription || hasCredits` perdeu a segunda metade. Pagante,
    teste e cortesia têm linha de assinatura e não sentem nada; quem entrava SÓ
    por crédito sobrante cai em "Meu plano".
  - **NÃO saiu, de propósito**: (1) `creditosCalculosMes` — a coluna guardou o
    nome, mas É o teto mensal de cálculos (`CAMPO_DO_PLANO.calculo`); apagar
    tiraria o limite, então mudou só o RÓTULO no painel («Cálculos por mês»);
    (2) as tabelas `escritorio_creditos`/`escritorio_transacoes` — histórico não
    se joga fora por migration, e ninguém mais lê (apagar é decisão do dono);
    (3) **"crédito" no sentido financeiro** — «Cartão de crédito», «Crédito
    Pessoal» do bancário, `creditoMesDiferente`: **varredura cega por "crédito"
    destrói o módulo de cálculo bancário**, e duas mutações da bateria existem
    só pra travar essa distinção.
  - **Cartão do Escala** (migration 0229): "Comissões automáticas por
    colaborador e ponto da equipe" → sem o ponto. A **cesta não foi tocada** (o
    módulo volta sozinho quando sair do beta), e a troca é por TEXTO EXATO
    (`JSON_SEARCH`), não por posição — `features` é editável no painel.
  Amarra: `credito-saiu-do-produto` (19) — **28 mutações vermelhas**
  (`scratchpad/mutar-credito-e-cartao.py`; 2 sobreviveram na 1ª volta pelo
  literal de pé em outra ocorrência). Seis amarras foram ATUALIZADAS em vez de
  apagadas, e em três a metade que ainda protege ficou: `lancamento-creditos-
  limites` manteve `limitesDoPlano`; `admin-excluir-conta-alvo` manteve o
  caminho de EXCLUIR CONTA (bloqueador P0-D); `superlancamento-planos` passou a
  travar a VAGA.

- **Entregue 13/09, o uso só libera depois de escolher plano ou teste — "resolva
  logo isso" do dono (seção 28 do documento de estado).** Ele descreveu o fluxo
  ("cadastra > confirma e-mail > aceita termos > escolhe plano ou teste > libera
  uso") e perguntou como garantir. A conferência achou **dois degraus que eram
  só desenho**: termos e plano viviam no navegador, e a API respondia sem
  nenhum dos dois. O do plano era o pior, por um motivo que não se vê na tela —
  o porteiro de módulos é fail-open e lê "sem assinatura" como "não sei",
  liberando a cesta inteira.
  - `shared/acesso-sem-plano.ts` + `server/_core/gate-assinatura.ts` +
    `requirePlanoEscolhido` na corrente do `protectedProcedure` (entre
    `requireUser` e `requireModuloContratado`). **A régua NÃO mudou**: é a mesma
    `getActiveSubscriptionComHeranca` do `SubscriptionGuard` — cortesia > paga >
    teste > cancelada em carência, colaborador herdando do dono. Mudou o lugar
    onde ela é conferida, então ninguém que entra hoje passa a ser barrado.
  - **Deny-by-default**, ao contrário do porteiro de módulos: namespace não
    declarado EXIGE plano (lá o fail-open protege pagante; aqui daria o produto
    de graça a cada router novo). O teste confere a lista contra o `appRouter`.
  - **O caminho de escolher o plano fica aberto** (`auth`, `termos`,
    `subscription`, `configuracoes`, `permissoes`, `notificacoes`, `push`,
    `ajuda`): o «Meu plano» mora DENTRO de Configurações, que pede escritório e
    cargos ao montar — sem isso a pessoa fica trancada fora da tela de pagamento.
  - **O cache guarda o SIM e nunca o NÃO** — com o "não" em cache, quem clica em
    «Testar grátis» levaria recusa nos 30s seguintes. Conferido no app rodando:
    depois do clique o produto responde 200 na hora.
  - Fail-open na indeterminação (banco fora passa); admin e impersonação sempre
    passam. As 3 contagens de badge do menu pararam de perguntar sem plano.
  - **Termos continua só na tela** — não foi o que ele pediu; fica anotado.
  - Consequência pra quem escrever teste: procedure chamada por caller com banco
    falso precisa de `vi.mock("../_core/gate-assinatura", …)` — 5 arquivos já
    ajustados com o comentário. E caller de router SOLTO (cron de relatórios
    programados) tem path sem namespace, então cai no deny-by-default.
  Amarra: `uso-so-com-plano` (17) — **32 mutações vermelhas**
  (`scratchpad/mutar-uso-so-com-plano.py`; 4 sobreviveram na 1ª volta, três pelo
  literal de pé em outro lugar e uma por falta de relógio — a validade do cache
  só morre com `vi.useFakeTimers`). `modulos-contratacao` teve só o `expect` da
  corrente atualizado.

- **Entregue 14/09, jurisprudência de verdade + Base Jurídica e JurisIA num
  módulo só — "pode fazer" do dono no comparador `comparador-conhecimento-
  juridico.html` (seção 32 do documento de estado).** Origem: ele perguntou se
  juntar os dois não faria mais sentido e pediu "uma IA que busca de tempos em
  tempos todo o material nos sites oficiais".
  - **O diagnóstico**: o acervo do DataJud não tem UMA LINHA de texto de
    decisão — classe, vara e movimento, e o desfecho é deduzido do movimento.
    Por isso a JurisIA media e não citava. Jurisprudência é acórdão publicado,
    que é público por desenho e mora nos portais dos tribunais.
  - **Migration 0230**: `jurisia_ementas` (fonte, tribunal, identificador,
    órgão, relator, data, ementa, URL; UNIQUE por fonte+identificador,
    **FULLTEXT** na ementa) e `jurisia_fontes_coleta` (estado por fonte).
    **Sem COLLATE explícito, de propósito**: fixar `unicode_ci` fez o MySQL
    recusar comparar a sigla do tribunal com a do acervo (general_ci) — mesmo
    tropeço da 0196. A contagem de ementa por tribunal virou 2ª consulta casada
    em JS, pra não depender disso nunca mais.
  - `shared/fontes-oficiais.ts` (a lista declarada, com `material:
    "ementa" | "metadado"` e cadência), `extrair-ementas.ts` (extração pura de
    JSON e HTML), `coletor-ementas.ts` (a passada, o estado e a rodada do
    cron), `busca-ementas.ts` (FULLTEXT booleano).
  - **Cinco decisões que carregam o resto**: (1) ementa vem ANTES do número na
    resposta, com a frase que separa os dois; (2) **fonte nasce DESLIGADA** e
    ligar não coleta na hora — quem coleta é a cadência, e o cron só visita o
    que foi ligado à mão; (3) **ementa sem URL não entra** (coluna NOT NULL);
    (4) a busca é por TEXTO, não por semelhança — "capitalização" tem que achar
    capitalização —, e o tribunal do caso ORDENA em vez de filtrar; (5) o
    extrator é genérico porque daqui não dá pra ver o corpo real de nenhum
    portal, e parser escrito às cegas é ficção.
  - **Nenhuma fonte foi ligada**: depende da sondagem, que só roda em produção
    e diz quais portais respondem DO SERVIDOR e quais devolvem ementa.
  - **Credencial de tribunal continua fora**, de propósito: ela só abre o que é
    do escritório, e varrer em volume com login de advogado arrisca a OAB.
  - Painel: as duas abas viraram **Conhecimento jurídico** (fontes oficiais +
    entendimentos por região + a biblioteca + o painel do DataJud numa dobra —
    **nada foi removido**, e `?aba=base`/`?aba=jurisia` continuam chegando lá).
  Amarra: `jurisprudencia-de-verdade` (31) — **39 mutações vermelhas**
  (`scratchpad/mutar-jurisprudencia.py`; 2 sobreviveram na 1ª volta, as duas
  por fixture fraca: faltava JSON com ementa e sem identificador, e o HTML de
  duas linhas não tinha container). `admin-layout-novo` e
  `jurisia-router-contrato` atualizadas pra verdade nova.

- **Entregue 14/09, súmulas do STJ/STF na base + a sondagem dita em português —
  origem: ele rodou a sondagem em produção e respondeu "Entendi nada,
  sinceramente. deveria ter súmulas stj/stf acordãos, resp né n?" e "e buscar
  isso automático já que é público as informações" (seção 33 do documento de
  estado).** Duas coisas, e as duas vinham do mesmo erro meu: a tela estava
  escrita pra mim (`403`, `tls`, `dns`, "é o IP") e o material que ele nomeou —
  **súmula** — não existia como fonte.
  - **O que a sondagem de produção mediu**: TJSP, TJMG e TRF4 respondem do
    nosso servidor (200); STJ (SCON e portal) e DJEN dão **403 que PERSISTE com
    identificação de navegador** — é faixa de IP, então "é público" não implica
    "o robô consegue ler"; STF trava em **certificado** (conserto quase sempre
    nosso); TJRJ 404 e CNJ dados abertos sem DNS. E **200 na página de entrada
    não prova ementa** — a sondagem bateu no formulário do TJSP, e formulário
    de tribunal imprime a palavra "ementa" no rótulo do campo. Daí
    `porta_aberta` ≠ `coleta_liberada` em `shared/fontes-oficiais.ts`.
  - **Súmula virou material de primeira classe**, com a mecânica que a
    diferencia: conjunto FECHADO (`listaCompleta` em vez de busca por termo —
    `enderecoDaFonte` IGNORA o termo) e sem número de processo, por isso
    extrator próprio (`extrair-sumulas.ts`; o de ementa EXIGE número de
    processo e devolveria zero, e o zero pareceria "a fonte não serve").
    `fonteCitavel()` virou a régua única de "entra no acervo" (as 4 comparações
    com `"ementa"` do coletor viraram uma chamada). **Cancelada não entra**,
    nos DOIS leitores, e a conta das que ficaram fora volta no resultado.
    Guardada na MESMA tabela `jurisia_ementas`, sem migration.
  - **Automático onde a porta abre; colar onde não abre.** As súmulas do STF e
    o LexML têm `listaCompleta` e o cron passa a visitá-las quando alguém
    ligar — **nenhuma fonte foi ligada**. Pro STJ existe
    `jurisiaImportarSumulas`: ele cola o texto oficial e o sistema separa uma
    por uma, pelo MESMO extrator do robô. Conferido de ponta a ponta no banco
    local (6 do STJ + 1 do STF, texto vindo de `fontes-revisional.ts` — não
    inventei enunciado).
  - **A tela em português**: `shared/sondagem-em-portugues.ts` (puro) devolve
    `{tom, frase, acao}`; a separação que importa é `conserto` (depende de nós)
    × `fechado` (só saindo por outra porta) — juntar os dois numa cor fez a
    tela velha parecer que os tribunais todos fecharam. Linha ordenada pelo
    tom, resumo antes da tabela, e **o número técnico NÃO foi removido**:
    desceu pra coluna "Detalhe técnico" (há mutação travando isso). A sondagem
    passou a contar súmula rodando o extrator de verdade (`temEmenta` procura a
    PALAVRA "ementa", e página de súmula não usa essa palavra) e a bater no
    endereço que o ROBÔ usa, tirado da mesma lista do coletor.
  - **Anotado e NÃO feito**: repetidor com outro IP pro STJ/DJEN (custo, é
    decisão dele); consertar o certificado do STF; o endereço real do TJCE (o
    e-SAJ é de São Paulo — daqui o proxy bloqueia os portais); e ligar
    TJSP/TJMG/TRF4, que é o que vira `porta_aberta` em `coleta_liberada`.
  - **Duas coisas que só a FOTO pegou** (comparador
    `comparador-sumulas-e-portugues.html`, as duas versões rodando ao mesmo
    tempo no MESMO banco, conferido por Playwright): a coluna nova levou a
    tabela de fontes a OITO colunas e espremeu a descrição num fio de dez
    caracteres (virou uma célula só); e o cartão da sondagem mora numa grade de
    dois, então a tabela de três colunas empurrou o recado pra FORA do cartão e
    a coluna do meio saiu vazia (virou duas colunas, com o número técnico como
    terceira linha) — mesma lição da seção 31, mais o `whitespace-nowrap` que a
    célula de tabela traz de fábrica. E `situacaoVigente`: coleta de hoje vence
    medida de ontem, senão a tela afirma "o site responde" embaixo de um erro
    de recusa.
  Amarra: `sumulas-e-sondagem-em-portugues` (36) — **48 mutações vermelhas**
  (`scratchpad/mutar-sumulas-portugues.py`; 7 sobreviveram na 1ª volta: a trava
  de cancelada só existia no leitor de texto, e as fixtures de índice e de
  script/style estavam fracas — script no `<head>` não prova remoção quando a
  leitura é do `<body>`). `jurisprudencia-de-verdade` teve 2 `expect`
  atualizados.

- **Entregue 14/09, notificações push que o dono escolhe — "Bora fazer" dele no
  mockup `mockup-notificacoes-padrao.html` (seção 34 do documento de estado).**
  Pedido: "uma seção para ativar as notificações push padrões do app — Sentença
  proferida, Nova ação detectada, Nova conversa Iniciada… o que faz sentido ter
  como padrão".
  - **O que existia**: push funcionava, mas **sem preferência nenhuma**
    (`TIPOS_PUSH` era um Set fixo, 7 tipos, tudo-ou-nada por aparelho); o dono
    recebia **toda mensagem de toda conversa**; movimentação ia só pra quem
    CADASTROU o vigia (`mon.criadoPor`); e 4 avisos existiam sem chegar no
    celular (prazo, pagamento, cobrança vencida, credencial quebrada).
  - **A regra que protege tudo**: `avisoDoTipo` devolve `null` pro que o
    catálogo não conhece, e **null quer dizer ENVIA**. Banco fora, erro de
    leitura, usuário sem linha — tudo passa; o único "não" é o explícito. Sem
    isso a entrega seria um apagão silencioso de avisos, que não dá erro e só
    aparece quando alguém perde prazo.
  - **Só o que DIVERGE do padrão é gravado** (`notificacao_preferencias`,
    migration 0231): voltar ao padrão APAGA a linha, e é isso que deixa mudar
    um padrão depois e alcançar quem nunca mexeu. Conferido no banco: tabela
    vazia depois de ligar e desligar de volta.
  - **`decidirPush` é pura** (aviso, mapa, hora local) e `pushPermitido` é a
    casca com banco e cache de 60s. **Desligado vence silêncio** — trocar a
    ordem faria o log mentir sobre por que o celular não tocou. E o silêncio
    cala o CELULAR, não o sino: SSE e notificação saem de qualquer jeito.
  - **Sentença proferida** virou a classe da movimentação: o cron manda
    `classe` calculada por `classificarGrupo`, o MESMO classificador da
    Central. Movimentação SEM classe cai em **decisão**, nunca em rotina —
    silenciar o que a IA não conseguiu ler seria o pior default. **Nova
    conversa** sai de `conversaNova` no handler, com a mesma régua que já
    re-carimba o início do atendimento.
  - **Passaram a chegar no celular**: prazo vencendo (depois da dedup de 12h),
    pagamento recebido e cobrança vencida (depois da dedup do evento do Asaas,
    que retenta 2–3×), contrato fechado (em try/catch: aviso que falha não
    desfaz venda) e credencial de tribunal. **Cliente esperando 15 min** é cron
    novo — espera = conversa `aguardando` cuja ÚLTIMA mensagem é de entrada,
    teto de 72h, um toque por espera.
  - **Anotado**: silêncio é 21h–7h fixo (campo editável pede tela nova);
    `novo_lead` segue em `TIPOS_PUSH` sem ninguém emitir (tirar é remoção); os
    avisos de dinheiro alcançam dono e gestores, não cargo configurável.
  Amarra: `notificacoes-que-o-dono-escolhe` (37) — **51 mutações vermelhas**
  (`scratchpad/mutar-notificacoes.py`; 6 sobreviveram na 1ª volta e ensinaram:
  quatro eram mutante equivalente ou literal desatualizado, e DUAS mostraram
  que o silêncio só estava guardado por texto — daí `decidirPush` virar pura e
  ganhar teste de comportamento de verdade).

- **Entregue 14/09, data de nascimento no cadastro + lembrete de aniversário —
  "pode fazer" do dono no comparador `comparador-aniversario-cliente.html`
  (seção 35 do documento de estado).** Pedido: *"Quero um campo no cadastro do
  cliente para colocar sua data de nascimento para me lembrar do seu
  aniversário."*
  - **Por que campo de verdade e não campo personalizado**: o mecanismo de
    campos extras já existia e **guardaria** a data sem servir pro pedido — o
    valor mora num JSON em `TEXT` e nenhuma consulta alcança o que está lá
    dentro. Dava pra escrever a data e não dava pra ser lembrado dela. Daí a
    coluna `contatos.dataNascimento` (migration 0232, `DATE NULL`), ao lado da
    qualificação civil. **`mode: "string"` no schema**: vira `Date` e o dia
    passeia de fuso — 12/03 vira 11/03 depois das 21h.
  - **Regras puras em `shared/aniversario.ts`**, fonte única da tela, do filtro
    e do cron: `partesDaData` RECUSA 31 de fevereiro em vez de deixar o `Date`
    empurrar pra março; o aniversário de HOJE é o próximo, não o do ano que vem;
    **29 de fevereiro é comemorado em 28** nos anos sem o dia 29; "neste mês" é
    o mês do CALENDÁRIO, não os próximos 30 dias; idade só aparece com o ano
    conhecido.
  - **O achado que só a FOTO pegou**: a 1ª versão usava `<input type="date">` e
    saiu **`09/14/1985`** — o campo nativo desenha no idioma do NAVEGADOR. O
    repo já sabia disso no filtro "Cadastro", com o motivo escrito no código.
    Virou texto mascarado `dd/mm/aaaa` (`mascararDataBR`/`brParaIsoData`/
    `isoParaBrData` na shared), e data que não existe fica vermelha SEM gravar.
  - **Tela**: campo em `CamposQualificacaoEndereco` (um componente, duas telas)
    e **fora** de `CAMPOS_OBRIGATORIOS_QUALIFICACAO` — exigir travaria contrato
    pra carteira inteira; `SeloAniversarioHero` na ficha (sem data, sem selo) com
    «mandar parabéns» por `wa.me`; filtro "Aniversário" na lista, com o servidor
    usando `passaNoFiltro`, a MESMA função da tela; e `?aniversario=hoje` lido na
    inicialização — senão o push cairia na lista inteira.
  - **Cron** `rodarLembretesDeAniversario`: de hora em hora, por escritório.
    **Um aviso por dia com todos dentro** (cinco aniversários viram cinco toques
    = a pessoa desliga tudo); **quem guarda "já mandei" é o BANCO**, pelo
    prefixo do título — memória de processo morre em redeploy e o aviso sairia
    de novo; **`>=` a hora e não `===`**, senão reiniciar às 8h em ponto custa o
    dia; responsável + dono com a chave de alcance (`somarNomes` junta, não
    sobrescreve). Encerrado/cancelado/rescindido ficam fora.
  - **Decisão do dono que fica registrada**: os parabéns são MANUAIS, pelo
    WhatsApp dele. Disparo automático pelo número do escritório é mensagem
    proativa da plataforma — o padrão dos avisos da Meta — e seria pedido à
    parte (hoje `GatilhoSmartflow` não tem gatilho de data).
  - **Anotado e NÃO feito**: `cliente.dataNascimento` não entrou nas variáveis
    de contrato; lead entra no lembrete junto com cliente; no celular a tela de
    Clientes já leva pro Atendimento (de antes, não mexido).
  Amarra: `aniversario-do-cliente` (27 testes) — **42 mutações vermelhas**
  (`scratchpad/mutar-aniversario.py`; 8 sobreviveram na 1ª volta, sete pelo
  motivo de sempre — a amarra conferia o NOME e não a CHAMADA — e uma era
  mutante equivalente: a faixa de mês/dia é caminho rápido, quem recusa mês 13
  é a volta pelo `Date`).

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
**Estado 03/09**: (2) resolvido — em `Clientes.tsx`, `ClienteDetalhe` separa carregando de
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
1. **Robô de jornada varre em 32s** — dono já disse que está errado. Pista
   forte de 10/09: ele usava `[role="progressbar"], .animate-spin` como "está
   carregando", e `role=progressbar` é o papel que o Radix dá à barra de
   créditos do /dashboard — CONTEÚDO permanente. O seletor virou fonte única
   (`SELETOR_CARREGANDO` em page-helpers, régua = `aria-valuenow`) e o
   jornada já aponta pra ela; falta rodar e conferir se os 32s eram isso.
   Os achados do último run se perderam num `tail -30` do script — rerodar.
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
   ACEITA a requisição e só loga aviso (`verif.mode === "no-secret"` em
   whatsapp-cloud-webhook.ts). **12/09: o dono confirmou que o App Secret
   está cadastrado no painel** (Integrações → WhatsApp Cloud) — em produção
   o webhook está no modo estrito. O código continua fail-open sem secret
   (decisão de desenho registrada no documento de estado); não cobrar de
   novo.
4. **Conferências do robô de jornada** só rodam pelo Playwright — ligar no
   executor do painel. Depois: cron de staging de hora em hora.
5. **CSP desligado** no Helmet; **body-parser 3GB em memória** (OOM) — sai
   junto com a migração S3.
6. **Histórico de buscas de Processos vaza entre escritórios** (10/09) — a
   chave é `jurify:processos:history`, sem escritório nenhum
   (`client/src/pages/processos/search-history.tsx`). Quem impersona o dia
   inteiro (o dono) vê no dropdown de um escritório os CNJs e nomes que
   pesquisou dentro de outro. Solução desenhada e NÃO implementada: chave
   por `escritorioId` + migração da chave antiga só em sessão NÃO
   impersonada (senão a migração despeja as buscas de um no outro — o
   próprio vazamento) + impersonação nunca grava. **Trava numa decisão do
   dono**: sessão impersonada deve gravar histórico? (recomendei que não).
   Com a migração a mudança fica invisível pro advogado, o que dispensaria
   mockup; sem ela, esvazia o histórico de todo mundo e vira remoção.
7. **Portão `contatoEhDoEscritorio` duplicado** (10/09) — a fonte única está
   em `server/escritorio/contato-do-escritorio.ts` e só a agenda usa; as
   cópias privadas continuam em `router-crm.ts` e `router-kanban.ts`, com
   OUTRO nome (`contatoDoEscritorio`); e há uma segunda duplicata que este
   registro não citava: `colaboradorDoEscritorio`, copiada nos dois routers.
   Apontar as duas pra ela é higiene, não segurança (as três funcionam) — e
   é remoção de código, então precisa de autorização.

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
- ❌ `fetch` à `api.anthropic.com` montando o body à mão — `temperature` dá 400
  em Opus 4.7+/Claude 5 e `content[0]` pode ser raciocínio; use
  `montarBodyAnthropic` + `textoDaRespostaAnthropic`
- ❌ confirm() nativo do browser pra ações destrutivas (use AlertDialog) —
  catraca em `robo-acao-cercas.test.ts` com a dívida por arquivo: a lista só
  encolhe. Além do padrão, o robô de ação NÃO consegue responder confirm(),
  então cada um é uma ação destrutiva que nenhum teste alcança
- ❌ Ler `contatos` (ou qualquer tabela de tenant) por um `id` que veio do
  client sem amarrar `escritorioId` na MESMA cláusula — `protectedProcedure`
  só checa login. Use `exigirContatoDoEscritorio` (contato-do-escritorio.ts)
- ❌ Gate admin em procedure usada por dropdown user-level
- ❌ Hook (`useEffect`/`useState`/…) DEPOIS de `return` antecipado no
  componente — a contagem muda entre renders e o React derruba a tela
  (#310). Saída antecipada vai embaixo de todos os hooks; pra economizar
  query use `enabled`, não `return` mais cedo
