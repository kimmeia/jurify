# Runbook — WhatsApp Cloud API (Meta) no JuridFlow

Registro operacional do incidente de jul/2026 (ban da conta + 1 dia de
diagnóstico de recepção) e dos procedimentos que evitam repetir cada erro.

## Arquitetura (quem é quem)

| Peça | Valor | Papel |
|---|---|---|
| App da plataforma | **JuridFlow App — `1295936199370409`** (business Devular `1312369217176044`) | Webhook (`https://juridflow.com.br/api/webhooks/whatsapp`), HMAC, Embedded Signup, tokens de canal |
| App CRM SaaS | Devular App — `1339360448088196` | OUTRO produto. Não usar aqui |
| App legado | "Juridflow" — `1641836240205895` (BM do cliente Boyadjian) | Sem papel. Remover inscrição dele das WABAs quando possível (evita entrega duplicada futura) |
| Credenciais do app | **Admin → Integrações → WhatsApp Cloud** (App ID + App Secret + Verify Token) | É o que valida o HMAC do webhook. Env `META_APP_ID`/`META_APP_SECRET` têm prioridade se setadas; `META_CONFIG_ID` (Railway) é do Embedded Signup |
| Por canal | token + phoneNumberId + wabaId criptografados em `canais_integrados` | Envio + chamadas Graph |

## Onboarding de número de cliente

### Caminho 1 — Embedded Signup ("Conectar com Facebook") — preferido
Requer o app da plataforma com **acesso avançado** aprovado
(`whatsapp_business_messaging` + `whatsapp_business_management`).
1 clique: cria vínculo entre businesses, token, inscrição de webhook. Fim.

### Caminho 2 — Manual (enquanto o acesso avançado não sai)
Cada passo abaixo existe porque a falta dele causou falha real:

1. **Parceria da WABA** (sem isso: recebe nada, silenciosamente):
   BM do cliente → Contas do WhatsApp → WABA → **Atribuir parceiro** →
   business da Devular (`1312369217176044`) → controle total.
2. **Ativos no usuário do sistema da Devular** (sem isso: envio falha #200):
   BM Devular → Usuários do sistema → atribuir **a WABA compartilhada** +
   o **app JuridFlow** (controle total).
3. **Gerar token NOVO** pelo usuário do sistema, escolhendo o app
   `1295936199370409`, escopos `whatsapp_business_messaging` +
   `whatsapp_business_management`, expiração "Nunca".
   ⚠️ Token NÃO herda ativos atribuídos depois da emissão — mudou ativo,
   gera token novo.
4. **Validar o token** em https://developers.facebook.com/tools/debug/accesstoken
   → *Granular Scopes* → `whatsapp_business_messaging` deve listar a WABA.
   (O cadastro manual do JuridFlow também valida app do token e escopo
   granular automaticamente e recusa com mensagem explicativa.)
5. **Cadastrar no JuridFlow**: Configurações → Canais → "cadastrar WhatsApp
   Cloud manualmente" (token + phoneNumberId + wabaId).
6. **Registrar na Cloud API (PIN)** se o número estiver "Pendente" no
   WhatsApp Manager. Erro de PIN → desativar verificação em duas etapas do
   número, aguardar ~5 min, registrar.
7. **Re-inscrever webhooks** no card do canal (faz DELETE+POST limpo e
   acusa app errado/override).
8. **Teste real**: mensagem de outro celular → deve aparecer no Atendimento
   e no Deploy Logs (`[WhatsApp Cloud] webhook recebido`).

## Diagnóstico de "não recebe mensagem" (na ordem)

1. **Deploy Logs**: há `webhook recebido` no minuto do teste?
   - Sim + "número não conectado — ignorada" → phoneNumberId do canal difere.
   - Não → passo 2.
2. **HTTP Logs**: há `POST /api/webhooks/whatsapp`?
   - `401` → App Secret do Admin não bate com o app que assinou.
   - Nada → Meta não entrega: verificar (a) campo `messages` assinado no
     app, (b) WABA inscrita no app (`GET {waba}/subscribed_apps`),
     (c) parceria da WABA com o business da Devular, (d) número "Conectado"
     (não "Pendente") no WhatsApp Manager.
3. **Remetente**: mensagem com ✓✓? Só ✓ = nem chegou na Meta (chat velho em
   cache — testar de outro aparelho/chat novo).
4. Botão **"Testar"** do campo `messages` no painel do app prova o callback
   (ele ignora vínculos de WABA — sucesso nele NÃO garante evento real).

## Anti-ban (o que já está no código)

- Guard em TODO envio (texto/template/interativo/manual): disjuntor
  persistido, teto diário pelo tier da Meta, rate limit, opt-in.
- Throttle + reagendamento nos disparos em massa (scheduler de cobranças e
  `para_cada_item`).
- Webhook `account_update` (restrição de conta) e
  `phone_number_quality_update` (qualidade/tier) tratados.
- Health-check horário (`whatsapp-health-check.ts`): qualidade caindo gera
  alerta ANTES do ban; número restrito pausa o canal proativamente.
- Regra operacional: cobrança = template **UTILITY** pra cliente com
  relação transacional. Disparo frio em massa = o que derrubou a conta.

## Opt-in / Opt-out (política Meta)

O que a política exige, literalmente: opt-in antes de mensagem iniciada
pela empresa (método livre — "solely responsible for the method"; contrato
vale) e honrar TODO pedido de opt-out ("either on or off WhatsApp").

Como o sistema implementa:
- **Opt-out**: contato responde `SAIR`/`PARAR`/`STOP` (palavra isolada) →
  marcado, confirmação única enviada, TODOS os proativos bloqueados pelo
  guard (motivo visível na execução). `VOLTAR` reativa. Pedido por outro
  canal → toggle manual no contato (`crm.definirOptOutWhatsapp`, origem
  auditável). Opt-out NÃO afeta respostas quando o contato inicia conversa.
- **Opt-in documental**: primeiro inbound registra `optInWhatsappEm`
  ("iniciou conversa"). Atestado manual/contrato via mesma mutation.
  NÃO participa do gate de envio (rastro LGPD).
- **Janela de 24h**: envio manual de texto/mídia fora da janela (24h após
  a última mensagem DO CLIENTE) é bloqueado na origem com instrução de
  usar template — fora da janela a Meta rejeitaria com 131047 e a bolha
  "enviada" morreria no vácuo.
- Operacional (escritório): cláusula de consentimento WhatsApp no contrato
  padrão + rodapé "Responda SAIR para não receber avisos" nos templates.

## Bloqueio do APP (Login "Recurso indisponível") — prevenção

- **Data Use Checkup é ANUAL** — não responder = Login suspenso (foi o que
  travou o Embedded Signup). Responder em Ações necessárias/alertas.
- Política de Privacidade do app sempre no ar.
- ≥2 admins no app; checar a Caixa de Entrada de alertas mensalmente.

## Coexistência (CoEx) — número no app do celular E na API

CoEx = Embedded Signup com `featureType: "whatsapp_business_app_onboarding"`
(pareamento por QR). O número segue no app WhatsApp Business do celular e
simultaneamente na Cloud API. Ground truth: `is_on_biz_app` do
`GET /{phone_number_id}`, persistido como `isOnBizApp` na config do canal
(⚠️ o `coexMode` legado era hardcoded "true" pra TODA conexão — não é sinal).

### Checklist do painel Meta (App Dashboard) — obrigatório pro CoEx

1. **Webhook fields**: WhatsApp → Configuration → assinar, além de
   `messages`/`account_update`/`phone_number_quality_update`/`calls`:
   - `smb_message_echoes` — mensagens que o atendente envia PELO CELULAR
   - `history` — histórico (até 6 meses, requer consentimento no QR flow)
   - `smb_app_state_sync` — contatos do celular
   (`POST /{waba}/subscribed_apps` NÃO escolhe fields — é app-level, no painel.)
2. **Configuration do Embedded Signup** (`META_CONFIG_ID`): qualquer
   Configuration padrão de WhatsApp ES serve — o sub-fluxo CoEx é ativado em
   runtime pelo `featureType` que o client já envia.

### O que o código já cobre

- Echo do celular (`smb_message_echoes`): ingestão SILENCIOSA — timeline como
  saída `origem='celular'`, dedup por wamid, conversa vira `em_atendimento`
  (bot não fala por cima do humano). Nunca dispara SmartFlow/auto-reply.
- `PARTNER_REMOVED` (app desinstalado, ~14 dias sem abrir, troca de número,
  re-registro): canais da WABA viram `desconectado` com motivo + alerta.
- Registro: canal CoEx sai com `registradoCloudApi=true` (QR já registra);
  `/register` com PIN é RECUSADO pra CoEx (desfaria o pareamento).
- Calling API: bloqueada pra CoEx (chamadas ficam no app do celular) — UI
  explica em vez de oferecer switch quebrado.

### Ainda NÃO coberto (fase 2)

- `history` e `smb_app_state_sync`: sem handler (logados como "campo sem
  handler"). Import de histórico exige backdating em `enviarMensagem`
  (createdAt custom) + rastreio de progresso — sem isso, janela de 24h de
  contatos pré-CoEx começa fechada (template-only até o cliente responder).
- Regras Meta a comunicar no onboarding: app ≥ 2.24.17, número ativo ≥ 7
  dias, abrir o app a cada ~14 dias, throughput reduzido, broadcast
  read-only, grupos indisponíveis na API.

## App Review — roteiro de submissão (estado em 23/jul/2026)

Caso de uso "Conectar-se com clientes pelo WhatsApp" do app `1295936199370409`.
Estado dos testes: `whatsapp_business_messaging` ✅ · `whatsapp_business_management` ✅ ·
`public_profile` com 1 chamada registrada (vira Concluída em até 24h; **teste
vale 30 dias** — enviar dentro da janela).

### Antes de enviar

1. **Remover do caso de uso** (Casos de uso → Personalizar → Remover):
   `manage_app_solution` (só pra soluções multiparceiro com BSP — não temos) e
   `whatsapp_business_manage_events` (eventos de conversão pra anúncios — não
   usamos e conflita com sigilo/LGPD; mesma família da chave "Identificar
   pedido/lead" que fica DESLIGADA na WABA). Permissão sem uso demonstrável é
   motivo clássico de reprovação; se precisar um dia, pede de novo.
2. Configurações do app → Básico: ícone carregado, categoria, URLs de
   privacidade/termos/exclusão (já no ar: `/privacidade`, `/termos`,
   `/privacidade#exclusao-de-dados`).
3. Central de Segurança do BM **Devular**: verificação da empresa concluída.
4. Data Use Checkup sem pendência (Ações necessárias/alertas).

### Textos de justificativa (submeter em inglês)

`whatsapp_business_messaging`:
> JuridFlow is a CRM/customer-service platform for law firms in Brazil. Each
> law firm connects its own WhatsApp Business number via Embedded Signup. We
> use whatsapp_business_messaging to (1) receive client messages via webhooks
> and display them in the firm's support inbox, and (2) send replies within
> the 24-hour customer service window, plus opted-in utility template
> notifications (e.g. appointment and payment reminders). The platform
> enforces opt-out handling (STOP keywords), the 24-hour window, and
> per-number daily sending limits.

`whatsapp_business_management`:
> Used during onboarding and operation of each law firm's WABA: subscribing
> our app to the WABA's webhooks after Embedded Signup, reading phone number
> status/quality rating to display account health, registering the phone
> number on Cloud API, and managing message templates the firm uses for
> opted-in notifications.

### Instruções de teste pro revisor

Criar usuário demo em escritório de teste e informar no formulário:
> Log in at https://juridflow.com.br with the provided credentials →
> Configurações → Canais shows the connected WhatsApp number → Atendimento
> shows the inbox where messages arrive and replies are sent.

Se pedir screencast: gravar Embedded Signup + troca de mensagem no
Atendimento (2–3 min, sem áudio serve).

### Depois da aprovação

1. Access Verification (~5 dias úteis).
2. Embedded Signup destrava pra clientes reais; CoEx passa a funcionar —
   assinar os webhook fields de CoEx (seção "Coexistência" acima).

## Pendências externas (estado em 14/jul/2026)

- [ ] Acesso avançado do app `1295...` (Análise do App) — destrava o 1-clique.
- [ ] Access Verification (após aprovação, ~5 dias úteis).
- [ ] Apelação da conta antiga banida — protocolo `#2655121:WBxP-849705580-840938876`.
      NÃO clicar "Já resolvi" no banner até a Meta reinstaurar.
- [ ] Remover inscrição do app legado `1641...` das WABAs.
