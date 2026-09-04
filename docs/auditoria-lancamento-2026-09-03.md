# Auditoria pré-lançamento — 03/09/2026

Lançamento comercial marcado para **10/09**. O dono pediu: "ler todo o
código e procurar falhas de sistema, principalmente no lado do usuário".

## Método

16 leitores em paralelo, um por subsistema, lendo os arquivos inteiros
(Atendimento, Clientes, Agenda/Tarefas/Prazos, Processos/Cofre, Financeiro/
Comissões/Asaas, Kanban, Relatórios/Dashboards, Configurações/Permissões,
Auth/Cadastro/Planos, SmartFlow, IA, Assinaturas/Modelos, Landing/Ponto/
Cálculos, Admin, casca do app, infra/crons/webhooks). Cada achado passou por
um **cético** do mesmo subsistema, cuja tarefa era derrubá-lo abrindo o
arquivo na linha citada. Os 15 achados classificados como "bloqueia
lançamento" foram **conferidos de novo, um a um, por mim**, no código —
todos os 15 se sustentam. Mais uma varredura transversal minha (padrões
que só aparecem contando o repositório inteiro).

Arquivos lidos: 633. Achados confirmados: **237** (15 bloqueiam · 117
importantes · 105 menores). Derrubados pelos céticos: 6. A lista completa,
com arquivo:linha, trecho de código, sintoma e fix de cada um, está em
`docs/auditoria-lancamento-2026-09-03-achados.md`.

**Nada foi corrigido nesta passada.** Regra do dono: mockup antes de mudança
visível, e nada é removido sem autorização expressa. Cada item abaixo diz
se o fix muda tela (precisa de mockup) ou não.

> **Estado em 03/09 (fim do dia)**: o dono aprovou o mockup
> `mockup-correcoes-bloqueadores.html` e os grupos **A, B, C e D foram
> entregues** (B com a opção 2 do teste grátis: botão "Testar grátis por N
> dias" por plano). **E (Twilio) ficou em stand-by** por decisão dele.
> Detalhes e amarras no `CLAUDE.md`, bloco "Entregue 03/09".
>
> **Noite de 03/09**: dos P1 por causa-raiz, **1 (fuso), 2 (lembretes), 3
> (DDI) e 5 (aviso de clique) foram entregues** (mockup
> `mockup-correcoes-p1.html` aprovado). Seguem abertos: P1-4 (permissões),
> 6 (Kanban), 7 (Processos/Cofre), 8 (planos hardcoded do admin), 9
> (outros) e os P2.
>
> **Madrugada de 04/09**: do mockup `mockup-correcoes-p1b.html` o dono
> aprovou só as abas Kanban e Processos/Cofre. **P1-6 (Kanban) entregue
> menos o kanban-x1** (prazo em branco = 15 dias: aguarda a escolha A/B
> dele) e **P1-7 (Processos/Cofre) entregue** — ver `CLAUDE.md`, bloco
> "Entregue 03/09 (madrugada)". Seguem abertos: P1-4 (permissões), 8
> (planos hardcoded do admin), 9 (outros) e os P2 — ele disse "o resto não
> entendi", então precisam de uma explicação mais simples antes de voltar.

---

## P0 — bloqueiam o lançamento (15, todos conferidos)

### A · Escrita e leitura CRUZADA entre escritórios (8)

Mesmo padrão em todos: a procedure recebe um `id` do client e usa sem
conferir `escritorioId`. Nenhum desses fixes muda tela — é adicionar a
amarração que já existe nas procedures vizinhas. Risco de regressão baixo,
teste por mutação obrigatório.

| # | O que acontece | Onde | Fix |
|---|---|---|---|
| atendimento-1 | `enviarMensagem` grava mensagem em conversa de OUTRO escritório e **envia pelo WhatsApp dele** (decripta o token do canal alheio) | `router-crm.ts:566-650` | carregar a conversa com `escritorioId` no início; recusar se não achar |
| atendimento-2 | `iniciarConversa`/`criarConversa` aceitam `canalId` alheio — conversa nasce presa ao número WhatsApp de outro escritório; templates saem por ele | `router-crm.ts:787,836` · `canal-envio.ts:96` | validar canal (e contato) contra o escritório antes de criar/enviar |
| atendimento-3 | `criarLead` e `iniciarChamada` aceitam `contatoId` alheio — nome/telefone do cliente de outro escritório aparecem no Pipeline/Chamadas | `router-crm.ts:936` · `router-whatsapp-calling.ts:310` | select do contato com `escritorioId`; NOT_FOUND se não bater |
| kanban-1 | `deletarFunil` apaga colunas e cards de funil ALHEIO (só o delete do funil em si é escopado) e não limpa satélites | `router-kanban.ts:152-155` | buscar o funil com `escritorioId` antes; apagar cards por `inArray` + escritório; limpar movimentações/comentários como `deletarColuna` faz |
| kanban-2 | `criarCard`/`editarCard` aceitam `clienteId` e `responsavelId` alheios — card mostra nome/CPF de contato de outro escritório e notifica colaborador de lá | `router-kanban.ts:456,536` · `notificar-card-kanban.ts:33` | validar os dois ids (como `router-kanban-restaurar.ts:195-221` já faz); filtrar escritório nos selects de contatos |
| configuracoes-2 | `atualizarCargo` reescreve a **matriz de permissões de cargo de outro escritório** (`permissoes_cargo` só tem `cargoId`) | `router-permissoes.ts:328-343` | carregar o cargo com `escritorioId` antes do loop (como `excluirCargo` faz) |
| assinaturas-1 | `excluir` apaga os **campos posicionais** de assinatura alheia ANTES do delete escopado — o cliente do outro escritório abre o link e cai no modo legado | `router-assinaturas.ts:243-249` | buscar a assinatura com `escritorioId` primeiro (como `salvarCampos`) |
| ia-4 | `linhaTempoUnificada` devolve **cobranças** (valor, status) e processos de contato de outro escritório; sem gate financeiro | `router-atendimento-ia.ts:449,471` | validar contato pelo escritório; `eq(escritorioId)` em cobranças e processos; gate `financeiro.ver` pra pagamentos |

### B · Cobrança e assinatura do próprio JuridFlow (4)

Aqui o fix é de fluxo, não de uma linha — e um deles é decisão de produto.

| # | O que acontece | Onde | Fix |
|---|---|---|---|
| auth-1 | **Trocar de plano cancela a assinatura paga ANTES de o cliente pagar a nova.** Fechou a aba do Asaas ou pagou boleto → perde o acesso na hora e o período já pago | `subscription.ts:464-473` | só cancelar a antiga quando o webhook confirmar o pagamento da nova |
| auth-2 | **"Continuar para pagamento" no trial derruba o trial na hora** (`trialing` → `incomplete`). Sem pagar, cai no "free" e não volta (jaUsouTrial) | `subscription.ts:371-381` | manter `trialing` e gravar o vínculo; virar `active` só no webhook de pagamento |
| auth-3 | Webhook `SUBSCRIPTION_CREATED/UPDATED` promove `incomplete` → `active` **sem pagamento** (Asaas cria a assinatura já ACTIVE) | `asaas-billing-webhook.ts:137-162` · `asaas-billing-mappers.ts:23` | em eventos `SUBSCRIPTION_*` nunca promover; ativação só por `PAYMENT_RECEIVED/CONFIRMED`. Depende de quais eventos estão ligados na conta Asaas (conferir) |
| auth-x1 | **"Começar grátis" (navbar, Hero, CTA final) e cadastro via Google nunca iniciam o trial de 14 dias.** Só quem clica num plano da seção Preços ganha trial. O resto confirma o e-mail e cai em "Escolha seu plano" com limites do free — e /cadastro promete "14 dias grátis, sem cartão" | `auth.ts:750` · `AuthForms.tsx:223` · `Hero.tsx:103` | **decisão sua**: plano padrão de trial quando não veio da LP, OU botão "Testar grátis" em Meu Plano (`subscription.iniciarTrial` existe e ninguém chama) |

### C · Dinheiro errado (1)

| # | O que acontece | Onde | Fix |
|---|---|---|---|
| infra-1 | **Taxa do Asaas vira despesa DUAS vezes**: o webhook gera "Taxa Asaas — …" em todo pagamento, e o cron de extrato (24h, todo escritório com apiKey) importa `PAYMENT_FEE` de novo como outra despesa. Despesas e DRE inflados pelo dobro das taxas | `asaas-webhook.ts:372-402` · `asaas-extrato.ts:45,282` · `cron-jobs.ts:471` | no importador do extrato, pular `PAYMENT_FEE`/`REFUND_REQUEST_FEE` quando já existe despesa `origem='taxa_asaas'` da mesma cobrança |

### D · Painel admin destrutivo (1)

| # | O que acontece | Onde | Fix |
|---|---|---|---|
| admin-1 | Na ficha do cliente → Equipe → colaborador → "Excluir conta permanentemente": o diálogo mostra o nome do colaborador, mas **quem é excluído é o DONO** (usa `userId` do prop, não `current` da pilha de navegação; todas as outras ações usam `current`). Com "forçar", destrói o escritório | `AdminClients.tsx:1693-1698` (e `1630-1635`) | trocar `userId` por `current!` nas duas mutations |

### E · Integração que liga pro cliente do escritório (1)

| # | O que acontece | Onde | Fix |
|---|---|---|---|
| infra-2 | **Botão "Ligar (Twilio)" liga pro CLIENTE e toca "Olá! Esta é uma chamada de teste do sistema"** e desliga. O popup mostra "em chamada" com cronômetro. Não existe onde cadastrar o número do atendente, então a ponte é inalcançável | `twilio-client.ts:55-57` · `router-twilio.ts:43-48` · `Atendimento.tsx:214-240` | **decisão sua**: esconder o botão até a ponte existir (é remoção — precisa autorização) OU pedir o número do atendente na config e sempre montar `<Dial>` |

---

## P1 — importantes que eu faria antes do dia 10 (por causa-raiz)

Dos 117 importantes, estes grupos afetam dado de cliente/dinheiro ou
fluxo do dia a dia. Os demais estão no arquivo de achados.

### 1 · Fuso horário: o servidor usa o relógio UTC como se fosse o do escritório (11 achados, UMA causa)

Depois das 21h em Brasília o servidor já está "amanhã". Consequências
vistas pelo usuário:

- **Prazo processual aparece (e vira compromisso) no dia ANTERIOR ao vencimento** — `Movimentacoes.tsx:775` (processos-1). Num escritório de advocacia isso é o pior dos onze.
- **Rodízio acha que está "fora do expediente" das 15h às 18h** e na sexta à noite → conversa nasce sem atendente e ninguém é avisado — `db-crm.ts:1387` (atendimento-4).
- Card do Kanban fica "Atrasado" às 21h da véspera — `router-kanban.ts:424` (kanban-5); filtro "Criado em" idem (kanban-18).
- Nova cobrança com vencimento "hoje" bloqueada após 21h — `dialogs.tsx:514` (financeiro-4); despesas com data de amanhã (financeiro-5).
- Hora dos compromissos no Dashboard 3h adiantada — `dashboard.ts:428` (relatorios-3); notificação de prazo em UTC (infra-4); "Cobrança vencida" no SmartFlow à noite (smartflow-9); vencimento no admin um dia antes (admin-5); prazo sugerido um dia antes (shell-1).

Os helpers certos já existem (`inicioDoDiaNoFuso`/`fimDoDiaNoFuso`,
`dataHojeBR`) — o trabalho é aplicá-los nesses onze pontos.

### 2 · Lembretes de compromisso (4 achados)

- **Lembretes criados pelo diálogo "Novo Compromisso" (conversa/ficha) NUNCA disparam**: `dispararEm` fica NULL — `db-agendamento.ts:60` (agenda-1 / shell-x1).
- Lembrete com 2+ destinatários compara `colaboradorId` com `userId` e chega a ninguém ou à pessoa errada — `cron-disparar-lembretes.ts:116` (agenda-8 / shell-x2).
- O diálogo oferece **E-mail e WhatsApp** como canal e os dois **não existem** no cron (`cron-disparar-lembretes.ts:157-170`). A Agenda já desabilita as duas opções (`Agenda.tsx:3191`); o diálogo não — alinhar é adicionar o mesmo `disabled`, não remoção (shell-2 + T1).
- Editar um compromisso vaza os lembretes pro próximo editado (agenda-10).

### 3 · Telefone com DDI (6 achados, uma causa)

Contato do WhatsApp é gravado `5585…`; várias telas cortam os 11 primeiros dígitos ou prefixam 55 de novo:

- `maskPhoneBR` local do Atendimento não corta o DDI → **o deep-link `?telefone=` que subiu ontem, quando cai no telefone do cadastro, preenche `(55) 85997-9657` e o envio vai pra número inválido** — `Atendimento.tsx:471` (atendimento-x1). Consequência direta da mudança de ontem; fix de uma linha: delegar pra `mascararTelefoneBR` do shared.
- Novo Cliente grava número errado (clientes-1); Novo Lead sem DDI nunca casa com o WhatsApp → contato duplicado (atendimento-6); `wa.me` com 55 duplicado (agenda-9) ou sem 55 (assinaturas-8, clientes-x2).

### 4 · Permissão que libera demais ou de menos (9)

- **`verProprios` do Financeiro libera o escritório inteiro** em quase todas as procedures — `router-financeiro.ts:72` (financeiro-6); Painel Geral mostra o caixa pra quem não tem Financeiro (relatorios-x1).
- **Cadastro apaga conta existente de quem ainda não criou escritório — sem login** — `auth.ts:312` (auth-8); colaborador removido e reconvidado não entra (auth-9).
- `atribuirCargo` aceita cargo de qualquer escritório e permite atribuir "Dono" (configuracoes-6); funil/colunas do Kanban sem gate nenhum (kanban-17); `smartflow.atualizar` reescreve passos de cenário alheio (smartflow-1); `atualizarLead`/`atualizarConversa` aceitam responsável/atendente de fora (atendimento-x3/x4).
- Ficha abre pelo lead, mas Salvar e "Fechar contrato" recusam — `atualizar`/`registrarFechamento` não consultam o lead, só o cadastro (clientes-x3). A liberação de ontem cobriu quem ATENDE; quem é responsável por LEAD continua no impasse.

### 5 · Clique que falha em silêncio (26 sites — T2)

`main.tsx:149` só trata erro de autenticação; **não há toast global**. 26
mutations chamam `.mutate(` sem `onError`: Resolver/Fechar conversa
(`Atendimento.tsx:1953`), ligar/desligar cenário do SmartFlow (`SmartFlow.tsx:115` —
o usuário acha que desligou o bot), excluir tarefa, cancelar convite,
desconectar canal Meta, excluir tag do Kanban (kanban-13, sem confirmação),
pausar monitoramento… Fix único e sem remoção: `MutationCache({ onError })`
no QueryClient dando toast quando a mutation não tem `onError` próprio.

### 6 · Kanban (5 além dos acima)

Limpar CNJ/descrição/prazo não salva mas o toast diz "atualizado" (kanban-4);
flag "Atrasado" nunca desliga (kanban-6); "Excluir coluna" promete não afetar
cards e apaga todos (kanban-7); lixeira no hover apaga sem confirmar (kanban-8);
prazo vazio vira 15 dias e o card nasce "Atrasado" (kanban-x1); tags do card
sobrescrevem as do cadastro (kanban-12).

### 7 · Processos e Cofre (5)

Mesmo CNJ monitorado duas vezes = **crédito cobrado em dobro** (processos-9);
importação ignora limite do plano e cobra crédito por cada (processos-8);
"Cadastrar e testar login" não testa e a credencial some dos seletores
(processos-5); menu do card nunca mostra Pausar/Reativar (processos-2);
credencial TRF validada contra o TJCE (processos-6) — junto com a pendência
do dono de criar os cadastros nos TRFs.

### 8 · Admin: planos hardcoded × catálogo (4)

"Trocar plano" só lista os 4 antigos (admin-3); criar cupom com plano do
catálogo falha (admin-4); "Últimas assinaturas" mostra "Plano" genérico
(admin-6); LTV zera pros planos novos (admin-7). Os planos do superlançamento
são todos do catálogo.

### 9 · Outros que engessam fluxo comum

Cliente quitado aparece "sem cobrança" na lista (lê `recebido`, servidor
manda `pago` — clientes-x1); `RECEIVED_IN_CASH` não conta como pago
(clientes-8); toggle "Ativar imediatamente" do agente não faz nada (ia-1);
aba "Meus" agentes sempre vazia (ia-2); "Clonar p/ escritório" e
`clonarTemplate` consultam módulo inexistente `agentes_ia` → FORBIDDEN pra
gestor (ia-3 / infra-3); aba Comercial do Dashboard quebra com TypeError
sem colaborador comercial (relatorios-1); colaborador sem plano cai em aba
que não existe (auth-7); segundo clique em assinar cria outra assinatura no
Asaas (auth-11); no celular todo mundo é redirecionado pra /atendimento
antes das permissões carregarem (shell-3).

---

## P2 — menores (105)

Textos que prometem o que não existe, contadores que não batem com a lista,
`confirm()` nativo em 18 lugares (anti-pattern registrado), tela de erro
global em inglês com stack trace, "SaaS de Cálculos" na tela pós-logout,
etc. Lista completa no arquivo de achados. Não seguram o lançamento.

---

## Só o dono pode fazer (fora do código)

- **Railway (produção)**: conferir o App Secret da Meta **no painel admin**
  (Integrações → WhatsApp Cloud) ou em `META_APP_SECRET_EXTRA` — é isso que
  alimenta o HMAC do webhook, que está em modo brando sem ele (`META_APP_SECRET`
  de env é do Embedded Signup e NÃO vale pro HMAC); `TURNSTILE_SECRET_KEY` (captcha
  fail-open sem ele), `SENTRY_DSN_BACKEND`, `RESEND_API_KEY` + `FROM_EMAIL`
  (apontando pro endereço certo), `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`
  (push), `ENCRYPTION_KEY` + `CANAIS_ENCRYPTION_KEY`, `APP_URL`. Só
  `JWT_SECRET` e `DATABASE_URL` derrubam o boot se faltarem — o resto falha
  em silêncio.
- **Asaas**: quais eventos de webhook estão ligados (decide o auth-3).
- **Tribunais**: criar os cadastros (TRF1/2/3/6 e os estaduais com "login
  falhou") e rodar "Testar tudo". *03/09: o dono está fazendo e está dando
  certo — resolvido.*
- **Meta**: 14 dias sem disparo frio até ~05/09; não clicar "solicitar
  análise" antes; mandar o print do aviso 2 e o Quality Rating.
- **Termos v2**: revisão jurídica.
- **Decisões deste relatório**: auth-x1 (trial padrão × botão), infra-2
  (esconder Twilio × implementar ponte), e a ordem abaixo.

---

## Ordem que eu proponho (7 dias)

1. **Dia 1–2 · P0-A (8 amarrações de escritório) + admin-1 + infra-1.** Sem
   mudança de tela, sem mockup. Testes por mutação em cada um.
2. **Dia 2–3 · P0-B (assinatura/trial).** auth-1, auth-2, auth-3 são fluxo
   de servidor; auth-x1 precisa da sua decisão e, se for botão, de mockup.
3. **Dia 3–4 · P1-1 (fuso) + P1-2 (lembretes) + P1-3 (DDI) + P1-5 (toast global).**
   Quatro causas-raiz, muitos sintomas de uma vez.
4. **Dia 5 · P1-4 (permissões) + infra-2 (Twilio, com sua decisão).**
5. **Dia 6 · P1-6 a P1-9**, na ordem que você preferir.
6. **Dia 7 · reserva** pra regressão e pro que aparecer no seu teste.

Cada entrega segue a regra: `pnpm check` + testes 100% + build quando muda
client, merge em develop e main, mutações conferidas.
