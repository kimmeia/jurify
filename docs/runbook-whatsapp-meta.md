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

## Pendências externas (estado em 14/jul/2026)

- [ ] Acesso avançado do app `1295...` (Análise do App) — destrava o 1-clique.
- [ ] Access Verification (após aprovação, ~5 dias úteis).
- [ ] Apelação da conta antiga banida — protocolo `#2655121:WBxP-849705580-840938876`.
      NÃO clicar "Já resolvi" no banner até a Meta reinstaurar.
- [ ] Remover inscrição do app legado `1641...` das WABAs.
