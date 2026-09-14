# Auditoria de resiliência — 14/09/2026

Três varreduras paralelas (envio WhatsApp, recepção de webhook, credenciais
Meta, resiliência de jobs) pedidas depois da restrição da WABA do Boyadjian.
Conclusão de escopo: **nenhum achado aqui causou aquela restrição** — a causa
foi vínculo com portfólio banido (ver `runbook-whatsapp-meta.md`). O que segue
é risco independente, encontrado ao procurar.

Corrigido no mesmo dia: disjuntor que se auto-desarmava (`4b0792e`) e
reconexão que não limpava a restrição (`meta-channels.ts`).

## P0 — Dinheiro e perda silenciosa

1. **Cobrança mensal de monitoramento sem guarda de concorrência** —
   `cron-monitoramento.ts:725-800`. Read-modify-write do saldo em JS, sem
   `WHERE ultimaCobrancaEm = <lido>` e sem `saldo = saldo - custo` em SQL.
   Dois processos no mesmo tick = cobrança dupla, ou débito único com duas
   linhas no extrato. Sem try/catch por item: erro no escritório 3 aborta
   4..N. É o único job de dinheiro sem nenhuma trava.
2. **Reset de cota mensal com o mesmo padrão** —
   `escritorio-creditos.ts:261-304`. Crédito concedido duas vezes; `select()`
   sem LIMIT sobre a tabela inteira; sem catch por item.
3. **Comissão órfã em `em_andamento`** — `db-comissoes.ts:774-795`. Restart
   no meio do fechamento deixa a linha reservada para sempre: aquele
   atendente/período nunca fecha, sem alerta. Só `falhou` é recuperável.
   Falta lease com expiração (o padrão certo existe em
   `fila-ingestao.ts:272`).
4. **Erro de banco no roteamento descarta a mensagem** —
   `whatsapp-cloud-webhook.ts:119-141`: `catch {}` vazio faz qualquer falha
   transitória virar `null`, lido como "número não conectado" (:678). O 200
   já saiu, a Meta não reentrega. Um blip de 2s = mensagens daquela janela
   perdidas, e o log manda o suporte olhar a configuração do canal.
5. **Falha no download de mídia deixa o bot MUDO** —
   `whatsapp-cloud-media.ts:109-120` devolve `null` sem retry, e o `mediaId`
   não é persistido (irrecuperável após ~5 min). Sem `mediaUrl` não há
   transcrição; sem transcrição `textoFluxo` fica vazio
   (`whatsapp-handler.ts:309-320`) e **nem o auto-reply do canal sai**. O log
   culpa o Whisper.
6. **Documento, vídeo e imagem sem Vision nunca disparam resposta** — mesmo
   `textoFluxo`. Cliente manda o PDF do processo ou foto do RG com legenda e
   recebe silêncio absoluto.
7. **Banco fora desliga o HMAC** — `whatsapp-cloud-webhook.ts:77-79` devolve
   `appSecret: ""` no catch, e `meta-signature.ts:85-87` trata lista vazia
   como "sem secret configurado" (`ok: true`). Durante indisponibilidade do
   banco o webhook aceita POST forjado.

## P1 — Canal morre e ninguém vê

8. **Canal `banido`/`desconectado` some da tela** —
   `Configuracoes.tsx:1742-1793` monta card só para `conectado` e `erro`. O
   escritório vê "Conecte seu WhatsApp", como se nunca tivesse conectado.
9. **`restritoMeta` não é lido por nenhum componente de Configurações** —
   card verde "Conectado" com 100% dos envios bloqueados. Só o Atendimento
   sinaliza (`Atendimento.tsx:1519`).
10. **Falha transitória da Graph API marca "banido"** —
    `whatsapp-cloud.ts:583-595` devolve `contaOk: false` para timeout, 500 ou
    DNS. `avaliarSaude` por desenho nunca limpa, e o loop só varre canais
    `conectado` (`whatsapp-health-check.ts:88`): sem volta automática.
11. **Token de Instagram/Messenger expira em ~1-2h e nunca é renovado** —
    `fb_exchange_token` não existe no repo; health-check só olha
    `whatsapp_api`. Canal fica "Conectado" para sempre, morto.
12. **Erro 190 (parceria/token revogado) sem tratamento** — não é reconhecido
    em `explicarErroRegister` nem em `detectarRestricaoMeta`. Chega até 1h
    depois pelo health-check, rotulado "⛔ restrição da Meta": o dono abre
    ticket na Meta quando ele mesmo revogou o acesso no BM.
13. **Inscrição na WABA nunca é verificada** — `subscribed_apps` é escrita em
    4 pontos, todos best-effort, e `webhooksInscritos: false` não é
    persistido. Canal verde + qualidade GREEN + app não inscrito = atendimento
    vazio sem nenhum sinal.

## P1 — Duplicação

14. **Sem unique index em `mensagens.idExterno`** — `schema.ts:911` é índice
    simples. O dedup é SELECT-then-INSERT (`whatsapp-handler.ts:39-45`) com
    dezenas de segundos de janela (download + Whisper no meio). Entregas
    paralelas da Meta = duas bolhas e dois disparos de SmartFlow. O padrão
    certo já existe no repo (`chamadas_callid_uq`, `asaas_wh_ev_uq`).
15. **Contato e conversa duplicados** — `whatsapp-handler.ts:54-109` sem
    transação nem lock; `contatos` não tem unique `(escritorioId, telefone)`
    e `conversas.chatIdExterno` não tem índice. Duas mensagens simultâneas de
    número novo criam duas threads: o atendente responde uma e nunca vê a
    outra.
16. **Check-then-act em 5 jobs de notificação** — resumo diário
    (`cron-resumo-diario.ts:311`), trials (`trial-cron.ts:120`), reenvio de
    e-mail (`email-limite.ts:256`), notificação de prazo (`cron-jobs.ts:85`),
    lembretes de agenda (`cron-disparar-lembretes.ts:76`, marca sem
    `WHERE enviado=false`). Manda primeiro, registra depois. O padrão certo
    está em `cron-relatorios-programados.ts:153` (reserva antes).

## P1 — Escala

17. **`notificarPrazos` a cada 5 min sem LIMIT nem piso de data** —
    `cron-jobs.ts:69-170`. Atrasados acumulam para sempre; cada linha custa 2
    queries. Com 5.000 pendências são 10.000 queries a cada 5 minutos, e não
    há guarda de reentrada.
18. **Jobs rodam em todo processo, sem eleição de líder** — `index.ts:318`.
    Não é só questão de escalar: o deploy do Railway é sobreposto, então
    **todo deploy** roda dois conjuntos de jobs por alguns segundos.
19. **Rate limits em memória** — o do Asaas (`asaas-rate-guard.ts:54,58`)
    protege 30 concorrentes por processo contra um limite real de 50: dois
    processos estouram e o escritório leva bloqueio de 12h. O de disparo
    WhatsApp (`whatsapp-envio-guard.ts:154`) dobra o teto anti-ban. SSE
    (`sse-notifications.ts:53`) só alcança quem está no mesmo processo.
20. **Sem handler de SIGTERM** — deploy mata job em voo sem finally.

## Segurança

21. **`obterAutoReplyCanal` sem `escritorioId`** — `db-canais.ts:192-204`,
    exposto por `configuracoes.obterAutoReply`. Enumerando ids, um usuário lê
    o auto-reply de qualquer escritório. Único furo cross-tenant encontrado.
22. **`whatsappCoex.exchangeCode` sem gate de permissão** —
    `whatsapp-coex.ts:38-138`, montada em `routers.ts:157`. Qualquer
    colaborador logado aponta o canal do escritório para uma WABA própria.
    Nenhuma tela chama; o endpoint está vivo.
23. **`verificarRegistroCloud` e `testConnection` sem gate** —
    `meta-channels.ts:1079,1152`. `forcar: true` marca registrado sem
    consultar a Meta; `testConnection` grava `banido`/`erro`.

## Erros de job não alertam

Os ~25 `catch` de `cron-jobs.ts` fazem só `log.error`; o logger não tem
ligação com Sentry. Um cron que falhe em todos os ticks por um mês não gera
um único alerta. Três jobs chamam `captureError`, mas só no que escapa do try
interno — a falha do dia a dia já foi engolida antes.

## Ordem sugerida

1. Itens 1-3 (dinheiro): UPDATE condicional + aritmética em SQL + catch por
   item, e lease para comissão órfã.
2. Itens 4-7 (mensagem perdida): distinguir "canal não existe" de "erro de
   banco" e responder 500 para a Meta reentregar; persistir `mediaId`;
   acionar auto-reply para tipos não-texto.
3. Item 18 (eleição de líder): um lock no banco em volta de `iniciarJobs()`
   mata de uma vez a classe dos itens 16, 19 e metade do 1-2.
4. Itens 8-13 (canal morto silencioso): a UI é o menor esforço com maior
   retorno — qualquer um dos outros problemas ao menos apareceria.
5. Itens 21-23 (gates): correções de poucas linhas.
