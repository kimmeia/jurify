# Auditoria completa do sistema — 18/08/2026

Varredura módulo a módulo: 68 routers tRPC, 10 crons, 6 rotas HTTP diretas,
~235 mil linhas fora de teste. Foco pedido pelo dono: políticas das APIs
externas, vazamento entre escritórios (LGPD), segurança cibernética,
construtor de fluxos e permissões de módulo.

Método: métrica por router (procedures × filtros de tenant × gates), caça a
query por id sem amarração de escritório (165 candidatos, todos verificados
um a um), leitura dirigida dos módulos sensíveis.

## Corrigido DURANTE a auditoria (já em produção)

| # | Achado | Gravidade | Fix |
|---|--------|-----------|-----|
| 1 | `agenda.listarLembretes` devolvia lembretes de QUALQUER escritório por id de agendamento (a tabela não tem escritorioId; remover fazia o join, listar não) | Alta (LGPD) | join com o pai + teste |
| 2 | Conectar WhatsApp/Instagram/Messenger, registrar número e reinscrever webhook eram `protectedProcedure` puro — qualquer colaborador trocava o canal do escritório | Alta | gate `configuracoes.editar` (mesma régua do whatsapp-cloud-services) |
| 3 | `customer360.getContext` entregava cobranças/valores sem checar `financeiro.ver` — a permissão do módulo tinha porta lateral | Alta | bloco financeiro condicionado; `oculto: true` pra UI explicar |
| 4 | Webhook do SmartFlow: URL sem validação + POST do contexto inteiro (nome, telefone, pagamento) + sem timeout → SSRF pra dentro da infra | Alta | validação de destino, redirect bloqueado, teto 10s |

## Achados ABERTOS, por prioridade

### P0 — mexem com dado de cliente ou dinheiro

1. **Política de privacidade não menciona OpenAI/Anthropic.** O sistema envia
   teor de decisão judicial, nomes de clientes e trechos de conversa de
   WhatsApp pras APIs de IA (resumir-movimentacao, atendimento-ia, agentes,
   JurisIA). LGPD exige listar operadores. A página já lista Asaas e Meta; os
   provedores de IA ficaram de fora. **Texto é jurídico — dono revisa antes
   de publicar.** Vale citar também: dados da API OpenAI/Anthropic não são
   usados pra treino por padrão (política das APIs), retenção limitada.
2. **HMAC da Meta em modo brando.** Sem App Secret cadastrado em
   admin_integracoes, o webhook ACEITA request com warning no log. Forjar
   mensagem recebida vira possível. Endurecer: em produção, sem secret =
   rejeitar (ou alarme vermelho no painel admin, não warning de log).
3. **Robô de jornada varre em 32s** — o dono já apontou que está errado.
   Instrumentação subiu (tempos por tela, "X de 19 mostraram esqueleto");
   falta olhar a primeira medição real e agir. Se "mostraram esqueleto" = 0,
   a espera ainda olha cedo demais.

### P1 — segurança/robustez com caminho claro

4. **CSP desligado no Helmet** (documentado como "PR dedicado pós-lançamento"
   que nunca veio). XSS hoje roda sem freio de política.
5. **Body-parser aceita 3GB em base64, em memória.** Upload concorrente
   derruba o Node (OOM) — o próprio comentário do código admite. Caminho: S3
   presigned/multipart (já planejado como P2 do relatório antigo; a migração
   pro S3 dos anexos financeiro já existe — estender).
6. **Conferências do robô de jornada não rodam pelo painel** — só pelo spec
   Playwright. São elas que pegariam os bugs desta sessão (tela abre, dado
   errado). Ligar `CONFERENCIAS` no executor do servidor.
7. **Agendamento do robô de jornada** — staging de hora em hora + botão
   manual já existe; cron nunca foi criado.
8. **DNS rebinding no webhook do SmartFlow** — a validação atual cobre URL
   interna direta; completa exige resolver e conectar no IP validado.

### P2 — consistência e produto

9. **Roadmap expõe nome de usuário entre escritórios** (`ultimosVotos.userName`
   e `autorNome`). Feature global de propósito, mas nome completo de usuário
   de outro tenant é dado pessoal. Trocar por iniciais ou primeiro nome.
10. **`push.desinscrever` remove por endpoint sem checar dono** — endpoint é
    imprevisível (URL longa do push service); risco baixo, correção trivial.
11. **Assinaturas digitais sem gate de módulo** — qualquer colaborador cria/
    cancela pedido de assinatura (tenancy ok). Sugestão: `clientes.editar`.
12. **Padronizar o seletor de credencial** — feito em processos.ts (5 cópias
    viraram 1); conferir se sobra cópia em outros módulos (motor usa
    recuperarSessao, ok).
13. **SmartFlow — blocos que faltam** (análise de produto, decidir com o dono):
    - enviar **e-mail** (hoje só WhatsApp; Resend já integrado)
    - **criar tarefa/prazo** na Agenda além de `agenda_criar` genérico
    - **notificar equipe** (push/sino interno) — hoje só se notifica cliente
    - **criar contato** (crm_buscar existe; criar quando não acha, não)
    - **gerar documento** a partir de modelo (modelos-contrato já existe)
14. **SmartFlow — redundâncias aparentes** (verificar antes de mexer):
    - condições `janela_horario` × `horario_entre` × `dia_semana` se sobrepõem
      (as duas últimas são casos da primeira) — candidatas a fundir no editor
    - triggers `whatsapp_mensagem` × `mensagem_canal` (o segundo generaliza o
      primeiro; o primeiro parece legado)
15. **Ponto do colaborador** (espelho próprio, pausa de almoço) — segue em
    aberto por decisão do dono.
16. **32s → cache de fontes?** Investigar se `document.fonts.ready` e cache de
    assets explicam telas montando "instantâneo" na segunda visita.

### Registro do que está saudável (pra não re-auditar à toa)

- SSE autentica pelo cookie e ignora `?userId` (comentário no código já
  documenta o porquê).
- `/uploads` com auth + tenancy por path; exceção pública só `/pareceres/`
  (capability URL com 64 bits de aleatório).
- Tokens de convite/assinatura/reset: 32 bytes aleatórios.
- Webhooks Asaas (ambos) validam `asaas-access-token` contra o secret salvo.
- Segredos com AES-256-GCM; `ENCRYPTION_KEY` obrigatória em produção.
- Senha com scrypt; rate-limit em login (IP+email) e signup.
- `adminProcedure` exige `role === "admin"` estrito.
- Cofre: todas as 13 procedures com gate `exigirAdminProcessos`, exceto
  `listarParaSelecao` (de propósito, dropdown user-level).
- Janela de 24h da Meta respeitada no envio manual e no disparo frio;
  opt-out (sair/parar/stop) implementado; monitor de saúde do canal existe.
- `subscription.cancel/changePlan` usam a assinatura própria (sem herança) —
  colaborador não cancela o plano do dono.
- Backup do escritório: só dono canônico (`ownerId`), imune a cargo
  personalizado.
- Drizzle parametriza `sql\`\`` — sem injeção nos usos atuais.
- Engine do SmartFlow: 26 tipos de bloco, todos com handler (sem bloco
  fantasma no editor); teto de 50 passos contra loop.

## Adendo — conformidade Meta verificada caminho a caminho (2ª passada)

A primeira passada registrou que os mecanismos existem. Esta responde a
pergunta certa: **cada caminho de envio passa por eles?** Verificado no
código, arquivo e linha.

### O funil

Todo envio converge pra `canal-envio.ts` (texto, interativo e template), e os
três chamam `podeEnviar`/`podeDispararTemplate` do `whatsapp-envio-guard.ts`
passando `contatoId` + `telefone`. O guard tem 5 travas: disjuntor de
restrição da Meta (códigos 131031/368/131048), teto diário por tier
(250/1k/10k/100k), rate de rajada, **opt-out** e **opt-in**.

### Opt-out (política "respect all requests to opt out")

- **Captura**: cliente responde SAIR/PARAR/STOP → `whatsapp-handler.ts:192`
  grava `contatos.optOutWhatsapp` com data e origem, e **envia confirmação**.
  VOLTAR desfaz, também com confirmação. Atendente pode marcar/desmarcar na
  mão pelo CRM.
- **Enforcement**: `podeEnviar` bloqueia QUALQUER envio `proativo` pra contato
  em opt-out — e resolve o contato pelo telefone quando o caller não passou o
  id, justamente pra ninguém "esquecer" (`whatsapp-envio-guard.ts:388-409`).
  Resposta a conversa iniciada pelo cliente (proativo=false) não é afetada,
  como a política permite.

### Opt-in (mensagem iniciada pela empresa)

- **Captura**: primeiro inbound do contato grava opt-in com origem
  ("iniciou conversa") — `whatsapp-handler.ts:176`.
- **Critério de consentimento** (`contatoTemConsentimento`): já mandou
  mensagem OU é cliente Asaas (relação transacional — base pro template de
  cobrança utility). `exigirOptin: true` no disparo frio do CRM e no template
  automático do SmartFlow.
- ⚠ **Item operacional fora do código**: a categoria do template (utility ×
  marketing) é definida por quem cria o template no painel da Meta. Cobrança
  em template marketing fura o racional do consentimento transacional —
  orientar na UI de templates.

### Janela de 24h

- Envio manual de texto livre: bloqueado fora da janela com mensagem
  orientando usar template (`router-crm.ts:499`).
- Cobranças e disparos automáticos: saem por **template**, que é o caminho
  correto fora da janela.

### Matriz caminho × travas (verificada, não presumida)

| Caminho de envio | passa pelo funil | opt-out | opt-in |
|---|---|---|---|
| CRM envio manual | ✔ (proativo=false qd resposta) | ✔ | ✔ no disparo frio |
| CRM iniciar conversa (frio) | ✔ | ✔ | ✔ `exigirOptin` |
| SmartFlow whatsapp_enviar / interativo / template | ✔ canal-envio | ✔ | ✔ template com `exigirOptin` |
| Scheduler de cobranças | ✔ (canal no pré-loop; contatoId por cobrança) | ✔ | via relação Asaas |
| Resumo diário (WhatsApp) | ✔ template | n/a (vai pro próprio dono) | n/a |
| Chamada (Calling API) | ✔ guard próprio | ✔ | ✔ |
| Lembretes de agenda por WhatsApp | **não envia** | — | — |

### Bug de produto achado nesta passada

**Lembrete por WhatsApp é oferecido na UI da Agenda e não existe no cron.**
`Agenda.tsx:2487` lista o canal; `cron-disparar-lembretes.ts:168` loga
"canal whatsapp não implementado" e segue. O usuário escolhe WhatsApp,
confia, e nada sai — falha silenciosa da mesma família do "erro que só
vive no response". Corrigir: ou implementar (via canal-envio, template,
guard completo) ou remover a opção da UI até existir. → entra como P1.
