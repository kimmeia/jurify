# Estado do sistema — JuridFlow

**Última conferência: 12/09/2026.** Feita lendo o código, não o histórico.

Este arquivo responde uma pergunta só: **onde o produto está hoje, e o que falta
terminar.** Se você tem trinta segundos, leia "O retrato em dezesseis linhas". Se tem
dez minutos, leia até o fim da seção 4.

---

## Regra de manutenção (vale pra qualquer pessoa ou assistente que mexer no repo)

**Toda entrega atualiza este arquivo no MESMO commit da entrega.** Não depois, não
num commit separado de "docs". Se a mudança não cabe aqui, ela não está pronta.

O que cada entrega precisa revisitar:

| seção | pergunta a responder |
|---|---|
| 2. Baseline | rodei `pnpm test`? então o número aqui é o que o terminal mostrou |
| 3. Módulos | algum módulo mudou de estado (casca → parcial → completo)? |
| 4. Pendências | fechei item? abri item? mudou o prazo de algum? |
| 5. Dependências externas | mexi em Meta, Asaas, OpenAI, DataJud, Resend, Twilio ou BACEN? |
| 6. Regras de negócio | mudei alguma regra que decide dinheiro, permissão ou prazo? |

E três regras de escrita, cada uma nascida de um erro real deste repositório:

1. **Cite símbolo, nunca linha.** Escreva `exigirPlanoContratavel` em
   `server/billing/planos-repo.ts`, não `planos-repo.ts:147`. Motivo: em
   12/09/2026 as **cinco** citações `arquivo:linha` que existiam no CLAUDE.md
   apontavam todas para o lugar errado. Linha apodrece em dias; nome de função não.
2. **Número medido, ou número nenhum.** Contagem de teste, de achado, de tabela
   só entra junto com o comando que a produziu. Motivo: o CLAUDE.md dizia "5.526
   testes em 378 arquivos"; o real era 5.570 em 380.
3. **Estado, não diário.** Este arquivo responde "onde estamos". O histórico de
   como chegamos aqui fica no CLAUDE.md e no git.

**Regra de leitura, a mais importante:** quando a documentação e o código
discordam, **o código ganha** — e corrigir a documentação faz parte da tarefa que
descobriu a diferença.

### Por que esta regra existe

Não é burocracia. É o custo medido de não ter tido a regra:

- O commit `e2e3c0b` (11/09) trocou uma regra de negócio central — crédito parou
  de decidir operação, entrou teto mensal por plano (migration 0221). O CLAUDE.md
  não tem **uma linha** sobre isso. O código andou, a memória não.
- Por causa da defasagem, o CLAUDE.md afirma que o JurisIA "não tem como ser
  vendido". **Ele já está sendo vendido** no plano Escala desde 09/09, com os
  riscos jurídicos e a falta de monitoramento que o próprio documento havia
  classificado como "pode esperar, ninguém compra ainda".
- Documentação velha não é inútil. Ela faz tomar decisão errada.

---

## 1. O retrato em dezesseis linhas

1. O sistema é grande e está saudável na base: **5.975 testes verdes** (13/09, com o motor fase 1, a Central de ajuda, a portinha do backoffice e a cor do menu; eram 5.570 no início da auditoria), tipos
   limpos, 126 tabelas, 70 áreas de API, 72 telas.
2. A engenharia tem hábitos bons e raros: travas de teste ("amarras") por assunto,
   comentários que explicam o *porquê*, e listas de exclusão explícitas. O
   vazamento entre escritórios, que era o medo de setembro, está **substancialmente
   fechado** — sobraram três pontas, e a pior é um cargo de outro escritório poder
   ser atribuído a um colaborador do seu (seção 12).
3. O problema principal **não é o código: é a memória do projeto.** 55% do
   CLAUDE.md é histórico de entrega, que só envelhece.
4. Havia **237 achados catalogados** desde 03/09 e **nenhum registro de quais
   foram corrigidos**. Agora há: os 237 foram reconferidos. **57 corrigidos, 172
   abertos, 8 parciais** — três de cada quatro seguem abertos. Mas **os 15
   bloqueadores de lançamento seguraram** (14 fechados, 1 parcial): o que sobrou é
   a cauda que ninguém fechou porque ninguém tinha a lista.
5. **Segurança — corrigido em 12/09:** qualquer pessoa, **sem login**, apagava a
   conta de quem ainda não criou escritório e ficava com o e-mail (**D-13**); e um
   cargo de outro escritório podia ser atribuído e obedecido (**D-15**). Os dois
   fechados no código, sem tela nova.
6. **Dinheiro:** o detector de cobrança duplicada não acha duplicata de valor
   redondo (**D-1**); a faxina diária apaga parcelas de parcelamento longo; e
   chargeback e estorno do Asaas **não têm tratamento nenhum** — o dinheiro sai da
   conta e o painel não muda.
7. **O recorte "ver os próprios" é respeitado em algumas telas e ignorado em
   outras.** Atendente e estagiário chegam a ver o caixa do escritório, o dinheiro de
   qualquer cliente e o espelho de ponto da equipe. O risco de hoje não é "vejo o
   escritório do outro" — é **"vejo o que não deveria dentro do meu"**.
8. **O painel afirma três coisas que podem não ser verdade**, e a pior é o Sentry:
   a tela diz "conectado" e a captura liga só por variável de ambiente. Pode estar
   desligada — o que explicaria por que nada deste documento virou incidente.
9. **Três recursos de IA estavam devolvendo erro — corrigido no código em 12/09**,
   inclusive o JurisIA que é vendido: o código mandava `temperature` para um modelo
   Claude que recusa o parâmetro, e usava como padrão um modelo **retirado em
   15/06/2026**. Hoje toda chamada à Anthropic passa por um helper que tira o
   parâmetro nos modelos que o recusam e troca modelo retirado pelo substituto
   oficial (seção 5.2). **Falta a prova em produção**: uma mensagem respondida
   pelo Atendente IA depois do deploy.
10. **Três prazos externos com data:** em **01/10/2026** a Meta passa a cobrar por
   mensagem e o sistema não guarda um único dado de custo; em **23/10/2026** a
   OpenAI desliga modelos que o código usa; em **21/01/2027** expira a versão da
   API da Meta — e essa falha é silenciosa.
11. **O opt-out que o cliente faz dentro do WhatsApp não é honrado**, e a origem do
    consentimento que gravamos ninguém consegue ler. Pesa, porque o projeto já
    levou dois avisos de spam da Meta.
12. **Backup em dois níveis, os dois furados:** o da plataforma **nunca termina**
    em banco de tamanho real (**D-14**), e no do escritório **20 tabelas ficam de
    fora** porque a trava que deveria impedir isso tem um ponto cego (**D-2**).
13. **A venda promete o que o produto não entrega, e o pior era a cobertura de
    tribunais: o motor conhecia 16, e TJSP e todos os TRTs ficavam de fora.**
    **Em 12–13/09 a Justiça do Trabalho entrou** (TRT2 e TRT15 por consulta
    pública, os outros 22 TRTs com credencial em teste — seção 15.1.1); TJSP
    segue fora, e nada disso foi comprovado em portal real. Junto: Instagram
    vendido em três lugares sem receber uma mensagem, armazenamento e número de
    WhatsApp vendidos sem trava, e o plano "Sob medida" entregando menos que o
    Escala. Seção 15.
14. **O que o sistema promete apagar, ele não apaga.** "Excluir cliente" deixa cinco
    tabelas intactas e os arquivos no disco — e diz que apagou. E a impersonação, que
    troca poder total por rastro total, tem o rastro quase vazio: **49 registros de
    auditoria para 779 procedures**, e só 2 deles dentro do app. Seção 16.
15. **Desempenho: o que dói depois de vender.** Todo usuário baixa **1,77 MB
    compactado** antes da primeira tela, porque as 54 páginas entram num pacote só; e
    **24 colunas muito consultadas não têm índice**, várias delas o `escritorioId` —
    ou seja, cada escritório fica mais lento conforme os **outros** crescem. Seção 17.
16. **Nenhum arquivo de código foi alterado.** Só documentação. Este documento é o
    mapa, não a obra.

---

## 1.1 Se for fazer só doze coisas, faça estas

Ordenado por dano × prazo × esforço, não por dificuldade.

| # | o que | por quê agora |
|---|---|---|
| 1 | **Consertar o backup da plataforma** | ele **nunca termina** em banco de tamanho real, por um impasse de stream, e fica pendurado sem erro. É a última linha de defesa e ela não está lá (item **D-14**) |
| 2 | ~~Fechar o cadastro que apaga conta alheia~~ **feito 12/09** | o cadastro nunca mais apaga conta: confirmada recusa e manda pro "Esqueci a senha"; não confirmada só reenvia a confirmação ao dono do e-mail (item **D-13**) |
| 3 | **Conferir se o Sentry está realmente capturando** | o painel diz "conectado" mas a captura liga **só** por variável de ambiente. Pode estar desligado há meses — e é por isso que nada do que está neste documento apareceu como incidente (seção 11.1) |
| 4 | **Testar o Atendente IA e o JurisIA em produção depois do deploy** | o erro 400 da Anthropic foi corrigido no código em 12/09 (seção 5.2); a prova é uma mensagem respondida, não o teste verde |
| 5 | **Declarar os `ARG` de `VITE_*` no Dockerfile** | nenhuma variável do cliente chega ao build. Hoje isso mantém o captcha impossível de aparecer, e vai morder qualquer coisa nova que dependa disso (seção 11.1) |
| 6 | **Parar a faxina que apaga parcelas com vencimento a mais de 1 ano** | quem parcelou em 24× já está perdendo parcelas do Financeiro (seção 10.1) |
| 7 | **Tratar chargeback e estorno do Asaas** | o dinheiro sai da conta e o painel não muda; a disputa tem prazo de 150 dias (seção 5.4) |
| 8 | **Honrar o `user_preferences` da Meta** | é o opt-out que o cliente faz dentro do WhatsApp. O projeto já levou **dois** avisos de spam, e a origem do consentimento que temos gravada ninguém consegue ler (seções 5.3.1 e 11.4) |
| 9 | ~~Decidir o que fazer com a cobertura de tribunais~~ **decidido e em andamento** | o dono escolheu as duas coisas: texto honesto (feito 12/09) e ampliar o motor (fase 1 na branch, 13/09 — seção 15.1.1). Falta o que só ele faz: testar nos portais |
| 10 | **Completar o "excluir cliente"** | ele deixa 5 tabelas intactas — telefone, CNJ, acordo, pergunta à IA — e os arquivos no disco, dizendo que apagou. É a ferramenta com que o escritório cumpre pedido de exclusão do cliente dele (seções 16.1 e 16.2) |
| 11 | ~~Validar o cargo em `atribuirCargo`~~ **feito 12/09** | `atribuirCargo` recusa cargo de outro escritório (NOT_FOUND) e `checkPermission` ignora cargo alheio, caindo no cargo pelo nome (item **D-15**) |
| 12 | **Corrigir o detector de cobrança duplicada** | não acha duplicata de valor redondo, que é o valor mais comum em honorário (item **D-1**) |

E três que são quase de graça, porque são só texto:

- **Alinhar a skill de mockup com a regra do dono** — ela manda entregar PNG, a
  regra manda entregar HTML (seção 9.3).
- **Tirar o "+90 tribunais" da tela de Processos** — o servidor procura em um
  (seção 9.2).
- **Corrigir a nota de metodologia do PDF do DRE** — ela lista 3 status e o cálculo
  usa 4, e é um PDF que o escritório entrega e arquiva (seção 11.5).
- **Trocar `api_publica_tjdf` por `api_publica_tjdft`** — uma letra, e a consulta ao
  Distrito Federal passa a funcionar (seção 5.7).

---

## 2. Baseline medido

Rodado neste container, em 12/09/2026, com `pnpm install` feito na hora:

| medida | resultado | comando |
|---|---|---|
| testes | **6.136 verdes, 412 arquivos** (13/09, com a seção 28 e `develop` dentro; 6.119 em 411 antes; 5.570 em 380 no início da auditoria) | `pnpm test` |
| tipos | **limpo, saída 0** | `pnpm check` |
| lint | **não existe** — nenhum eslint/biome/oxlint no repo; `check` é só `tsc --noEmit` | `package.json` |

Tamanho do código:

| área | linhas |
|---|---|
| servidor, sem teste | 123.064 |
| servidor, teste | 70.541 |
| cliente | 123.247 |
| compartilhado (`shared/`) | 12.263 |
| schema do banco | 4.715 (126 tabelas) |
| migrations | 227 arquivos, 6.819 linhas |
| testes de navegador (`tests/`) | 4.005 |
| `scripts/` | 7.061 |

Contagens: **70** áreas de API (namespaces tRPC), **779** operações
(procedures), **72** rotas de tela, **401** arquivos de teste no repo (380 rodam
no vitest).

---

## 3. Mapa dos módulos

São 17 módulos contratáveis (`shared/modulos-app.ts`), dois deles obrigatórios.
A coluna **estado** significa:

- **completo** — o fluxo principal fecha de ponta a ponta
- **parcial** — fecha o principal, falta um pedaço que o usuário percebe
- **casca** — a tela existe e o servidor não entrega o essencial

> Esta tabela é preenchida módulo a módulo pela auditoria em andamento. O que já
> está conferido está marcado; o resto é honestamente "não auditado nesta passada"
> em vez de palpite.

| módulo | estado | o que falta | é vendido? |
|---|---|---|---|
| Dashboard (obrigatório) | completo | resíduo morto do medidor antigo de créditos (**D-6**) | incluso |
| Configurações (obrigatório) | não auditado | — | incluso |
| Clientes (CRM) | não auditado | — | sim |
| Atendimento (WhatsApp + IG) | completo na tela | ligar por telefone está desligado com trava de teste; a operação segue aberta na API (**D-4**) | sim |
| Funil Kanban | não auditado | — | sim |
| Agenda e Tarefas | parcial | lembrete por e-mail e WhatsApp desabilitado com "em breve" (decisão consciente) | sim |
| Monitoramento de Processos | ligado para 16 tribunais com credencial + 3 por consulta pública + 24 TRTs em teste (na branch, 13/09), **comprovado em campo só no TJCE** (seções 9.2 e 15.1.1) | validação real nos outros; TJSP (e-SAJ) ainda sem adapter | sim |
| SmartFlow (automação) | **completo** — os 32 tipos de bloco têm executor de verdade (conferido) | — | sim |
| Agentes IA | não auditado | cobrança por uso não implementada (`router-agente-chat.ts`, único TODO do repo) | sim |
| Cálculos Jurídicos | parcial | Tributário é rota viva que abre um cartão vazio, mas **nenhum caminho de tela leva até ela** (**D-7**) | sim |
| JurisIA | **parcial e VENDIDO** | cobrança avulsa nunca entra na fatura; zero monitoramento de erro; nenhuma tela mostra consumo (**D-3**) | **sim, no plano Escala** |
| Financeiro (Asaas) | parcial | detector de cobrança duplicada falha em valor redondo (**D-1**) | sim |
| Comissões automáticas | não auditado | — | sim |
| Modelos de Contrato / assinatura | parcial | assinatura eletrônica **sem nenhum controle de permissão** (**D-5**) | sim |
| Relatórios | não auditado | card "Recebido" tem regra que não soma quinzenas (decisão do dono pendente) | sim |
| Backup do escritório | parcial | 20 tabelas do escritório ficam fora do backup (**D-2**) | sim |
| Ponto | não auditado | **fora de produção desde 13/09** por decisão do dono — em staging com selo "beta" (seção 23.1); dados de ponto e RH estão entre as tabelas fora do backup (**D-2**) | está na cesta do plano Escala, mas não aparece em produção |

**Módulo que existe só como desenho de banco:** Diário da Justiça Eletrônico.
As tabelas `dje_documentos` e `dje_publicacoes` estão no schema, completas e bem
pensadas (download por tribunal/caderno/dia, deduplicação por hash do PDF, busca
FULLTEXT, CPF guardado só como hash por LGPD) — e **nenhuma linha de código lê ou
escreve nelas**. Precisa de decisão: construir ou remover.

---

## 4. Pendências abertas

Cada item foi conferido no código em 12/09/2026. Os que têm **prazo** têm data de
verdade, não estimativa.

### Gravidade alta

**D-1 · O detector de cobrança duplicada não acha duplicata de valor redondo.**
`asaas_cobrancas.valor` é `varchar(20)` — dinheiro guardado como texto. Três
caminhos gravam com formato diferente: cobrança manual grava `"100.00"`
(`input.valor.toFixed(2)`), e tanto a sincronização quanto o webhook do Asaas
gravam `"100"` (`value.toString()`). As duas procedures que procuram par suspeito
(`listarParesSuspeitos` e a irmã dela em `router-asaas.ts`) casam o par com
igualdade de texto, e `'100.00' = '100'` é falso.
O agravante: o filtro dessas buscas **exige que um lado seja manual** — ou seja,
elas existem justo pro par manual × automático, que é exatamente onde o formato
difere. Funciona só quando o valor tem duas casas decimais não-nulas
(R$ 100,45); falha em valor redondo (R$ 100,00) e em uma casa (R$ 100,50).
*Efeito para o cliente do escritório:* é cobrado duas vezes e a tela que existe
pra apontar isso mostra lista vazia.
*Por que os testes não pegam:* um teste que grava as duas cobranças pelo mesmo
caminho passa.

**D-2 · Vinte tabelas do escritório ficam fora do backup, e a trava que deveria
impedir isso tem um ponto cego.** `server/backup/escritorio-tabelas.ts` promete,
no próprio comentário, que o teste `backup-allowlist.test.ts` "falha se aparecer
qualquer tabela nova com `escritorioId` que não esteja classificada". A promessa
não se cumpre: o detector do teste varre o schema **linha por linha** e exige o
nome da tabela na mesma linha do `mysqlTable(`. Metade das tabelas é declarada com
o nome na linha seguinte — 48 de 126 — e essas são invisíveis ao teste.
Resultado medido: **74** tabelas têm coluna de escritório; **20** não estão em
nenhuma das quatro listas do backup; e **todas as 20 são declarações multi-linha**
(correlação de 100%, o que prova o mecanismo).
O que o escritório perde num restore: ponto eletrônico e RH inteiros
(`ponto_dias`, `rh_ocorrencias`, `rh_avaliacoes`, `rh_avaliacao_acoes`), histórico
do JurisIA (`jurisia_conversas`, `jurisia_mensagens`, `jurisia_uso`),
`atendimentos`, a regra de comissão de gestão (`comissao_gestao`), a configuração
de setores e origens de lead (`setores`, `origens_lead`), `prazos_sugeridos`,
`financeiro_anexos` e os relatórios programados.
Nem todas precisam entrar — `email_log`, `escritorio_addons`,
`interesse_tribunais`, `resumo_diario_envios` e `ofx_importacoes_fitid` parecem
medição interna e caberiam na lista de exclusão. **O problema não é a lista estar
curta: é ninguém ter decidido, porque o teste nunca perguntou.**

**D-3 · JurisIA está sendo vendido com três pontas soltas.** O CLAUDE.md diz que
nenhum plano libera o módulo. Está desatualizado: a migration `0217` criou o plano
`escala` (R$ 597) com `jurisia_mensagens_mes = 200` e `'jurisia'` na cesta de
módulos, e a lista de vantagens do plano diz textualmente "JurisIA: pesquisa
jurisprudencial (200 consultas por mês)" — texto que a tela de planos renderiza a
partir do banco. Então está vendido. E seguem abertos:
- **cobrança cruzada**: a constante do módulo é `"jurisia"` sem prefixo, mas a
  fatura composta só soma add-on cujo produto começa com `modulo:`. Conceder pelo
  cartão do JurisIA **libera e não cobra**; conceder pelo diálogo de módulos
  avulsos grava `modulo:jurisia`, que **cobra e não libera**.
- **zero monitoramento**: `grep -rn "Sentry\|captureException" server/jurisia/`
  volta vazio. Erro da OpenAI vai cru pro advogado e fica gravado no histórico dele.
- **nenhuma visão de consumo**: `jurisia_uso` só é lida dentro do próprio router,
  pra impor a cota. Nenhuma tela, nem do admin, mostra consumo ou custo.

**D-4 · A operação de ligar por telefone segue aberta na API, embora o botão esteja
desligado.** *(Este item nasceu errado na primeira versão deste documento; a
correção está no fim.)*

O botão "Ligar" do Atendimento está **desabilitado** desde 09/09: sem `onClick`,
com `title="Ligação por telefone (Twilio) — em breve"`, e com um comentário ao lado
explicando que o servidor só recebe o número do cliente e por isso cairia no ramo
que toca "chamada de teste do sistema". A trava é real e testada:
`server/__tests__/twilio-ligacao-em-breve.test.ts` prende o desenho em oito
afirmações, entre elas "está desabilitado e não disca".
Rastreei o caminho inteiro: `onTel` só é chamado por aquele botão, `setTelPopup` só
por `onTel`, e o popup que dispara a chamada (`TwilioCallPopup`) executa a mutation
no `useEffect` de montagem. Com o botão desabilitado, nada disso monta. **Pela tela,
é inalcançável.**

O que **continua aberto** é o lado servidor: `twilio.iniciarChamada` é
`protectedProcedure`, portanto:
- **sem nenhum controle de permissão** — qualquer sessão logada chama;
- aceita `destino` como texto livre de 8+ caracteres, **sem conferir se o número
  pertence a um contato do escritório**;
- e **não deixa registro** de quem ligou pra quem.
Uma chamada direta à API (fora da tela) dispara uma ligação real tocando "esta é uma
chamada de teste do sistema", na conta Twilio do escritório.
*Atenuante conferido:* a credencial usada é sempre a do escritório da sessão
(`getTwilioConfig(ctx.user.id)`), nunca a de outro — não há vazamento entre
escritórios. O risco é interno e financeiro.

> **Onde eu errei, e por quê.** Na primeira passada vi a mutation ligada em
> `Atendimento.tsx` e o TwiML de teste no cliente Twilio, e concluí que o botão
> chamava clientes. Não conferi se o botão que dispara a mutation estava habilitado
> — e ele não está, desde 09/09. Quem apontou o erro foi a camada de revisão
> adversarial desta auditoria, lendo o mesmo arquivo. Fica registrado porque é a
> lição mais útil da auditoria inteira: **existir a chamada não significa existir o
> caminho.** E também porque o CLAUDE.md ainda diz "E (Twilio) em stand-by por
> decisão do dono", o que reforçou minha conclusão errada — é o texto velho que está
> desatualizado, não o código.

**D-5 · Assinatura eletrônica não tem nenhum controle de permissão.**
`server/escritorio/router-assinaturas.ts`: `grep -c checkPermission` = **0**, e não
há `adminProcedure` nem gate próprio. São 14 operações — 11 exigem apenas login
(entre elas `criar`, `criarDeUpload`, `cancelar`, `excluir`, `salvarCampos`) e 3
são públicas por token.
O escopo por escritório existe (21 menções a `escritorioId`), então não há
vazamento entre escritórios. Mas **qualquer colaborador, no cargo mais restrito
que exista, cancela ou exclui a assinatura de um contrato do escritório.** Para um
documento com valor jurídico, é a lacuna mais desconfortável desta auditoria.
*Histórico:* já constava como P2-11 no documento de 18/08. A parte de vazamento
entre escritórios foi corrigida em 03/09; a de permissão, não.

**D-13 · CORRIGIDO em 12/09 — o cadastro nunca mais apaga conta.** `auth.signup`
passou a recusar e-mail já confirmado com `MENSAGEM_EMAIL_JA_CADASTRADO` ("Já
existe uma conta com este e-mail. Tente fazer login ou use Esqueci a senha") e,
quando a conta existe mas nunca confirmou o e-mail, só reenvia a confirmação ao
dono do endereço (helper `reenviarEmailDeConfirmacao`, o mesmo da procedure
`reenviarConfirmacao`) e responde igual a um cadastro novo — nome, senha,
WhatsApp e termos digitados pelo estranho são descartados; com `conviteToken`
devolve `needsConfirmation` sem aceitar o convite. Nenhum ramo tem `delete`.
Amarra: `cadastro-nao-apaga-conta.test.ts` (7 testes, 4 mutações vermelhas).
Efeito colateral anotado: colaborador removido de todos os escritórios que
tenta se cadastrar de novo cai na recusa e, no login, em "Você foi removido" —
o caminho legítimo é o convite do novo escritório. O texto abaixo é o
diagnóstico que motivou a correção.

`auth.signup` é pública, como tem de ser. Só que
quando o e-mail já existe, em vez de recusar, ela faz isto: procura um vínculo
**ativo** de colaborador; se não achar, marca a conta como "órfã", **apaga as linhas
de colaborador e apaga a linha do usuário**, e segue criando a conta nova com a
senha que o visitante digitou.

O comentário explica a origem: era um remendo para contas que ficaram órfãs num
hard-delete antigo. O remendo virou porta.

Quem está nessa situação hoje:
- **todo cadastro self-service que ainda não terminou o onboarding** — a conta nasce
  antes de o escritório existir;
- qualquer colaborador **removido** de um escritório (a remoção é soft-delete, então
  `ativo = false`).

Basta saber o e-mail. Não há confirmação, não há limite de tentativas, não há aviso
para o dono do e-mail.
*Atenuante real, que confirmei:* se a conta tiver dado dependente, a exclusão bate
numa restrição de chave estrangeira e o código lança "não foi possível recriar a
conta". Então contas com histórico estão protegidas **por acidente do banco**, não
por regra. As vazias, não.
*Contexto do próprio projeto:* o caso "Pedro Yuri" registrado no CLAUDE.md é
exatamente um cadastro self-service de quem não é advogado — ou seja, a população
nessa situação não é hipotética.

**D-14 · O backup do banco da plataforma nunca termina.** Este é o pior achado da
auditoria, e é um impasse de programação, não uma configuração errada.

A rotina faz, nesta ordem: cria o compactador, liga a saída do `mysqldump` nele,
**constrói** o objeto de upload para o S3 com esse compactador como corpo, e então
**espera o `mysqldump` fechar** — e só depois de fechar é que chama o `done()` que
de fato inicia o upload.

O problema é que o upload só começa a **consumir** o stream quando `done()` é
chamado. Enquanto ninguém consome, o buffer do compactador enche; cheio, ele para de
ler a saída do `mysqldump`; e o `mysqldump`, sem poder escrever, **nunca fecha**.
A espera nunca termina.

Consequência: **qualquer banco de tamanho real não é copiado.** Basta a saída
comprimida passar de algumas dezenas de kilobytes. E não há timeout: a função fica
pendurada para sempre, então nem erro aparece. Banco pequeno funciona, o que é a
pior variante possível — testar com pouco dado dá verde.

Isso vale para os dois caminhos que geram o backup completo da plataforma. É a
última linha de defesa do produto, e ela não está lá.
*Confirmei lendo o arquivo:* o `done()` está depois da espera, e é a única chamada
dele. O `abort()` do caminho de erro também nunca é alcançado num dump grande.

**D-15 · CORRIGIDO em 12/09.** `atribuirCargo` procura o cargo com `id` E
`escritorioId` na mesma cláusula e responde NOT_FOUND ("Cargo não encontrado
neste escritório") sem gravar; `checkPermission` confere o escritório do cargo
personalizado gravado e, se for alheio ou não existir mais, cai no cargo pelo
nome (antes, cargo apagado negava tudo). `minhasPermissoes` (só o que a UI
mostra) não ganhou a mesma conferência — higiene pendente. Amarra:
`cargo-do-proprio-escritorio.test.ts` (6 testes, 3 mutações vermelhas). O
diagnóstico original segue abaixo.

Eram dois descuidos que sozinhos não fazem nada e juntos viravam
elevação de acesso.

`atribuirCargo` protege o **alvo**: o colaborador precisa ser do escritório de quem
chama. Mas **não valida o cargo**: grava o número que veio do navegador direto na
ficha. E `checkPermission`, ao resolver as permissões daquele cargo, consulta a
tabela de permissões **só pelo id do cargo, sem escritório**.

Somando: quem tem "editar equipe" atribui a alguém do próprio time um cargo que
pertence a outro escritório — basta acertar o número, que é sequencial — e esse
alguém passa a ter exatamente as permissões que o cargo alheio tiver.

Não é elevação de estagiário para dono (exige "editar equipe", que já é cargo de
confiança), e não muda o `dono` canônico, que é outra coluna. É elevação de
"gestor" para "qualquer conjunto de permissões que exista na plataforma", usando
configuração de um cliente que não é o seu.

### Gravidade média

**D-6 · Resíduo da migração "crédito → teto mensal" (migration 0221).** O gate
novo funciona (`server/billing/limites-uso.ts`, chamado por `routers/processos.ts`
e `db.ts`). Mas o medidor antigo não parou: `dashboard.credits` tem 4 consumidores.
- `components/AppLayout.tsx`: o **saldo de créditos ainda destranca item de menu**
  (`itemsLocked = ... && !hasSubscription && !hasCredits`). Quem tem assinatura não
  sente; conta sem assinatura, sim.
- `components/SubscriptionGuard.tsx`: mesma família de decisão.
- `pages/calculos/Calculos.tsx`: usa o medidor **novo** pro limite e pra barra, mas
  tira a **data de virada** do medidor **antigo** (`credits.resetAt`). Duas fontes
  pro mesmo conceito: se não virarem no mesmo dia, a tela mostra uma barra com data
  de reset que não é a dela.
- `pages/dashboards/DashboardGeral.tsx`: **código morto.** Cinco variáveis
  derivadas (`creditsUsed`, `creditsTotal`, `creditsRemaining`, `isUnlimited`,
  `percentCreditos`) e nenhuma é renderizada; o cartão hoje mostra `<UsoDoMes />`,
  corretamente titulado "Uso do plano neste mês". Sobrou o comentário
  `{/* Créditos */}` e a consulta disparando a cada abertura sem consumidor.

**D-7 · Uma rota de cálculo abre um cartão vazio.** `/calculos/tributario` renderiza
`Tributario.tsx` (11 linhas) → `CalculoPlaceholder`, que desenha um título e um
cartão tracejado **com só um ícone dentro** — nem texto de "em breve".
*Atenuante importante, conferido:* o hub de Cálculos trata `emBreve` e renderiza o
cartão do Tributário como um `<div>` não clicável e esmaecido, e o menu lateral só
aponta para `/calculos`. **Nenhum caminho de tela leva à página vazia** — ela só
abre digitando a URL. É rota pendurada, não promessa quebrada.
Junto: `client/src/pages/calculos/AtualizacaoMonetaria.tsx` é **código morto** —
nenhum arquivo importa esse componente, e a rota
`/calculos/atualizacao-monetaria` renderiza a tela real `CalculosDiversos`.

**D-8 · O roadmap mostra o nome de clientes de outros escritórios.**
`server/router-roadmap.ts` não tem **nenhuma** menção a `escritorioId` — o quadro é
da plataforma inteira, de propósito. A operação `obter` devolve, com JOIN em
`users`, o nome do autor do item e o nome dos **últimos 10 votantes**.
Como os clientes do JuridFlow são bancas de advocacia, várias concorrentes na mesma
cidade, o quadro entrega (a) quem são os clientes da plataforma, pelo nome, e (b) o
que cada um está pedindo. É uma lista de clientes navegável, e nenhum deles
concordou com isso.

**D-9 · As conferências do robô de jornada nunca rodam pelo painel — e o histórico
dá a entender que rodaram.** A operação `catalogo` expõe a lista de conferências só
pra o painel **mostrar**; `jornada/historico.ts` grava `conferenciasTotal`, isto é
**quantas** existem; e `jornada/executor.ts` **não importa nem executa** nenhuma.
Quem de fato roda é `tests/e2e/jornada-conferencias.spec.ts`, pelo Playwright.
Ou seja: o painel guarda um total que sugere verificação, e zero conferência rodou.

**D-10 · `push.desinscrever` remove a inscrição de qualquer um.** Em
`server/routers/push.ts` a operação desestrutura só `{ input }`, **sem `ctx`**, e
chama `removerInscricao(input.endpoint)` — a identidade de quem chamou nunca é
usada. O vizinho `inscrever` usa `ctx.user.id`; a assimetria é o sinal. Risco
prático baixo (o endpoint é uma URL longa e aleatória), mas é exclusão não
escopada a quem pediu.

### Riscos estruturais (latentes, não bugs de hoje)

**D-11 · Nenhuma trava contra cron rodando em duas instâncias.**
`server/_core/cron-jobs.ts` registra cerca de 20 trabalhos com `setInterval` dentro
do processo, sem lock distribuído, eleição de líder ou claim em banco. Se o Railway
subir duas instâncias, **cada cron roda nas duas**. O que segura hoje é a
idempotência de cada trabalho, uma a uma, e ela varia: a cobrança mensal se protege
com `ultimaCobrancaEm`, o SmartFlow tem claim atômico, o alerta de limite de e-mail
tem dedup por dia — outros não têm nada óbvio. A proteção existe por acidente de
implementação, não por desenho. E a tabela que registraria execução de job
(`worker_jobs_log`) está morta desde a migration 0050.
Não é possível saber daqui quantas instâncias rodam em produção. Se for uma só,
isso é risco latente — do tipo que aparece no dia em que alguém escala pra aguentar
carga.

**D-12 · Sem ESLint, nada enxerga ordem de hooks do React.** Confirmado: nenhum
config de eslint/biome/oxlint no repo, e `pnpm check` é só `tsc --noEmit`. O
remendo é uma varredura de texto (`react-hooks-apos-return.test.ts`) que cobre um
padrão só. Foi assim que um `useEffect` depois de um `return` antecipado subiu pra
produção e derrubou o editor do SmartFlow. O motivo de adiar é legítimo (plugar
ESLint agora acusa uma montanha de uma vez) — fica registrado como dívida
consciente, não como esquecimento.

### Pendências antigas confirmadas AINDA ABERTAS

| item | onde | estado |
|---|---|---|
| HMAC da Meta em modo brando | `whatsapp-cloud-webhook.ts` | **mitigado em produção (dono confirmou em 12/09 que o App Secret está cadastrado no painel).** O código continua fail-open sem secret: sem App Secret, só emite aviso no log e **aceita** o webhook. Endurecer o código (recusar sem secret) segue como melhoria opcional. |
| CSP desligado | `_core/index.ts` | **aberto.** `contentSecurityPolicy: false` |
| body-parser aceita 3 GB em memória | `_core/index.ts` | **aberto.** `limit: "3gb"` em json e urlencoded |
| histórico de buscas vaza entre escritórios | `processos/search-history.tsx` | **aberto.** A chave é `jurify:processos:history`, sem escritório. Trava numa decisão do dono: sessão de impersonação deve gravar histórico? |
| portão de escritório duplicado | `router-crm.ts` e `router-kanban.ts` | **aberto e subestimado.** A fonte única existe; as cópias privadas seguem, com outro nome (`contatoDoEscritorio`), e há uma segunda duplicata que o registro não citava: `colaboradorDoEscritorio`, copiada nos dois routers |
| `confirm()` nativo em ação destrutiva | 12 arquivos, 18 ocorrências | **estável.** A catraca em `robo-acao-cercas.test.ts` lista exatamente os mesmos 12 arquivos e 18 totais: não cresceu nem diminuiu desde 08/09 |

### Pendência que pode ser REESCRITA como resolvida

**"Hardcode `cargo === 'dono'`" — na prática limpo. Não gastar tempo aqui.**
Contei 13 ocorrências em 6 arquivos do servidor e li todas. Nenhuma é o defeito que
o anti-pattern descreve: duas são o próprio resolvedor da matriz de permissão
("dono tem tudo", que é a definição), três são governança deliberada (só o dono
cria/edita/exclui cargo), três protegem o registro do dono de ser rebaixado ou
removido, uma é o dono aceitando os termos (ele é a parte contratante), uma está
dentro de `exigirDonoOuAdmin` — que é **bem feito**, porque o teste canônico é
`escritorios.ownerId === user.id` e o cargo é só fallback pra linha antiga — e uma
é um comentário dizendo que o gate nunca compara cargo.
Único ponto de atenção honesto: cargo personalizado nunca consegue administrar
cargos. Isso é decisão de produto, não bug.

**"DNS rebinding no webhook do SmartFlow" — limitação assumida, não bug aberto.**
O comentário de `validarUrlDeWebhook` diz a verdade sobre o próprio limite:
"não protege contra DNS que resolve pra IP privado depois do check — proteção
completa exigiria resolver e conectar no IP validado. Cobre o caso prático: URL
interna digitada direto." Isso é documentação honesta. Tratar como bug aberto na
mesma lista dos outros faz a lista parecer pior do que é, e aí ninguém confia nela.

---

## 5. Dependências externas

Esta seção existe porque serviço de terceiro muda sem avisar o nosso código, e
quando muda **a falha costuma ser silenciosa**. Cada linha diz a versão que usamos,
o que a documentação oficial diz hoje, e a data de conferência.

**Conferido em 12/09/2026.** Onde a fonte oficial não abriu (o proxy deste ambiente
bloqueia vários sites de documentação), está escrito.

### 5.1 Quadro-resumo

| serviço | usamos | estado oficial | prazo | risco |
|---|---|---|---|---|
| Anthropic (Claude) | `claude-sonnet-4-20250514` — era o padrão do JurisIA; segue na lista do painel admin | **RETIRADO em 15/06/2026**; substituto oficial `claude-sonnet-4-6` | já passou | **corrigido 12/09**: padrão virou `claude-sonnet-4-6` e o helper troca o retirado pelo substituto na chamada |
| Anthropic (parâmetro) | `temperature` junto com `claude-opus-4-7` | **erro 400** em Claude 4.7 e posteriores | já vale | **corrigido 12/09**: `montarBodyAnthropic` tira o parâmetro nesses modelos |
| Anthropic (Haiku) | `claude-haiku-4-5-20251001` em 17 lugares | Ativo | retirada "não antes de 15/10/2026" | **33 dias** |
| Meta WhatsApp Cloud | Graph API **v21.0** (19 literais) e v23.0 (1) | v21.0 disponível até **21/01/2027** | 4 meses | alto, e falha calada |
| OpenAI | `gpt-3.5-turbo`, `gpt-4`, `o3-mini`, `o4-mini`, `o1-preview` | desligamento em **23/10/2026** | 41 dias | médio |
| OpenAI | `gpt-4o`, `gpt-4o-mini` | o **apelido** segue disponível na API | sem prazo | ok |
| Asaas (versão/auth) | `https://api.asaas.com/v3`, header `access_token` | v3 é a única vigente; não há sunset | sem prazo | ok |
| Asaas (eventos) | dedup por status, não pelo `id` do evento | `CONFIRMED` e `RECEIVED` chegam para a MESMA cobrança | já vale | **alto — dinheiro** |
| Asaas (chargeback/estorno) | sem tratamento | eventos próprios, documentados | disputa até 150 dias | **alto — dinheiro** |
| Meta (cobrança) | não lê o objeto `pricing` do webhook | cobrança por mensagem passa a valer | **01/10/2026** | alto |
| Meta (`user_preferences`) | evento ignorado | é como a Meta entrega o opt-out de marketing | já vale | **alto — histórico de spam** |
| OpenAI (endpoints) | `chat/completions`, `embeddings`, `audio/transcriptions`, `models` | todos vigentes; **não usamos a Assistants API**, que foi desligada em 26/08/2026 | — | ok |
| IA (erro retryável) | 25 chamadas, nenhuma trata 429 nem 529 | a Anthropic classifica os dois como "tente de novo" | já vale | alto |
| DataJud | índice `api_publica_tjdf` | o oficial é `api_publica_tjdft` | já vale | consulta ao DF falha sempre |
| Tribunais (URL) | padrão do TJCE (`/pje1grau/`) para todos | seis dos registrados usam `/pje/` | já vale | alto |
| Resend | limite por segundo e cota diária tratados igual | os dois chegam como 429 | já vale | fila de reenvio nunca esvazia |
| S3 (backup) | `Upload` construído antes de esperar o dump fechar | o upload só consome o stream no `done()` | já vale | **backup nunca termina** |
| Sentry (Express) | sem tratador de erro de rota | a doc do Sentry exige | já vale | webhooks e uploads fora do monitoramento |

### 5.2 Anthropic — dois problemas que quebravam a IA (corrigidos no código em 12/09)

Fonte: página oficial de descontinuação da Anthropic, lida direto em 12/09
(`platform.claude.com/docs/en/about-claude/model-deprecations`). Não é fonte
secundária.

**(a) Um modelo retirado era o padrão de duas operações.**
A tabela oficial diz: `claude-sonnet-4-20250514` → **Retired**, depreciado em
14/04/2026, retirado em **15/06/2026**, substituto recomendado `claude-sonnet-4-6`.
E a página avisa: *"Requests to retired models will fail."*

Onde ele estava:
- `server/juridico/router-juridico.ts` — **duas vezes como valor padrão**
  (`input.modelo || …`), uma delas no caminho que lê PDF escaneado. **Trocado
  por `claude-sonnet-4-6`.**
- `server/routers/admin-agentes-ia.ts` — a lista de modelos aceitos. **Ficou**
  (agente já gravado com ele continua válido) e ganhou `claude-sonnet-4-6`.
- `client/src/pages/admin/AdminAgentesIA.tsx` — o item do menu, rotulado
  "Claude Sonnet 4 (Anthropic)". **Não mudou** (mudança de tela pede mockup).
  Escolher esse item hoje funciona, porque o helper abaixo troca o modelo
  retirado pelo substituto na hora da chamada — o que está gravado no banco
  não muda.

**(b) `temperature` virou erro 400 nos modelos novos — e nós mandávamos.**
A mesma página, na tabela de parâmetros: `temperature`, `top_p` e `top_k` estão
**depreciados a partir do Claude 4.7** e *"returns a 400 error when set to a
non-default value on Claude 4.7 and later models"*.

Onde mandávamos: `server/_core/ai-call.ts` (`claude-opus-4-7` com `temperature`
0,3 — o helper compartilhado do Atendente IA, da captura de campos e do JurisIA) e
`server/routers/processos.ts` (`claude-opus-4-7` com 0,4, resumo do processo).
Também qualquer agente do escritório configurado com "Claude Opus 4.7" na tela
de Agentes IA — a tela oferece esse modelo e o servidor mandava a temperatura
do agente junto.

**Quando disparava:** `resolverChaveIA` tem "preferência: Anthropic" — procura a
chave da Anthropic primeiro e só cai na OpenAI se não houver. A chave própria do
escritório tem prioridade sobre a global. Então a falha atingia: escritório sem
chave própria quando a chave global da plataforma é Anthropic, e escritório cuja
chave própria é Anthropic. **Não é possível saber daqui quais chaves estão
cadastradas em produção**, e o JurisIA não tem Sentry — o erro só apareceria
quando o cliente reclamasse.

**O que foi feito (12/09):** `server/_core/anthropic-http.ts`, um helper único
pelo qual passam **todas** as onze chamadas à Anthropic do servidor:
- `montarBodyAnthropic` monta o corpo da chamada: tira `temperature`/`top_p`/
  `top_k` nos modelos que os recusam (Opus 4.7, 4.8 e toda a família Claude 5);
  mantém nos que aceitam (Sonnet 4.6, Haiku 4.5); troca modelo **retirado** pelo
  substituto oficial (`modeloAnthropicVigente`, tabela copiada da página); e, na
  família Claude 5 — que pensa por padrão e gasta o mesmo `max_tokens` da
  resposta —, soma folga de 2.000 tokens ao teto e pede `effort: "low"`, salvo
  se o chamador já mandou `thinking`/`output_config`.
- `textoDaRespostaAnthropic` lê a resposta juntando os blocos de texto — antes
  todo caller pegava `content[0]`, que na família Claude 5 é o bloco de
  raciocínio, e a resposta viria vazia.
- Nenhum modelo foi trocado nas chamadas: quem usava `claude-opus-4-7` segue
  nele (só sem o parâmetro). A única troca de padrão é a do JurisIA (a).
- Amarras em `anthropic-http.test.ts` (21 testes): o helper em si; todo arquivo
  do servidor que chama `api.anthropic.com` e menciona `temperature` tem que
  montar o corpo com `montarBodyAnthropic`; ninguém lê `content[0]`; nenhum
  arquivo do servidor usa modelo retirado como padrão. 8 mutações conferidas
  vermelhas (tirar o `delete`, afrouxar a regex do Opus 4.7, família 5 sem
  folga, ler `content[0]`, `temperature` por fora do helper, `content[0]` num
  caller, padrão retirado de volta no JurisIA).

**O que NÃO dá pra provar daqui:** o ambiente não chama a API real. A prova é do
dono, depois do deploy: uma mensagem ao Atendente IA respondida, e uma pergunta
ao JurisIA respondida.

*Nota de calibragem:* os 17 usos de `claude-haiku-4-5-20251001` com `temperature`
sempre estiveram corretos — a depreciação vale de 4.7 pra frente. O prazo de
retirada do Haiku 4.5 é "não antes de 15/10/2026" e ele é o padrão de 4 caminhos
(chatbot, extração de campos, resumo de movimentação e o teste de chave do
painel); quando a Anthropic marcar a data, é o helper (`modeloAnthropicVigente`)
que recebe o substituto.

### 5.3 Meta WhatsApp Cloud — prazo de 4 meses, e a falha é muda

O código fixa a versão da Graph API em **20 literais**: 19 em `v21.0` e 1 em
`v23.0`. Distribuição por arquivo: `server/routers/meta-channels.ts` **14**,
`whatsapp-coex.ts` 2, `whatsapp-cloud.ts` 2, `whatsapp-cloud-media.ts` 1, e 1 em
teste.

`whatsapp-cloud.ts` até define duas constantes (`GRAPH_API` e `GRAPH_API_CALLS`),
mas **não as exporta**, e `meta-channels.ts` as ignora e escreve a URL à mão 14
vezes. Não existe versão centralizada: trocar a versão hoje é editar 4 arquivos de
produção e 1 de teste.

Pesquisa (o site oficial da Meta é bloqueado pelo proxy daqui, então isto vem de
fontes secundárias e **precisa de confirmação do dono no changelog oficial**):
v21.0 foi lançada em 02/10/2024 e fica disponível **até 21/01/2027**; a política da
Meta é cada versão viver pelo menos dois anos.

**O modo de falha é o pior possível:** chamada a versão expirada **não dá erro** —
a Meta roteia em silêncio para a versão mais antiga ainda válida. O comportamento
muda sem ninguém receber um 400. É exatamente a categoria de falha que este
projeto já combate por princípio ("falhas que somem").

### 5.3.1 Meta — o resto do que a conferência achou

Tudo abaixo foi cruzado com a documentação oficial da Meta. A coluna **fonte** diz
se a documentação confirmou (`doc`) ou se é leitura forte mas não fechada (`provável`).

**Com data marcada:**

| quando | o que acontece | onde estamos |
|---|---|---|
| **01/10/2026 — 19 dias** | a resposta do atendente passa a ser cobrada por mensagem | o webhook de status **carrega um objeto `pricing`** dizendo se a mensagem foi cobrada e sob qual categoria, e o código não lê **nenhum** campo de custo. Não guardamos um único dado para prever ou conferir fatura da Meta. `fonte: doc` |
| **21/01/2027 — 4 meses** | v21.0 expira | 18 literais de versão espalhados; a Meta **troca a versão por baixo do pano**, sem erro. A versão corrente hoje é a **v26.0** (lançada 29/07/2026). `fonte: doc` |

**Sem data, e sérios — ligados diretamente aos avisos de spam que a Meta já mandou:**

- **O opt-out que o cliente faz DENTRO do WhatsApp não é honrado.** A Meta entrega
  essa preferência pelo webhook `user_preferences` (o botão "Parar promoções"), e
  `grep user_preferences` no repositório inteiro **não retorna nada** — o evento cai
  no default de "campo sem handler". Ou seja: a pessoa pede pra parar, o WhatsApp
  nos avisa, e o sistema não registra. Dado o histórico de dois avisos de spam,
  este é o item mais sensível da lista. `fonte: doc`
- **A trava de MARKETING do SmartFlow usa uma foto congelada da categoria.** O
  passo guarda `templateCategoria` no momento em que o fluxo foi salvo, e a Meta
  **reclassifica template por conta própria** (avisa no dia 1º, aplica no dia 1º do
  mês seguinte) e comunica pelo webhook. Um template que virou MARKETING depois do
  save continua passando pela trava como se fosse UTILITY. `fonte: doc`
- **A definição de opt-in do código é mais frouxa que a política.** O guard aceita
  consentimento com **qualquer** mensagem de entrada do contato; a política da Meta
  exige consentimento coletado antes, declarando que a pessoa aceita receber
  mensagens e **nomeando a empresa**. `fonte: provável`

**Recursos que a tela oferece e o servidor não ingere:**

- **Instagram e Messenger são conectáveis em Configurações, e nenhuma mensagem
  deles entra.** O webhook faz `if (body.object !== "whatsapp_business_account")
  return;` — **retorno silencioso, sem log**. Instagram e Messenger entregam no
  mesmo endereço, mas com `object` igual a `"instagram"` e `"page"`. O escritório
  conecta, vê "conectado", e nunca recebe nada. `fonte: doc`

**Mensagens que o sistema entende errado:**

- **Reação de emoji, pedido e mensagem "unsupported" viram texto e DISPARAM o
  robô.** O default do parse grava `"[reaction]"` como se fosse texto; como o texto
  não está vazio, o SmartFlow roda. O cliente manda um 👍 e o robô responde ao
  "[reaction]". `fonte: doc`
- **Mensagem apagada pelo cliente (`status: "deleted"`) é ignorada** — o texto e a
  mídia continuam no nosso servidor. `fonte: doc`
- **Eventos intermediários de chamada** (RINGING, ACCEPTED, REJECTED) caem em
  "desconhecido" e a chamada volta para "tocando". `fonte: provável`

**Miudezas com efeito real:**

- Lista de templates trunca em 200 **sem paginação e sem aviso**. `fonte: doc`
- Download de mídia não passa `phone_number_id`, que existe para restringir o
  acesso ao número certo. `fonte: doc`
- Tier da conta e alertas só chegam por polling: os webhooks que a Meta criou pra
  isso (`business_capability_update`, `account_alerts`,
  `message_template_quality_update`) estão todos ignorados. `fonte: doc`
- Responder **401** na falha de assinatura faz a Meta retentar com backoff **por
  até 7 dias** (o retry não é configurável no painel, ao contrário do que o
  comentário do código diz) e falha continuada pode desativar a inscrição.
  `fonte: provável`
- Token de Instagram/Messenger é gravado **sem validade** e nada checa expiração.
  `fonte: provável`

### 5.4 Asaas — a versão está certa, o tratamento de eventos não

O básico confere: base `https://api.asaas.com/v3`, header `access_token`, e a **v3
segue sendo a única versão vigente** — não há v4 nem anúncio de sunset. As
"breaking changes" publicadas são remoções de campo, nenhuma delas nos afeta.

O problema não é a versão: é **o que o sistema faz com os eventos que o Asaas
manda.** Isto é dinheiro, então vale ler com atenção.

**Onde dinheiro pode se perder hoje:**

- **`PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED` disputam a mesma chave de
  deduplicação — e o Asaas manda os dois para a mesma cobrança.** No fluxo de
  boleto a sequência oficial é CREATED → CONFIRMED → RECEIVED. Como a chave de
  dedup é decidida pelo **status** e não pelo nome do evento, o segundo chega e é
  descartado como repetido. `fonte: doc`
- **Chargeback não tem tratamento nenhum.** `PAYMENT_CHARGEBACK_REQUESTED`,
  `..._DISPUTE` e `..._REVERSAL` caem num upsert genérico que só grava o status
  cru. O dinheiro sai da conta do escritório e **o painel não muda**. O banco
  emissor tem até **150 dias** para decidir a disputa. `fonte: doc`
- **Estorno idem — e o comentário do arquivo promete o contrário.** O cabeçalho do
  webhook lista "PAYMENT_REFUNDED → marca como estornado", e **não existe esse
  ramo**. `PAYMENT_REFUNDED`, `..._PARTIALLY_REFUNDED`, `..._REFUND_IN_PROGRESS` e
  `..._REFUND_DENIED` caem no genérico. `fonte: doc`
- **`PAYMENT_UPDATED` em cobrança já paga ou vencida é jogado no lixo.** Esse
  evento é justamente "mudou o vencimento ou o valor" — e o portão de dedup o
  descarta pelo status. `fonte: doc`
- **A idempotência não usa o `id` do evento**, que é exatamente o que o Asaas
  fornece para isso e documenta. A chave montada à mão é mais frágil e é a origem
  dos dois primeiros itens. `fonte: doc`

**Configuração que pode estar silenciosamente errada:**

- **O webhook é registrado num endpoint que a documentação atual não tem mais:**
  o código faz `POST /webhook` (singular); a referência é `POST /v3/webhooks`
  (plural), e o corpo exige `events` — que o código **não manda**. `fonte: provável`
- **A URL de sandbox é o host antigo.** O código usa
  `https://sandbox.asaas.com/api/v3`; a documentação atual manda
  `https://api-sandbox.asaas.com/v3`. Produção está certa. `fonte: provável`
- **O ambiente é adivinhado pelo texto da chave, com PRODUÇÃO como padrão.** Se a
  chave não contém "sandbox"/"hmlg" nem o prefixo antigo, o código assume produção.
  Chave de homologação em formato novo cai em produção. `fonte: doc`
- **Nenhuma requisição manda `User-Agent`** identificando a aplicação, que a
  documentação exige desde 13/06/2024. `fonte: doc`
- **`limit` de até 200 é repassado** a uma API que aceita 1 a 100. `fonte: provável`

**Dois avisos que dizem o contrário do que acontece:**

- Quando a fila de webhooks é interrompida (15 falhas seguidas), o sistema
  re-arma e avisa o dono que "os pagamentos do período serão reprocessados". A
  documentação diz que os eventos pendentes ficam na fila e são **apagados depois
  de 14 dias** — então a promessa tem prazo, e o aviso não menciona. `fonte: doc`
- **Recebimento em dinheiro desfeito** (`RECEIVED_IN_CASH_UNDONE`) não é tratado, e
  a deduplicação permanente impede o reconhecimento seguinte. `fonte: doc`

**Na assinatura do próprio JuridFlow:**

- **O plano anual renova em 30 dias fixos.** O webhook calcula
  `currentPeriodEnd = vencimento + 30 dias` sem olhar o ciclo, e o Asaas aceita
  `YEARLY`. Quem paga anual tem o período recalculado como mensal. `fonte: doc`

**Um item que a documentação não fecha, e por isso fica registrado como dúvida:**

- `buscarClientePorCpfCnpj` devolve o **primeiro** resultado da busca sem conferir
  localmente se o CPF bate. A função vizinha faz o oposto (confere). A referência
  do Asaas documenta o filtro mas **não diz se o casamento é exato ou por
  prefixo** — então não é possível afirmar daqui se há risco de pegar o cliente
  errado. `fonte: não confirmado` — vale um teste real no sandbox.

**Segurança do endpoint:** a autenticação do webhook do Asaas é **só o token** no
header (não existe HMAC do lado deles), e o nosso endpoint não tem allowlist de IP
nem rate limit. Isso é limitação do provedor, não nossa — mas significa que o token
é a única defesa, e vale tratá-lo como segredo de primeira classe.

### 5.6 IA: o resto do que a conferência achou

- **Nenhuma das 25 chamadas de IA trata 429 (cota) nem 529 (sobrecarregado).** Erro
  que a própria Anthropic classifica como "tente de novo" vira **erro definitivo**.
  No cron de monitoramento, que é o caminho de maior volume, qualquer pico da
  Anthropic perde o resumo daquela movimentação. `fonte: doc`
- **"Testar conexão" da Anthropic aprova 404 e 429.** A função só reprova 401, 403 e
  erros de servidor; qualquer outro status volta como "Anthropic (Claude)
  conectado". E **404 é exatamente o que a Claude API devolve para modelo
  retirado.** Ou seja: o botão que existe para detectar esse problema é cego para
  ele. `fonte: doc`
- **`gpt-4-turbo` e `gpt-3.5-turbo` seguem escolhíveis no painel admin**, e são
  desligados em **23/10/2026**. Um agente salvo com eles para de responder nessa
  data, e o erro só aparece em uso. `fonte: provável`
- **A tela do escritório oferece `gpt-4.1`**, cujo corte de API é citado para
  **14/10/2026**, e o servidor aceita qualquer texto como nome de modelo.
  `fonte: provável`

### 5.7 DataJud e tribunais

- **O índice do Distrito Federal está montado errado:** o código pede
  `api_publica_tjdf` e o índice oficial é `api_publica_tjdft`. Consulta ao TJDFT
  falha sempre. `fonte: doc`
- **A URL de consulta dos tribunais estaduais é derivada do padrão do TJCE**
  (`/pje1grau/`), e **os outros seis tribunais registrados usam `/pje/`.** Este é o
  detalhe que muda a leitura da seção 9.2: o desenho suporta 16 tribunais, mas o
  endereço montado para seis deles está errado. `fonte: doc`
- **A troca da chave do DataJud não tem caminho pela tela**, e o comentário do
  código promete que tem. `fonte: doc`
- **Risco regulatório no caminho principal do produto.** O motor abre sessão no PJe
  com CPF, OAB, senha e segundo fator do advogado guardados no Cofre, e navega o
  portal com um navegador automatizado, inclusive baixando o teor das peças. A
  Resolução CNJ 185/2013, que regulamenta o PJe, determina que a **automação de
  consultas** se dê pelo Modelo Nacional de Interoperabilidade, não por navegação
  automatizada com a credencial do advogado.
  **Não sou advogado e isto não é parecer jurídico** — é um risco que merece a
  opinião de um, porque está no caminho principal e não num detalhe. Junto vem um
  risco operacional concreto: o navegador se identifica como Chrome 130, de outubro
  de 2024, **dois anos velho** — é assinatura fácil para o filtro de segurança do
  tribunal bloquear. `fonte: doc`
- **O acervo do JurisIA cobre 60 tribunais de uma API que expõe 182:** não há
  Justiça Eleitoral, Justiça Militar, TSE nem STM, e **nada na tela diz isso.** Uma
  busca de jurisprudência eleitoral volta vazia com a mesma cara de "não existe".
  `fonte: provável`

### 5.8 Resend (e-mail)

- **O limite por segundo e a cota diária chegam com o MESMO código 429.** O lote de
  reenvio aborta no primeiro 429 achando que a cota acabou, quando pode ter sido só
  velocidade — **e a fila nunca esvazia.** `fonte: doc`
- **A resposta do Resend já traz a cota real e o tempo de espera, e o código joga
  tudo no lixo** e adivinha com o número 100 cravado. `fonte: doc`
- **Não há chave de idempotência**, e o desenho do reenvio **fabrica cópias do mesmo
  e-mail.** `fonte: doc`
- **O Resend já suprime endereço com devolução e reclamação — o app reenvia para o
  endereço suprimido e grava "sucesso".** `fonte: doc`

### 5.9 Notificação no celular e captcha

- **No iPhone, o nosso service worker engole a notificação, e a Apple cancela a
  inscrição depois de três vezes.** Quem ativou push no iPhone para de receber sem
  saber por quê. `fonte: doc`
- **Se o par de chaves de push mudar, todo push existente morre com 403 — e o código
  trata 403 como aviso**, não como inscrição morta a limpar. `fonte: doc`
- **Não existe tratamento de `pushsubscriptionchange`:** quando o navegador renova a
  inscrição sozinho, a nova nunca chega ao servidor. `fonte: doc`
- **O token do captcha é de uso único e ninguém o reinicia**, então **a segunda
  tentativa de cadastro na mesma tela é sempre recusada.** `fonte: doc`
  (Hoje isso é acadêmico, porque o widget não chega a aparecer — seção 11.1.)

### 5.10 BACEN, Sentry e arquivos no S3

- **O backup da plataforma nunca termina** — é o item **D-14**, o mais grave da
  auditoria.
- **Metade do código monta a URL do BACEN com barra onde deveria ter ponto.**
  Existem as duas formas no mesmo repositório. Se a forma com barra for a inválida, e
  é o que a evidência aponta, tudo que passa por ela falha sempre — incluindo o botão
  "Buscar BACEN" da tela Imobiliário. **Não confirmado em fonte oficial:** o proxy
  deste ambiente bloqueia todos os endereços do Banco Central. `fonte: não confirmado`
- **Erro em rota que não é tRPC nunca chega ao Sentry.** Não existe o tratador de
  erro do Express que a documentação do Sentry exige. Ficam de fora: o webhook do
  Asaas, o webhook de cobrança, a rota pública de assinatura e os uploads — ou seja,
  **justamente as rotas por onde entra dinheiro e entra cliente.** `fonte: doc`
- **A DSN colada no painel não liga nada** (é o item da seção 11.1), e o Sentry em
  ESM é inicializado depois dos imports, então não há rastreamento de desempenho.
- **O link de download do backup admin assina QUALQUER caminho do bucket.** A
  operação recebe a chave do arquivo direto do navegador e assina sem conferir
  prefixo. Uma conta de admin da plataforma emite um link de 15 minutos para ler
  **qualquer objeto**, incluindo comprovantes e notas fiscais que os escritórios
  anexaram no Financeiro. Exige ser admin, então não é "qualquer usuário" — mas o
  link é portátil, sobrevive à sessão e não deixa registro. `fonte: doc`

### 5.11 O que só o dono pode conferir ou resolver

Coisas fora do código. Marcadas com o que muda se ficarem como estão.

| item | onde | o que acontece se ficar assim |
|---|---|---|
| **Atendente IA e JurisIA respondem em produção?** | mandar uma mensagem de teste depois do deploy | o erro 400 da Anthropic foi corrigido no código em 12/09 (item 5.2); só a resposta prova |
| App Secret da Meta cadastrado | Admin → Integrações → WhatsApp Cloud | **feito (dono, 12/09)** — sem ele o webhook aceitaria mensagem forjada de qualquer um |
| Confirmar a data de sunset da v21.0 | changelog da Graph API | define se o prazo é 21/01/2027 mesmo |
| `CANAIS_ENCRYPTION_KEY` | Railway | resolvido por código: cai em `ENCRYPTION_KEY`; nada gravado precisa recadastro |
| Turnstile (captcha) | Railway | **decisão tomada: não quer por ora.** Não cobrar de novo, salvo cadastro em massa de robô |
| Quais eventos de webhook estão ligados no Asaas | painel Asaas | decide quais transições o sistema nunca vê |
| Cadastros nos tribunais + "Testar tudo" | portais | **o dono está fazendo e está funcionando.** Não cobrar |
| Revisão jurídica dos Termos v2 | — | **o dono deu por resolvida.** Não cobrar |
| Avisos de spam da Meta | WhatsApp Manager | **o dono deu por resolvido.** Só reabrir se chegar aviso novo |

Do ambiente: só `JWT_SECRET` e `DATABASE_URL` derrubam o boot se faltarem. Todo o
resto falha em silêncio — é o que torna a linha "Há chave Anthropic conectada?" tão
barata de checar e tão caro de ignorar.

### 5.12 Backoffice — a portinha de leitura (13/09/2026)

O dono aprovou um painel interno único para os dois produtos da empresa
(JuridFlow e Devular), em **`backoffice.devular.com.br`**, repositório
próprio. O painel **não tem banco**: pergunta a cada produto por uma rota nova
e mostra as duas respostas lado a lado. Mockup aprovado:
`mockup-backoffice-unificado.html`.

O que existe deste lado, entregue hoje:

| item | onde | o que faz |
|---|---|---|
| contrato | `montarResumoBackoffice`, `CONTRATO_BACKOFFICE_VERSAO` em `shared/backoffice-contrato.ts` | forma da resposta; o Devular terá cópia idêntica, e a versão deixa o painel avisar quando as duas divergirem |
| rotas | `registerBackofficeRoutes` em `server/backoffice/rota-resumo.ts` | `GET /api/backoffice/resumo` (contas, MRR, integrações) e `GET /api/backoffice/contas` (lista paginada, via `getAllUsersWithSubscription` — a MESMA função da tela Clientes do painel) |
| chave | `conferirChave`, env `BACKOFFICE_API_KEY` | `Bearer`, comparação de tempo constante, mínimo de 32 caracteres |

Quatro decisões de desenho que valem mais que o código:

1. **Fail-CLOSED**, ao contrário do porteiro de módulos e do HMAC da Meta:
   sem `BACKOFFICE_API_KEY` no ambiente a rota responde 503 e recusa **todo
   mundo**, inclusive quem manda a chave certa. Esta rota é fronteira entre
   dois produtos; configuração ausente não pode virar porta aberta.
2. **Banco fora responde 503, não zeros.** `getAdminStats` devolve tudo zero
   quando o banco não responde; servir isso faria o painel anunciar "R$ 0 de
   MRR" sem nada de errado no negócio. `BancoIndisponivel` corta antes.
3. **Segredo nenhum sai.** `admin_integracoes` guarda a chave cifrada na mesma
   linha do status, então a consulta lista as colunas uma a uma — um
   `select()` sem lista vazaria as três.
4. **Integração nunca testada é "desconhecido", não "falha"** —
   `desconectado` é o default da coluna e pintaria de vermelho um painel são.
5. **`cortesias` é `number | null`.** O `getAdminStats` do Devular não conta
   cortesias; responder 0 afirmaria "conferi e não há nenhuma". Ausente vira
   null e o painel mostra "—".

**O isolamento depende de um detalhe:** `getSessionCookieOptions` não define
`domain`, então o cookie de sessão é host-only e `devular.com.br` não
compartilha sessão com `backoffice.devular.com.br`. Escrever um `domain` ali
junta os três apps numa sessão só, em silêncio — há teste travando.

Amarra: `backoffice-portinha.test.ts` (25 testes) — 27 mutações vermelhas em
`scratchpad/mutar-backoffice.py`.

**Estado das outras pontas (13/09):** a portinha gêmea do Devular está
escrita e commitada na branch de lá, mas **NÃO conferida** — `pnpm install`
falha naquele repo neste ambiente (403 do proxy no codeload, dependência do
Baileys), então `pnpm check` e `pnpm test` precisam rodar antes de qualquer
merge. O painel (`kimmeia/backoffice`, `backoffice.devular.com.br`) tem a
fundação e a tela Visão geral rodando, com 22 testes verdes. Falta o segundo
fator no login. Decisão do dono: 2FA **depois**; por isso vale a regra de que
o painel fica só leitura até o código de 6 dígitos existir — nenhuma ação que
muda dado de cliente é ligada antes disso.

---

## 6. Regras de negócio, por domínio

O que o sistema **decide sozinho**, em português, sem abrir código. Foram mapeadas
**337 regras** nesta passada; **133 delas têm um ponto frágil declarado** — um
lugar onde a regra depende de sorte, de silêncio ou de um caminho que ninguém
confere. Abaixo estão as que mudam dinheiro, acesso ou o que o cliente recebe.

Quando aparecer **⚠**, é um ponto frágil que vale conhecer antes de mexer.

### 6.1 Dinheiro do cliente do escritório

- **Cada escritório usa a própria conta Asaas.** A chave fica guardada cifrada.
  ⚠ Se a descriptografia falhar, o erro é engolido sem log: a integração
  simplesmente para, e ninguém sabe por quê.
- **Sandbox ou produção é deduzido do texto da chave**, não escolhido. ⚠ Chave de
  teste em formato novo vira "produção", e o escritório acha que está só testando.
- **Cobrança parcelada não usa o parcelamento do Asaas:** o sistema cria N cobranças
  independentes, uma por mês. ⚠ Se a 5ª falhar, **as 4 primeiras não são desfeitas**;
  o operador recebe "criei 4, falhou na 5ª".
- **Criar a mesma cobrança duas vezes por engano não cobra o cliente em dobro** — a
  tela gera uma senha de operação. ⚠ **Assinatura e cobrança manual não têm esse
  mecanismo.**
- **Existe cobrança "manual"**, que não passa pelo Asaas, para quem pagou em
  dinheiro ou transferência.
- **"Pagamento de terceiro":** quando a esposa paga a conta do Carlos com o CPF
  dela, a cobrança continua sendo do Carlos. ⚠ Duas procedures gravam esse vínculo
  com regras diferentes.
- **Quem recebe a comissão é decidido quando a cobrança NASCE** e nada depois muda
  isso. ⚠ Se a leitura da configuração falhar, segue o caminho padrão em silêncio.
- **Elegibilidade de comissão:** decisão manual vence; sem ela, vale a categoria.
  ⚠ A categoria não é conferida contra o escritório ao ser gravada.
- **Os três números do topo do Financeiro:** RECEBIDO conta pela data do pagamento;
  A RECEBER e VENCIDO contam pela data de vencimento. ⚠ Se a consulta falhar, a
  resposta é **zero em tudo**, sem aviso e sem log.
- **Para os painéis,** pago = recebido + confirmado + pago em dinheiro + pago após
  negativação. ⚠ **Cobrança estornada desaparece dos números sem nenhuma linha
  explicando.**
- **Na régua de cobrança, "estornada" é tratada junto com "paga"** — some da régua,
  embora o dinheiro tenha voltado para o cliente.
- **Na importação do extrato, só o que SAIU da conta vira despesa.** ⚠ Inclusive a
  transferência do próprio dinheiro para o banco do escritório, que derruba o lucro.
- **Uma vez por dia roda uma faxina de "fantasmas"**, comparando 5 anos atrás até 1
  ano à frente. ⚠ **A janela de 1 ano é curta demais para parcelamento longo:
  parcela que vence depois é apagada como se não existisse.**

### 6.2 Limites do Asaas e o que acontece quando estouram

- **Toda chamada espera no máximo 15 segundos e não é repetida.** Falha de rede é
  erro final. ⚠ Uma oscilação de 1 segundo perde a operação; quem repete é o cron,
  no dia seguinte.
- **Quatro travas locais decidem se a requisição pode sair.** ⚠ Abaixo de 18.000
  chamadas no mês, **duas instâncias do sistema contam separado** e juntas podem
  passar do teto.
- ⚠ **Até 49 chamadas podem não ter sido gravadas** no contador quando o sistema cai.
- **Quando o Asaas responde 429, o endereço é bloqueado pelo tempo que ele pedir.**
  ⚠ Reação exagerada: um limite de minuto vira bloqueio de meio dia em tudo.
- **Quem conecta durante um bloqueio fica "aguardando validação" e é promovido
  depois.** ⚠ **Essa promoção não registra o webhook** — o escritório fica sem tempo
  real para sempre.
- ⚠ **O endereço do webhook registrado no Asaas vem do navegador de quem conectou.**
  Conectar a partir de um endereço de teste registra o webhook para lá.

### 6.3 O WhatsApp e o robô

- **Mensagem de grupo é descartada** — o sistema atende uma pessoa por vez.
- **A mesma mensagem nunca entra duas vezes**, pelo identificador da Meta. ⚠ A busca
  é global, sem escritório, **e não há índice único**: duas entregas no mesmo
  instante podem passar as duas.
- **Quando o cliente escreve, o sistema tenta juntar a ficha magra do WhatsApp com o
  cadastro completo.** ⚠ Falha em silêncio: duplicata não unificada não aparece como
  pendência em lugar nenhum.
- **Nota de voz é transcrita e a transcrição vira o texto.** ⚠ Sem a transcrição
  configurada, **o cliente fala e o robô fica mudo**, sem nenhum aviso na tela.
- **Foto, vídeo, PDF e figurinha são baixados e guardados no servidor**, em
  `./uploads/whatsapp-cloud/...`. **Isso está seguro** — e o comentário do arquivo
  diz o contrário, ver a nota na seção 9.2.1.
- **O robô cala quando o atendente assume** (conversa em atendimento), e **encerrar a
  conversa cancela o roteiro parado**.
- **O limite por contato é janela deslizante** de 24h, 7 dias ou 30 dias, e quando
  ele cala o robô, fica um recado interno na conversa — um por atendimento.
- **Roteiro que espera resposta fica aguardando por um prazo configurável de 1
  minuto a 7 dias** (o padrão é 24h). O teto de 24h é do Atendente IA, não do roteiro.

### 6.4 Quem vê o quê

- **A régua é `checkPermission(usuário, módulo, ação)`.** Dono e gestor têm
  "ver tudo" — **exceto no Ponto**, fechado por padrão para gestor.
- **Quem tem "ver tudo" no financeiro vê o escritório inteiro; quem tem "ver os
  próprios" vê só o que é seu.** ⚠ **O crachá financeiro da ficha e a tela de
  duplicatas não aplicam esse recorte** (seção 10.2).
- **Quem ATENDE uma conversa pode ver, editar e transformar em cliente o contato que
  atende** — mesmo sem ser o responsável pelo cadastro. Trocar o responsável
  continua sendo só de quem vê tudo, porque isso redistribuiria comissão.
- **O que o escritório enxerga depende do plano**, num porteiro que é **fail-open de
  propósito**: só bloqueia quando resolveu o plano e o módulo não está na lista.

### 6.5 Tempo, prazo e fuso

- **"Atrasado" é o fim do dia civil no fuso do escritório**, não UTC.
- **Prazo só-data é gravado como meio-dia UTC** para sobreviver a conversão.
- **O período do Inbox conta pelo início do ATENDIMENTO** — a primeira mensagem da
  conversa; atendimento encerrado e cliente que volta = novo início.
- **O resumo diário sai no fuso de cada escritório**, não num horário fixo em UTC.

### 6.6 Cota e limite do plano

- **Cada operação avulsa tem teto mensal escrito no plano** (consulta de processo,
  busca de documento, resumo de IA, cálculo), contado em competência `AAAA-MM`.
- ⚠ **Erro ao ler o limite LIBERA a operação** — e perder a contagem é considerado
  melhor que derrubar o pedido do advogado. É decisão consciente, documentada no
  código.
- **Vaga de processo vigiado e de CPF vigiado é limite separado**, conferido antes.
- ⚠ **O saldo de créditos antigo ainda destranca item de menu** (seção **D-6**).

## 7. Dívida consciente (não reabrir sem o gatilho)

Coisas adiadas de propósito. Cada uma tem o gatilho que justifica trazer de volta.
Reabrir antes do gatilho é desperdício; ignorar depois dele é o erro.

| dívida | por que foi adiada | gatilho pra reabrir |
|---|---|---|
| ESLint + regras de hooks do React | plugar agora acusa uma montanha acumulada de uma vez | outro erro de React em produção que o remendo de texto não pegou; ou mais gente mexendo no cliente |
| Nome próprio por bloco no SmartFlow | o save não grava `data.label`; o rótulo apareceria e sumiria no reload | o dono reclamar de três blocos "ENVIAR MENSAGEM" iguais no canvas |
| Migração de uploads para S3 | volume do Railway está validado fim a fim em produção | quando CSP e body-parser saírem juntos, ou quando o volume apertar |
| Extras avulsos dos planos novos (usuário, +processos, número extra) | não existe mecanismo de limite por escritório pra processos e números | quando alguém quiser comprar o extra |
| Card "Recebido" que não soma as quinzenas | é escolha de âncora (pagamento × safra), e as duas não podem valer juntas | o dono escolher a âncora. **Não implementar antes disso** |
| Histórico de buscas por escritório | trava numa decisão: sessão de impersonação deve gravar histórico? | o dono responder (a recomendação é: não) |
| Desduplicar o portão de escritório | as três cópias funcionam; mexer é remoção de código | quando alguém precisar mudar a regra em si |
| DNS rebinding no webhook do SmartFlow | limitação assumida e escrita no código; cobre o caso prático | se aparecer uso de webhook pra destino interno |
| Twilio "Ligar" (tela) | **resolvido em 09/09**: botão desligado com "em breve" e amarra de teste. Fica aqui só porque o CLAUDE.md ainda diz "stand-by" | religar quando a ligação conectar as duas pontas (atendente + cliente) |

---

## 8. O que esta auditoria NÃO alcançou

Dito na frente, porque auditoria que não declara o próprio limite vira falsa
segurança.

1. **Nada foi executado contra serviço real.** O proxy deste ambiente bloqueia os
   portais dos tribunais, o DataJud, a Meta e a documentação do Asaas. Tudo sobre
   tribunal e sobre a Meta saiu de leitura de código e de fonte secundária.
2. **Nenhum banco de produção foi consultado.** Quantas instâncias o Railway roda,
   quais chaves de IA estão conectadas, quais eventos de webhook estão ligados no
   Asaas, quantas linhas cada tabela tem — nada disso é visível daqui. Onde
   dependia disso, está escrito "o dono confere".
3. **Os testes foram rodados, não escritos.** 5.570 verdes é o estado atual, não
   prova de cobertura. A seção de pendências aponta onde falta trava.
4. **A cobertura não é uniforme, e isso está detalhado na seção 14.** A
   conferência dos 237 fechou por inteiro; a auditoria por subsistema cobriu os
   maiores (Asaas, WhatsApp, Meta, SmartFlow, painel admin) e **não passou** por
   cálculos, JurisIA, peças jurídicas, RH e ponto; a leitura linha a linha cobriu
   15 blocos dos arquivos gigantes. **A lista de achados vai crescer.**
5. **Parte dos revisores céticos não chegou a rodar** (a sessão bateu no limite de
   uso). Onde o segundo leitor passou, está marcado; onde não passou, o achado vem
   da primeira leitura com evidência de arquivo. Ver seção 14.
6. **Não houve teste de mutação.** O padrão da casa é quebrar o código de
   propósito e ver o teste ficar vermelho. Não fiz isso aqui: esta passada foi de
   leitura, e o dono pediu que nada fosse alterado.
7. **A leitura integral cobriu os 12 maiores arquivos**, em blocos. Arquivos médios
   e pequenos foram lidos por subsistema, o que é mais raso.
8. **Nenhuma tela foi aberta.** Toda afirmação sobre o que o usuário vê vem de ler
   o componente, não de rodar o app.

---

## 9. Documentação que discorda do código

Esta é a seção que o dono pediu: **o que está escrito e não é mais verdade.**

Método: cada afirmação factual do CLAUDE.md foi extraída e conferida no código,
uma por uma, com uma segunda leitura cética em cima de cada divergência. Até o
fechamento desta versão: **490 afirmações conferidas, 432 confirmadas**, e as
divergências abaixo.

### 9.1 Já corrigido no CLAUDE.md nesta passada

| o que dizia | o que é |
|---|---|
| "5.526 verdes (378 arquivos)" | 5.570 verdes, 380 arquivos (medido) |
| `AdminClients.tsx:1693` | a linha virou outro botão; a exclusão está noutro lugar e **já usa `current`** |
| `Atendimento.tsx:471` | `maskPhoneBR` está em outra linha e **já delega** pro shared |
| `Clientes.tsx:2919` | a separação carregando × vazio está em outra linha, e funciona |
| `router-crm.ts:70` / `router-kanban.ts:60` | as cópias existem com **outro nome**, e há uma **segunda** duplicata não citada |

As cinco citações `arquivo:linha` do arquivo estavam **todas** erradas. Daí a regra
"cite símbolo, nunca linha".

### 9.2 Conferido, e o texto segue precisando de correção

Não reescrevi a narrativa do dono (isso seria remoção sem autorização). Está tudo
marcado no aviso no topo do CLAUDE.md.

**Coisas que o texto diz que faltam, e já foram feitas:**

- **"E (Twilio) em stand-by"** — foi entregue em 09/09: botão desligado com "em
  breve", ícone do Twilio, e `twilio-ligacao-em-breve.test.ts` travando o desenho.
  *Este texto velho me levou a um erro de diagnóstico; ver a nota no item D-4.*
- **"`admin.criarCliente` não pede WhatsApp"** — pede. A procedure exige e recusa
  número inválido com a mesma mensagem do cadastro público. A anotação aparece
  **duas vezes** no arquivo e as duas estão vencidas (o próprio texto se corrige
  algumas linhas adiante, o que mostra o problema de escrever em camadas).
- **"`trocarPlanoAdmin` só cancela a assinatura atual DEPOIS de a nova existir"** —
  hoje não cancela em momento nenhum; quem encerra a anterior é o webhook de
  pagamento. Também aparece duas vezes.
- **"planos de Monitoramento são os do lançamento na vitrine"** — a migration 0217
  tirou os dois da vitrine (`oculto = TRUE`; quem assina continua).
- **"o plano `completo` virou 'JuridFlow Completo'"** — a 0217 renomeou para
  **"Sob medida"**.

**Uma coisa em que o texto é pessimista e o código é mais capaz:**

- **"novas ações (CPF/CNPJ) hoje é SÓ TJCE"** — desatualizado, e no sentido bom.
  O adapter é genérico apesar do nome: `cnj-parser.ts` diz, no comentário,
  "adapter genérico em pje-tjce.ts cobre todos"; `consultarTjcePorCpf` recebe a
  configuração do tribunal como parâmetro; e o cron de novas ações percorre
  `lerTribunaisDoMonitor(mon)`, resolvendo a config de cada um e tratando falha de
  um estado como linha no relatório de cobertura, sem derrubar os outros.
  `shared/tribunais-pje.ts` oferece **16 tribunais** (12 estaduais + TRF1/2/3/6;
  TRF5 fica fora porque é consulta pública, TRF4 usa eproc sem adapter).
  **Mas há DOIS caminhos, e eles não são iguais** — é aqui que a frase do doc
  acerta pela metade:

  | caminho | cobertura real |
  |---|---|
  | **vigilância contínua** (o cron de novas ações) | percorre os tribunais do monitoramento; **ligado para os 16** |
  | **consulta avulsa** (botão "Consultar" por CPF/CNPJ na tela) | **só TJCE, cravado no código.** Mapeia o sistema da credencial para `"tjce"` ou `null`, e `null` recusa com "Busca por CPF/CNPJ ainda só funciona pra TJCE" |

  Então: o doc está **certo sobre a consulta avulsa** e **desatualizado sobre a
  vigilância**. E só o TJCE foi validado em campo nos dois casos — os endereços dos
  TRFs foram deduzidos do padrão.

  **O problema comercial é maior do que o do doc.** A tela de Processos anuncia,
  em dois lugares, "busca por CPF/CNPJ em **+90 tribunais**", e durante a busca
  escreve "Buscando em **todos os tribunais**". O servidor procura em **um**. A
  comparação da landing promete "novas ações por CPF/CNPJ" sem ressalva, enquanto as
  vantagens dos planos novos dizem "novas ações: TJCE por enquanto". Três textos,
  três promessas diferentes, e a mais visível é a mais errada.

**Coisas que o texto afirma e o código nunca fez, ou faz diferente:**

- **`pnpm check` = "typecheck + lint"** — não há lint. É só `tsc --noEmit`, e não
  existe ESLint no repositório.
- **`requireFinanceiroVer`** — esse símbolo **não existe**. O real é
  `exigirFinanceiroVer`, em `router-relatorios.ts`. Quem grepar o nome do doc não
  acha nada e pode concluir que não há gate.
- **"`protectedProcedure` só checa login"** — checa login **e** passa pelo porteiro
  de módulos contratados (dois middlewares). O certo é dizer que ele **não checa
  escritório nem permissão** — que é o ponto que importa pro anti-pattern.
- **"numeração sequencial das migrations"** — há **26 prefixos repetidos**
  (`0003`, `0004`, `0005`, `0011`–`0016`, `0101`–`0107`, `0117`, `0118`,
  `0121`–`0124`, `0137`, `0138`, `0163`, `0198`, `0220`). O número é convenção; o
  executor se orienta pelo nome do arquivo.
- **"menu do admin agrupado em Principal/Produto/Sistema"** — o primeiro grupo não
  tem rótulo; só existem "Produto" e "Sistema".
- **"`verTodos: true` = dono e gestor"** — gestor tem `verTodos` em todos os
  módulos **menos `ponto`**, fechado por padrão nos dois conjuntos de permissão.
- **"janela de 30 dias no funil de remarketing"** — a janela é por cartão: nunca
  ativou 90d, teste vencido 30d, teste vencendo 7d.
- **`server/_core/` "tem totp guards"** — lá só existe o **teste** de regressão; o
  guard em si não mora ali.
- **`server/admin/` "é onde moram as integrações do painel"** — o router de
  integrações está em `server/integracoes/`.
- **`AdminErros` listado como página top-level** — está em `client/src/pages/admin/`.
- **A explicação do bug de TOTP está tecnicamente errada** no mecanismo (o getter
  não expõe `epoch`), embora a **conclusão** — nunca mexer no singleton — esteja
  certa e siga valendo.
- **"persist em cada chamada" (observabilidade do Sentry)** — só a leitura de
  issues persiste, e nem em todos os desfechos; o catch de rede não persiste.
- **Scripts de mutação citados (`scratchpad/mutar-trocar-plano.py`,
  `mutar-um-numero.py` e outros)** não estão no repositório. Só
  `scratchpad/mutar-relatorio-comercial.py` foi versionado. As mutações podem ter
  sido conferidas de verdade, mas o caminho citado não abre.

### 9.2.1 O padrão por trás da defasagem (e é o mais útil de entender)

Olhando as divergências juntas, elas não são aleatórias. São **quatro padrões**, e
cada um tem um conserto de escrita, não de código.

**1. O arquivo é escrito em camadas, e a camada nova não apaga a velha.**
O caso mais claro: um parágrafo de 09/09 diz que `crm.unificarContatos` **não** ganhou
a trava de CPFs diferentes; a entrega de 10/09, algumas dezenas de linhas abaixo,
diz que **ganhou**. As duas frases convivem no mesmo arquivo. O mesmo acontece com
`admin.criarCliente` (duas vezes "não pede WhatsApp", e ele pede) e com
`trocarPlanoAdmin` (duas vezes "só cancela depois", e ele não cancela).
Quem lê de cima para baixo acredita na primeira; quem lê por busca acha qualquer uma
das duas.
→ *Conserto:* quando uma entrega supera um texto anterior, **corrigir o texto
anterior** faz parte da entrega. É o que a regra do topo deste documento pede.

**2. Número contado uma vez, e nunca mais.**
As contagens de teste das amarras envelheceram sozinhas: `mesclar-cpf-diferente`
está escrito como 25 testes e tem **24**; `conferencia-cadastros` está como 37 e tem
**39**. A contagem geral estava 44 testes atrás. Nenhum desses números estava errado
quando foi escrito.
→ *Conserto:* a regra 2 do topo — número medido ou número nenhum.

**3. Caminho citado que não existe.**
Os scripts de mutação referenciados em várias entregas
(`scratchpad/mutar-trocar-plano.py`, `mutar-um-numero.py` e outros) **não estão no
repositório** — só um deles foi versionado. A conferência por mutação pode ter
acontecido de verdade; o que não dá é para alguém repetir.
→ *Conserto:* ou versiona o script, ou escreve "conferido por mutação, script não
versionado". As duas são honestas; citar caminho que não abre, não.

**Um caso em que o comentário assusta sem motivo — a podridão corta nos dois
lados.** O arquivo que baixa mídia do WhatsApp avisa, no cabeçalho: "Storage local é
efêmero em ambientes como Railway (container recicla, mídia some)". Isso era verdade
quando foi escrito e **não é mais**: a mídia vai para `./uploads/...`, o Dockerfile
define `WORKDIR /app` e cria `/app/uploads` como ponto de montagem, e o volume
`juridflow-volume` do Railway está montado exatamente ali — conferido no painel e
**validado fim a fim em produção**, com o log de boot mostrando
`uploadsDir: '/app/uploads'`. A mídia sobrevive a redeploy, e o comentário faz o
próximo leitor caçar uma perda de dados que não existe.
Anotei porque quase virou um achado grave meu: a regra extraída do código dizia
"mídia some", e só conferindo o Dockerfile contra o documento do volume ficou claro
que o texto é que envelheceu.

**4. O mockup aprovado e o código entregue divergem, e ninguém volta no mockup.**
O documento registra que o mockup da conferência de cadastros dizia "17 colunas" e
"ponto-e-vírgula", e que o código saiu com 16 colunas e vírgula. O código está certo;
**o arquivo do mockup segue divergente até hoje**. Como o mockup é a peça que o dono
aprova, ele vira uma segunda fonte de verdade que ninguém mantém.

Duas correções pontuais que saíram da mesma conferência e valem registrar:

- O achado **(b)** do robô que falava por cima do atendente — "as bolhas da mesma
  resposta não se reconferem entre si" — está listado como **não corrigido** e **já
  foi corrigido**: a função reconfere o status entre bolhas e interrompe as
  restantes.
- "Roteiro que espera resposta fica rodando por até 24h" — o prazo é **configurável
  de 1 minuto a 7 dias** (24h é só o padrão). O teto de 24h é do Atendente IA, não do
  roteiro.
- "Execução com `conversaId` só nasce em `dispararMensagemCanal`" — nasce também em
  `dispararNovoLead`. A conclusão que o texto tira a partir disso muda de alcance.

### 9.3 Um conflito entre a regra do dono e a skill que a implementa

A regra de 19/08 no CLAUDE.md é explícita:

> A entrega é o ARQUIVO HTML auto-contido (fontes embutidas em base64), **não PNG**
> — o dono abre no navegador dele. Ele já corrigiu isso uma vez ("pedi mockup EM
> HTML bem claro"); **não repetir.**

Mas `.claude/skills/mockup-juridflow/SKILL.md` diz o contrário, duas vezes: a
descrição é "mockups de tela em **HTML renderizado para PNG**", e o passo 4 é
"**Entregue.** `SendUserFile` com o **PNG**".

Ou seja: a skill que existe para produzir mockups vai fazer o próximo assistente
repetir exatamente o erro que o dono já corrigiu. **Isto é o conserto mais barato
de toda a auditoria** — alinhar a skill com a regra — e depende de autorização
porque mexe em instrução do dono.

### 9.4 O que ainda falta conferir nesta frente

A conferência dos **237 achados** catalogados em 03/09 (15 "BLOQUEIA", 117
"IMPORTANTE", 105 "MENOR", com id estável como `[kanban-1]`, `[auth-x1]`) está
rodando. Esse documento nunca teve coluna de status, então **hoje ninguém sabe
quais foram corrigidos** — o único registro é a narrativa do CLAUDE.md, que é
justamente o que esta seção mostra estar defasada.

Quando a conferência fechar, o resultado entra aqui como tabela `id → estado`, e
passa a ser mantida pela regra do topo deste documento.

---

## 10. Achados por assunto (auditoria de subsistema)

Os subsistemas do servidor e as telas foram auditados um por um, com uma leitura
cética em cima de cada achado grave. Abaixo estão **só os de gravidade alta ou
crítica**, agrupados pelo que interessa ao dono. Os de gravidade média e baixa
existem em quantidade e entram neste documento conforme forem tratados.

Cada item cita o arquivo. Nenhum foi corrigido — esta passada foi de leitura.

### 10.1 Dinheiro — o que pode sumir, duplicar ou aparecer errado

1. **A faxina diária apaga parcelas de parcelamento longo.** `asaas-sync.ts`
   remove cobranças com vencimento a mais de um ano. O sistema permite parcelar em
   até 24×, de mês em mês — então **um parcelamento em 24× perde metade das
   parcelas** do Financeiro. *(crítico)*
2. **Transferência do Asaas para o banco é lançada como DESPESA.** A importação do
   extrato trata todo débito da conta Asaas como despesa, inclusive a retirada do
   próprio dinheiro. Isso **derruba o lucro do DRE** por um movimento que não é
   custo nenhum.
3. **O resumo financeiro do cliente soma só as 20 cobranças mais recentes.**
   `resumoContato` busca com `limit(20)` e calcula "pendente / vencido / pago"
   percorrendo esse recorte. Cliente com histórico longo aparece devendo menos do
   que deve.
4. **O webhook marca o evento como processado ANTES de gravar a cobrança.** Se a
   gravação falha, a retentativa do Asaas é descartada como repetida e **o
   pagamento se perde**.
5. **Criar assinatura recorrente não tem proteção contra repetição** e a assinatura
   **não é registrada no banco**. Requisição lenta + segundo clique = cliente
   assinado duas vezes. As procedures vizinhas (cobrança e parcelamento) têm duas
   camadas de proteção; esta não tem nenhuma.
6. **Cobrança manual também não tem.** Timeout + novo clique = lançamento duplicado.
7. **Um único 429 do Asaas congela a integração inteira por até 12 horas** — não só
   o endpoint que estourou.
8. **"Resetar histórico de cobranças" é mais destrutivo do que anuncia.** Apaga a
   tabela de idempotência do webhook (**o cliente pode receber cobrança por WhatsApp
   duas vezes**) e o log que impede o robô mensal de fechar o mesmo período
   novamente (**a comissão pode ser lançada duas vezes**), mas preserva a despesa já
   lançada. Deixa ainda o acordo apontando para uma cobrança apagada. E o caminho de
   recuperação que a própria mensagem manda seguir **não existe na tela**.
9. **A trava que protege comissão já fechada existe em uma porta e não na outra.**
   Vincular beneficiário pela porta nova recusa mexer em cobrança já comissionada; a
   tela do Financeiro usa a porta velha, sem trava. E "Desvincular" não devolve a
   comissão ao atendente original, embora o código prometa que é reversível.
10. **Os cartões do topo do Financeiro e o gráfico contam status diferentes** —
    dois totais para a mesma coisa, na mesma tela.
11. **CPF com máscara versus só dígitos cria ficha duplicada** em pelo menos três
    caminhos (webhook, adoção de órfãs e "Novo cliente" do Financeiro). O cadastro
    guarda o CPF exatamente como foi digitado; a busca compara só dígitos.

### 10.2 Quem vê o quê — permissão faltando em coisa sensível

12. **O saldo da conta Asaas e a prévia da chave de API vão para qualquer
    colaborador logado** (`asaas.status`, sem gate de Financeiro).
13. **Qualquer colaborador lê o dinheiro de qualquer cliente.** `resumoContato` e
    `resumoPorContatos` — que alimentam o crachá financeiro da ficha — não checam
    permissão nenhuma. Na tela, a aba Financeiro da ficha **mostra os valores para
    quem tem o módulo Financeiro inteiro desligado**.
14. **Três botões de sincronizar não pedem permissão de Financeiro**, e um deles
    **move pagamentos entre clientes**.
15. **"Sincronizar clientes" reescreve nome e CPF de todos os clientes** sem pedir
    permissão, ao contrário de todas as procedures vizinhas.
16. **"Monitorar"/"Parar" na ficha do cliente não checa permissão** — qualquer
    colaborador liga uma vigilância paga ou apaga a existente.
17. **Assinatura eletrônica não tem gate nenhum** (já detalhado em **D-5**).
18. **Duas mutations de canal ficaram sem o gate de gestão** — qualquer colaborador
    marca o número como registrado e rearma o disjuntor anti-banimento.
19. **Salvar um fluxo do SmartFlow escreve por id sem amarrar o escritório** quando
    o cargo tem "editar" sem "ver" — o único caminho de tenancy que sobrou nesta
    varredura.

### 10.3 O robô e a automação

20. **Depois de um passo "Esperar (delay)", o fluxo retoma no bloco errado.** Só os
    blocos que esperam mensagem do cliente gravam onde pararam; o `esperar` não
    grava, e a retomada **conta passos em vez de seguir as setas**. *(crítico)*
21. **Execução pode ficar "rodando" para sempre.** O claim atômico zera o prazo de
    retomada antes de carregar o cenário; se o cenário não existe mais, aquela linha
    nunca mais é tocada por ninguém. *(crítico)*
22. **"Esperar" com minutos negativos trava a execução para sempre**, e o aviso do
    editor afirma exatamente o contrário.
23. **Com dois fluxos ativos no mesmo gatilho, qual roda é sorte** — a consulta não
    tem ordenação.
24. **"Executar agora" manda WhatsApp frio para qualquer número digitado.** O
    saneamento do contexto manual remove canal, contato e conversa, mas deixa passar
    o telefone — e a exigência de opt-in não pega, porque o número não é contato.
25. **Um botão de menu chamado "Cancelar" ou "Sair" descadastra o cliente dos
    avisos** e mata o fluxo no meio. A palavra é interpretada como opt-out.
26. **A confirmação de descadastro é enviada mesmo com o atendente conduzindo a
    conversa** — o robô fala por cima dele, pelo caminho que as travas de 10 e 11/09
    não cobrem.
27. **A resposta fixa do canal é reenviada a cada mensagem do cliente** — cinco
    mensagens, cinco respostas iguais. Não há controle de repetição.
28. **A resposta do robô não guarda o identificador da Meta**, então falha de
    entrega nunca aparece, e no modo celular a bolha duplica.
29. **As travas de envio não conferem a janela de 24 horas** em todos os caminhos:
    fluxo automático e aviso de chamada perdida vão para a Meta e tomam erro 131047.
30. **Uma ligação recebida de número desconhecido grava
    `contatos.responsavelId`** — exatamente o campo que o resto do sistema evita
    gravar de propósito, porque ele gruda o cliente no primeiro atendente para
    sempre.
31. **O pedido de permissão de ligação é a única mensagem proativa que não exige
    opt-in**, e não respeita o limite da Meta de um pedido por 24h.

### 10.4 Telas que prometem o que o servidor não faz

32. **"Busca por CPF/CNPJ em +90 tribunais"** — o servidor procura em **um**
    (detalhado na seção 9.2).
33. **A tela de Processos cobra em "créditos" que o servidor parou de debitar em
    11/09.** "Custo: 1 crédito" aparece na consulta, no buscar histórico e no resumo
    de IA. O que vale hoje é o teto mensal do plano.
34. **A Central de Movimentações mostra no máximo 80 linhas** — sem paginação, sem
    "carregar mais" — e **as contagens saem desse recorte**.
35. **A busca da Central diz "por cliente"** e procura num campo que é sempre o CNJ.
36. **"Ativar monitoramento automático" da importação do Advbox não funciona com a
    credencial nacional** — que é justamente a recomendada no Cofre.
37. **"Monitorar" pega a primeira credencial do Cofre sem olhar o tribunal**, e o
    servidor aceita.
38. **"Nova Conversa" diz "Conversa iniciada!" e a mensagem não sai** quando o
    número nunca falou com o escritório.
39. **Nos templates de mensagem, `{{email}}` e `{{escritorio}}` sempre saem em
    branco** — e `{{escritorio}}` é o exemplo que o próprio campo sugere.
40. **"Ligar via WhatsApp" usa o telefone do cadastro em vez do número da
    conversa** — e o do cadastro pode estar sem DDI.
41. **Trocar o "Responsável pelo atendimento" não funciona para atendente**, mas a
    tela deixa escolher e responde "Atualizado!".
42. **Instagram e Messenger conectam e mostram "Conectado" sem nunca receber nem
    enviar mensagem** (detalhado na seção 5.3.1).
43. **WhatsApp conecta, a inscrição no webhook falha, e a tela comemora
    "Conectado"** — a falha não é gravada nem mostrada.
44. **Quem conecta o Asaas durante um rate limit fica "conectado" para sempre sem
    webhook registrado** — nada em tempo real, e em silêncio.
45. **O limite de conexões de WhatsApp do plano não é aplicado no fluxo de um
    clique** — só nos dois caminhos manuais.

### 10.5 O editor de fluxos (SmartFlow) — o que atrapalha quem monta

46. **Ligar/desligar o cenário no topo apaga as alterações não salvas.**
47. **Sair do editor com alterações não salvas não avisa nada** — apesar de a tela
    mostrar "Alterações não salvas" em amarelo.
48. **Duas setas saindo do mesmo ponto de saída: só uma é salva** (as duas aparecem
    desenhadas).
49. **Apagar uma opção e criar outra gera duas com o mesmo código** — um caminho se
    perde.
50. **"Testar cenário" nunca consegue testar um fluxo de conversa**, porque o
    servidor remove o contato do contexto — e o próprio diálogo sugere preencher
    justamente esse campo.
51. **Bloco sem a configuração obrigatória mostra bolinha VERDE "Configuração OK"**
    e quebra na execução: a validação não cobre metade dos tipos.
52. **No "Mover card" do Kanban, o quadro escolhido não é salvo**, e mexer nele
    apaga a coluna.
53. **A galeria de "modelos prontos" nasce vazia para todo escritório** — o diálogo
    convida a escolher um modelo e não há nenhum.

### 10.6 Nada nisto foi inventado

Todo item acima passou por duas leituras: a que encontrou e uma cética que tentou
derrubar, indo ao código conferir se havia guard, gate, default ou caminho
alternativo que o primeiro não viu. O que não sobreviveu à segunda leitura ficou
fora — incluindo, como registrado no item **D-4**, um achado meu.

---

## 11. Varreduras que atravessam o repositório

Aqui estão os achados que só aparecem olhando o repositório inteiro num ângulo só
— e são, em média, os mais graves da auditoria. Os números dizem o tamanho da
varredura, não são adjetivos.

### 11.1 Implantação e observabilidade: três coisas que o painel afirma e não são

Este trio é o mais importante do documento depois do dinheiro, porque **o dono está
olhando um painel que mente para ele.**

1. **Nenhuma variável `VITE_*` chega ao build do cliente.** O build roda dentro da
   imagem (`RUN pnpm build` no `Dockerfile`), e o Dockerfile **não declara um único
   `ARG`**. Como o Vite só embute variáveis presentes no momento do build, tudo que
   o cliente esperava do ambiente chega vazio. É o que explica, por exemplo, o
   widget de captcha **nunca poder aparecer**, independente de a chave existir no
   Railway. *(crítico)*
2. **O campo de DSN do Sentry no painel não vai a lugar nenhum.** A captura de erros
   do servidor liga **exclusivamente** por variável de ambiente
   (`SENTRY_DSN_BACKEND`), e o painel exibe "Sentry conectado" com base em outra
   coisa. Ou seja: é possível — e provável — que o monitoramento de erro esteja
   **13/09:** a Visão rápida de Saúde passou a AFIRMAR a captura: `adminErros.listar`
   devolve `capturaConfigurada` = `capturaSentryConfigurada(process.env)`
   (`SENTRY_DSN_BACKEND || SENTRY_DSN`, a mesma régua de `initSentry`) e a linha
   "Erros no sistema" fica âmbar "não dá pra afirmar" enquanto nenhuma das duas
   existir (seção 18).
   **desligado** enquanto a tela garante que está ligado. Isso fecha o círculo com
   o JurisIA, que não tem Sentry nenhum: o erro não aparece em lugar algum.
   *(crítico)*
3. **`ENCRYPTION_KEY` faltando ou trocada joga no lixo, em silêncio, a mensagem de
   WhatsApp que chega** — e o log culpa o cliente. *(crítico)*

Escala da varredura: **63 variáveis de ambiente distintas**, 36 delas lidas por
código de produção do servidor. A afirmação do CLAUDE.md de que só `JWT_SECRET` e
`DATABASE_URL` derrubam o boot **está correta** e foi conferida linha a linha. O que
a frase esconde é o tamanho do "resto": ao menos **seis** casos em que a falta da
variável apaga funcionalidade paga sem aviso, e em **três** deles o painel afirma
ativamente o contrário.

E um de autenticação, que merece linha própria:

4. **`GOOGLE_CLIENT_ID` ausente desliga a checagem de para-quem-o-token-foi-emitido
   no login Google.** O código valida o token no Google e depois confere se ele foi
   emitido **para o JuridFlow** — mas só se a variável existir. Sem ela, um token
   legítimo emitido para **outro aplicativo** passa. *(alto)*

### 11.2 Os testes: onde o verde não significa nada

O repositório tem 5.570 testes verdes. Três descobertas sobre o que esse verde cobre:

5. **O job de CI chamado "Smoke tRPC (todas as procedures)" não reprova por nada.**
   Ele chama todas as procedures procurando erro 500, **encontra, imprime no log e
   passa verde** — a asserção que reprovaria não existe. *(crítico)*
6. **Os 23 testes de smoke ficam verdes sem banco, sem verificar nada.** Todos
   começam com um retorno antecipado se não há `DATABASE_URL`, e o relatório diz
   "23 passed" em vez de "23 pulados".
7. **`pnpm check` não typecheca uma única linha de teste** — são **74.439 linhas**
   fora do radar, e isso já produziu um bug silencioso que está documentado no
   próprio código.

E sobre os dois robôs:

8. **O robô de ação clica em "Excluir", "Apagar", "Monitorar" e "Carregar
   detalhes".** Existem duas travas no repositório: a ampla, com 26 padrões de ação
   proibida, e a estreita — e o robô usa a estreita. Ele exercita ação destrutiva e
   ação **paga**.
9. **O Dockerfile afirma uma trava de produção que não existe.** Ele instala o
   Chromium sempre, justificando que "em produção o `exigirAmbienteTeste()` no
   router bloqueia a execução" — e **essa função não existe no repositório**. O robô
   de jornada do painel pode rodar em produção e **escrever um escritório de teste
   no banco de produção**. *(alto)*
10. **Confirmado o que eu já havia achado: existem DOIS seletores de "está
    carregando"**, e o do Playwright é cego para os **161 esqueletos** do app.

### 11.3 O spike que virou produção

**A pasta que o próprio README chama de "descartável" e que diz "TUDO RODA EM
STAGING" é hoje o motor de produção de consulta processual do TJCE.** São 3.996
linhas de código de spike no bundle que roda em produção, e **2.755 delas — o
scraper — não têm um único teste que as execute** (os testes que existem leem o
arquivo como texto).

Dois pontos de honestidade da varredura, que valem registrar:

- **O risco de deploy NÃO se confirmou.** O `esbuild` embute import relativo no
  arquivo final; o build foi rodado de verdade e o `dist/index.js` contém as fontes
  do spike inlinadas. O servidor em produção não precisa da pasta existir.
- Os riscos reais são de manutenção: **`pnpm format` reescreve 802 linhas do
  scraper de produção e quebra um teste**, porque o `.prettierignore` não cobre
  `scripts/`; e os scripts da raiz dessa pasta ficam fora do `pnpm check` — um deles
  já apodreceu de verdade.

### 11.4 Dado que se grava e ninguém lê

Varredura de **2.803 exports** em 670 arquivos, **126 tabelas** e **1.538 colunas**.
Os quatro casos que importam:

11. **A trilha jurídica de aceite dos Termos é gravada e nunca lida.** A tabela
    `aceites_termos` (quem aceitou, quando, de qual IP, qual versão) tem **três
    pontos de gravação e zero leitura** em todo o código. É exatamente a prova que
    se produz para ser apresentada depois — e não há como apresentá-la. *(alto)*
12. **A origem do opt-in e do opt-out de WhatsApp é gravada e nenhuma tela lê** —
    justo o dado que a Meta pediria numa contestação de spam. *(alto)*
13. **"Avise quando meu tribunal chegar" grava o pedido e ninguém nunca lê.** Um
    insert, zero leituras, nenhuma tela de admin. O escritório pede e o pedido morre
    no banco.
14. **Quatro tabelas sem nenhum consumidor** (já detalhado na seção 4), incluindo o
    módulo do Diário da Justiça inteiro.

E duas funcionalidades prontas que ninguém alcança:

15. **O atendimento que "vence por silêncio" nunca vence.** A função que fecha
    atendimento parado existe, **é testada**, e **ninguém a chama**. *(alto)*
16. **O motor de cálculo de FGTS está completo e testado, e nenhum usuário consegue
    alcançá-lo** — 246 linhas de cálculo e redação de parecer sem porta de entrada.

### 11.5 Comentários que mentem — e um deles é sobre segurança

Varredura de **696 arquivos** não-teste. Os piores:

17. **O cabeçalho do Cofre garante que "o backend NUNCA retorna senha/TOTP em
    claro" — e 1.069 linhas abaixo ele retorna o segredo TOTP.** *(alto)*
18. **O comentário da tabela `planos` — a fonte de verdade do faturamento —
    descreve OUTRA tabela, já apagada, e manda deletar esta.** *(alto)*
19. **O robô auditor jura usar a mesma lista de status do financeiro e usa uma
    lista curta**, reproduzindo o exato bug que já custou comissão. *(alto)*
20. **A nota de metodologia impressa no PDF do DRE lista 3 status; o cálculo usa
    4.** O escritório arquiva e entrega esse PDF. *(alto)*
21. E o que eu já havia achado: o cabeçalho do cron de monitoramento chama de
    "placeholder" uma função implementada 830 linhas abaixo, no mesmo arquivo.

### 11.6 Tenancy: a varredura completa

**779 procedures** examinadas (614 exigem login, 142 exigem admin, 23 são
públicas), em 54 arquivos de router, mais os helpers de banco, as rotas HTTP de
upload e assinatura por token, o SSE e os webhooks.

Resultado: **um caso** sobrou, e é de gravidade alta, não crítica:

22. **`tarefas.criar` aceita cliente de outro escritório** (grava `contatoId` sem
    conferir o dono) **e a Agenda depois mostra o nome dele.**

Isso é uma notícia boa e vale dizer com clareza: as 8 amarrações de 03/09 e as 3 de
10/09 seguraram. O padrão multi-tenant do sistema está, hoje, substancialmente
correto — o problema de permissão que sobrou não é "vejo o escritório do outro", é
"vejo o que não deveria dentro do meu" (seção 10.2).

---

## 12. Os 237 achados de 03/09: estado hoje

Este é o registro que faltava. O documento `auditoria-lancamento-2026-09-03-achados.md`
tem 237 achados com identificador estável (`[kanban-1]`, `[auth-x1]`, `[infra-2]`…)
em três níveis — **BLOQUEIA 15, IMPORTANTE 117, MENOR 105** — e nunca teve coluna de
status. **Todos os 237 foram reabertos e conferidos no código de hoje**, com uma
segunda leitura cética sobre cada veredito "corrigido" (é o erro caro: declarar
resolvido o que não está).

| estado | quantos | o que significa |
|---|---|---|
| **CORRIGIDO** | **57** | o defeito não existe mais, com prova positiva no código |
| **ABERTO** | **172** | o defeito está lá |
| **PARCIAL** | **8** | parte foi corrigida |

**Três de cada quatro seguem abertos.** Isso não é descuido: é consequência de não
existir lista. Ninguém fecha o que não consegue ver — e é exatamente o buraco que o
documento de estado passa a tapar.

Nota de método: nenhum dos 57 "corrigido" passou sem teste que o trave
(`corrigidosSemTeste: 0`), e o cético derrubou 3 vereditos do primeiro leitor.

### A notícia boa: os bloqueadores de lançamento seguraram

Dos **15 "BLOQUEIA"**, **14 estão corrigidos** e **1 está PARCIAL**. Nenhum ficou
aberto. As amarrações de 03/09 e 10/09 funcionaram.

O parcial é o `kanban-2`, e vale entender porque é um padrão que se repete:

> **A porta foi fechada, a vidraça continua sem grade.** O achado pedia duas coisas.
> A **gravação** foi corrigida e testada: nenhuma tela, cron, automação, importação
> ou restauração consegue mais colar num card o cliente ou o responsável de outro
> escritório — id alheio devolve "não encontrado". Mas a **leitura** não mudou: o
> quadro, a gaveta do card e o PDF ainda buscam nome, CPF e e-mail só pelo id, sem
> conferir o escritório, em três lugares. Não é mais explorável por quem tenta hoje
> (precisaria de um card gravado ANTES da correção), nenhuma limpeza de dados foi
> feita, e nenhum teste protege esse lado.

### Os 29 que seguem abertos com gravidade alta hoje

Reavaliados com o código de hoje, não com a gravidade de 03/09. Agrupei pelo que
têm em comum, porque a lista solta esconde o padrão.

**Permissão: "ver os próprios" respeitado em umas telas e ignorado em outras**

| id | o que acontece |
|---|---|
| `relatorios-x1` | o Painel Geral mostra **o caixa do escritório inteiro** para atendente, estagiário e SDR |
| `financeiro-6` | "ver próprios" do Financeiro **libera o escritório inteiro** em quase todas as procedures |
| `publico-1` | no Ponto, cargo com só "ver próprios" recebe **o espelho da equipe inteira** |
| `processos-3` | atendente vê "0 monitorados" enquanto a central mostra os processos |

**Permissão: portas sem gate nenhum**

| id | o que acontece |
|---|---|
| `kanban-17` | funil e colunas: **qualquer colaborador cria, renomeia e exclui** |
| `financeiro-7` | sincronizações que reescrevem contatos e apagam vínculos, sem gate |
| `infra-6` | vincular e sincronizar contato no Asaas, sem gate de Financeiro |
| `configuracoes-1` | a tela de Configurações decide "pode editar" por cargo escrito na mão, **ignorando a matriz** |

**Escalada de privilégio (confirmei eu mesmo, é o mais sério do grupo)**

`configuracoes-6` — `atribuirCargo` protege o **alvo** (o colaborador só pode ser do
seu escritório) e **não valida o `cargoId`**. E a matriz de permissão resolve o cargo
lendo `permissoes_cargo` **só pelo id, sem escritório**. Somando os dois: quem tem
"editar equipe" atribui a um colaborador do próprio escritório um **cargo de outro
escritório** — basta acertar o número — e esse colaborador passa a ter as permissões
que o cargo alheio tiver. É vazamento de configuração entre escritórios usado como
elevação de acesso.

**Automação (SmartFlow)**

| id | o que acontece |
|---|---|
| `smartflow-1` | salvar apaga e regrava passos de cenário **de outro escritório** quando o cargo tem "editar" sem "ver" |
| `smartflow-4` | retomada depois de "Esperar" continua **por posição, não pelo desenho** das setas |
| `smartflow-2` | ligar/desligar "Ativo" no editor **descarta alterações não salvas** |
| `smartflow-6` | cenário **desligado ou na lixeira** continua respondendo conversas que já estavam pausadas |

**Dinheiro e relatório**

| id | o que acontece |
|---|---|
| `financeiro-1` | o PDF e o CSV do DRE saem por "pagamento" e a tela mostra "vencimento" |
| `relatorios-1` | a aba Comercial do Dashboard **quebra com erro de código** quando nenhum colaborador está num setor |
| `relatorios-2` | "enviar por e-mail" e "programar envio" **descartam o filtro** da tela |
| `kanban-10` | a escolha "Avulsa / Parcelamento / Manual" é ignorada e abre sempre em Avulsa — confirmar cria cobrança real no Asaas |

**Assinatura, conta e cadastro**

| id | o que acontece |
|---|---|
| `assinaturas-2` | **o IP de quem assina nunca é registrado** — vem do navegador e o navegador não manda. A tela promete que registra |
| `auth-8` | ~~cadastro apaga conta de quem não tem escritório~~ **fechado 12/09** (é o **D-13**) |
| `auth-5` | os Termos prometem acesso até o fim do período pago; cancelar **corta na hora** |
| `auth-6` | a cota mensal lê **uma assinatura qualquer** do dono, sem filtrar status |
| `auth-4` | no trial de plano com preço, o botão do próprio plano fica desabilitado: **não dá pra assinar** |
| `clientes-x3` | a ficha abre pelo lead, mas Salvar e "Fechar contrato" recusam |

**Os demais**

`kanban-13` (excluir tag: um clique sem confirmação remove de todos os clientes e
cards) · `agenda-2` (processo vinculado usa o id errado numa chave) · `agenda-7` (a
tela Prazos lista só de −7 a +30 dias sem dizer, e prazo distante "desaparece") ·
`processos-7` (importação Advbox não liga monitoramento com a credencial nacional) ·
`processos-11` ("marcar como resolvidas" age no período inteiro, ignorando a busca) ·
`ia-9` (o caso em análise "gruda" na conversa seguinte e é gravado nela).

**`assinaturas-2` merece um parágrafo à parte.** Assinatura eletrônica vale pelo que
consegue provar. A tela diz ao cliente que registra o IP; o servidor espera o IP vir
do navegador, e o navegador não manda. Então a trilha de prova sai sem ele. Junto com
o `D-5` (a assinatura não tem controle de permissão nenhum) e com a tabela de aceite
dos Termos que ninguém lê (seção 11.4), é a terceira vez que este documento encontra
o mesmo tipo de lacuna: **o sistema produz a prova e não guarda, ou guarda e não
consegue apresentar.**

### Como manter isto vivo

A tabela completa `id → estado` está no resultado da conferência. A partir daqui vale
a regra do topo deste documento: **entrega que fecha um achado muda o estado dele no
mesmo commit.** É a única forma de a lista não virar, de novo, 237 linhas que ninguém
sabe se valem.

---

## 13. Números finais da auditoria

O que as oito passadas examinaram, com o que cada uma mediu de verdade.

| passada | escopo medido | resultado |
|---|---|---|
| Documentação | **1.016 afirmações** do CLAUDE.md conferidas uma a uma | 892 conferem · **76 desatualizadas ou erradas** · 48 inconferíveis |
| Os 237 achados | **237 de 237** reabertos | 57 corrigidos · 172 abertos · 8 parciais |
| Subsistemas do servidor | 10 subsistemas, os maiores do repo | **104 achados** · **368 regras de negócio** mapeadas |
| Telas | 8 áreas, **264 fluxos de usuário** percorridos | **186 achados** · **98 fluxos incompletos** |
| Arquivos gigantes | 15 blocos lidos linha a linha | **168 achados** · 213 regras |
| Varreduras transversais | 8 ângulos sobre o repo inteiro | **95 achados** |
| Varreduras complementares | 8 ângulos (comentários, spike, e2e, ambiente) | **153 achados** |
| APIs externas | 7 integrações × documentação oficial | **92 divergências**, 63 confirmadas na doc |
| Desempenho | build do client medido + índices cruzados com 4 fontes | pacote de **1,77 MB** compactado · **24 colunas sem índice** · 104 laços com consulta |

### Código morto, com o método

A varredura de exports foi a mais cuidadosa, e vale registrar como ela evitou o falso
positivo fácil. Ela não pergunta "o nome aparece em outro lugar?" — isso confunde
homônimo com uso. Pergunta três coisas separadas e cruza: **quem importa o nome**,
**quem usa o símbolo dentro do arquivo**, e **o arquivo é alcançável a partir do
boot**. Duas implementações independentes chegaram ao mesmo número, e os 15 casos
ambíguos foram resolvidos à mão.

| medida | valor |
|---|---|
| exports examinados | **2.803**, em 670 arquivos |
| vivos | 1.789 |
| `export` sem consumidor, mas o símbolo é usado dentro do próprio arquivo | 554 |
| **completamente morto** (nem no próprio arquivo é referenciado) | **94** |
| exportado só para o teste alcançar | 359 |
| **arquivos não alcançáveis** do boot do servidor nem do cliente | **36** (4.647 linhas) |

Os 554 são ruído de `export` largado, não código morto — arrumar é higiene barata. Os
**94** e os **36 arquivos** são o alvo de verdade.

---

## 14. Honestidade sobre a própria auditoria

Três coisas que o leitor precisa saber para calibrar o que está escrito aqui.

**1. A camada cética não cobriu tudo.** O desenho era: todo achado grave passa por um
segundo leitor que tenta derrubá-lo. Isso funcionou nos primeiros — e foi assim que o
meu erro do Twilio (item **D-4**) e três vereditos da conferência dos 237 foram
pegos. Mas a sessão bateu no limite de uso e **uma parte dos revisores não chegou a
rodar**. Os achados que passaram pelos dois leitores estão marcados como confirmados;
os que não passaram vêm da primeira leitura, com evidência de arquivo, e merecem uma
conferência antes de virar trabalho.

**2. A cobertura não é uniforme.** Foi mais funda onde o risco é maior —
dinheiro, WhatsApp, automação, painel admin, e os arquivos maiores do repositório. Ficou
mais rasa em cálculos, peças jurídicas, RH e ponto. Onde não se olhou, o documento diz.

**3. Nada foi executado.** Nenhuma tela foi aberta, nenhum banco de produção
consultado, nenhuma chamada real feita a tribunal, Meta, Asaas ou DataJud — o proxy
deste ambiente bloqueia todos. Os testes foram rodados (5.570 verdes) e o build foi
rodado uma vez, para conferir o achado do spike. O resto é leitura de código com
arquivo e linha.

A regra do topo deste documento resolve isso ao longo do tempo: cada entrega que
tocar num item conferido aqui corrige o registro. O que está errado neste documento
vai aparecer — e aí ele se conserta, em vez de envelhecer.

---

## 15. O que a venda promete × o que o produto entrega

Esta seção é de risco **comercial e contratual**, não técnico. Cada linha confronta
um texto que o cliente lê antes de pagar com o código que atende aquilo depois.

### 15.1 O mais grave: a cobertura de tribunais

> **Estado em 13/09:** o texto da venda ficou honesto em 12/09 (seção 15.4.1) e o
> motor ganhou a Justiça do Trabalho em 12–13/09 (seção 15.1.1, mergeado em
> develop e main em 13/09, sem comprovação em portal). O diagnóstico abaixo é o de
> 12/09 e continua valendo para o TJSP.

A comparação da landing dizia **"Monitora processos e novas ações por CPF/CNPJ com
motor próprio"**, sem uma linha de ressalva. Os três cartões de plano vendem
**"Vigia 300 / 1.000 / 2.500 processos"**.

O que o motor conhece hoje (fonte: `coberturaTribunais()` em
`shared/tribunais-pje.ts`, que alimenta todos os textos):

| caminho | quais | comprovado em campo |
|---|---|---|
| com credencial no Cofre | 12 TJs (CE, DF, MA, MG, MT, PA, PB, PE, RJ, RN, RO, RR) e TRF1, TRF2, TRF3, TRF6 | só o TJCE (o TJMT teve login validado pelo dono em 31/08) |
| consulta pública, sem credencial | TRF5, TRT2, TRT15 | nenhum (os adapters dos TRTs nunca abriram o portal) |
| em teste, com credencial | TRT1 a TRT24, 1º e 2º grau | nenhum; endereços deduzidos do padrão histórico do PJe-JT |

**Fora: TJSP** (e-SAJ; adapter é a próxima fase) — e os demais estaduais.

Isso não é um detalhe de cobertura. São Paulo é o maior tribunal do país, e os TRTs
são a Justiça do Trabalho inteira. Um escritório trabalhista que assinar o plano hoje
**não consegue vigiar um único processo dele**. Um escritório de São Paulo idem. Nada
na tela avisa, e a ressalva que existe nos cartões fala de outra coisa ("novas ações:
TJCE por enquanto"), o que na prática dá a entender que o *resto* funciona em todo
lugar.

E há a camada de baixo, da seção 5.7: dos 16 que estão na lista, o endereço de seis
deles é montado com o padrão do TJCE e provavelmente está errado. Então o número
realmente comprovado continua sendo **um** pelo código — **dois** contando o TJMT, que o dono validou com login real em 31/08 (relato dele no CLAUDE.md; o sistema não guarda esse resultado fora da grade do Cofre em produção, que é a fonte a conferir antes de publicar qualquer número).

### 15.1.1 Motor próprio — fase 1 (12–13/09), em produção, aguardando validação em campo

Origem: o dono, 12/09 — *"quero que crie logo o motor, nada de DataJud, processos
lá têm atrasos de meses"*. Três frentes em worktrees, integradas em 13/09 e
**mergeadas em develop e main em 13/09 ("pode mergear")**. Nada dela pôde ser
conferido daqui (o ambiente não alcança portal nenhum): a validação é nos portais,
pelo dono, na ordem abaixo.

O que mudou:
- **Despachante** (`consultarProcesso` em `server/processos/adapters/index.ts`):
  um lugar só decide o caminho pelo tribunal do CNJ. Consulta pública quando
  existe adapter aberto (vence mesmo com sessão — o caminho com credencial dos
  TRTs é candidato não comprovado e o aberto não pede login); senão PJe com a
  config DO tribunal (antes o runner da aba Consultar chamava sem config e caía
  sempre no TJCE — com credencial de outro estado a aba não funcionava); tribunal
  do registro sem sessão dá "exige credencial no Cofre"; fora dos dois, a mesma
  mensagem do router. O cron perdeu o `if (tribunal === 'trf5')` literal.
- **Consulta pública**: `pje-trt.ts` (TRT2 e TRT15, adapter do spike do TRF5
  reaproveitado), mapa `ADAPTERS_PUBLICOS` com import sob demanda; a lista
  compartilhada `TRIBUNAIS_CONSULTA_PUBLICA_PJE` tem que bater com o mapa
  (teste trava nos dois sentidos).
- **Justiça do Trabalho com credencial**: os 24 TRTs entraram em `REGISTRO` e
  `REGISTRO_G2` (`pdpjTrtConfig`, `/primeirograu/` e `/segundograu/`), o Cofre
  aceita `pje_trt1..24`, `sistemaCofrePorTribunal(trtN)` = nacional, processo
  trabalhista passa a "ter motor próprio". Na shared são o balde `emTeste` de
  `coberturaTribunais()`: o robô aceita e tenta, o número vendido
  (`totalTribunaisVigiaveis`) não os conta.
- **Busca por CPF/CNPJ** (`consultarPorDocumento`, `consultarDocumento`,
  `criarMonitoramentoNovasAcoes`): só em tribunal que EXIGE credencial
  (`tribunalRequerCredencial`) — consulta pública não tem busca por parte, e os
  TRTs ficaram FORA do seletor de CPF de propósito (só o TJCE é comprovado). O
  tribunal-base do monitor de novas ações passou a entrar na lista vigiada.
- **Parsers puros** (`adapters/parse/`, `linkedom` como devDependency) com
  fixtures sintéticas feliz/nenhum/layout-mudado — ainda NÃO substituem o
  `page.evaluate` do adapter de produção: precisam de HTML real salvo de um
  portal antes de assumir.
- **Textos**: `bulletVigiaPlano` → "12 TJs e 4 TRFs com credencial; TRF5, TRT2 e
  TRT15 sem credencial; outros 22 TRTs em teste — TJSP ainda não"; migration
  0227 troca o bullet dos 3 planos (só onde o texto ainda é o da 0223; editado
  no painel fica). Aba Consultar e guia usam `textoConsultaNaHora()`.
- **Amarras**: `adapters/index.test` (14), `pje-trt.test` (5),
  `parse/pje-lista.test` (15), `motor-proprio-despachante` (20),
  `processos-consulta-publica-router` (15), bloco PJe-JT em
  `tribunais-pdpj.test` (12) — 29 mutações vermelhas
  (`scratchpad/mutar-motor-despachante.py`, `mutar-trt.py`).

**Só o dono valida (ordem sugerida):** (1) rodar a auditoria de portais do
painel admin com os alvos `trt2-1g/2g` e `trt15-1g/2g` — diz se o PJe-JT
redireciona pro SSO do PDPJ antes de gastar login; (2) consulta real no TRT2 e
TRT15 pela aba Consultar, sem credencial; (3) aba Consultar num tribunal do
registro fora do TJCE (TJMG, TJRJ, TRF1) com credencial; (4) "Testar tudo" no
Cofre — atenção: com credencial nacional passou a ter **78 combinações** (24
TRTs × 2 graus a mais), sem teto de tempo; "Parar" continua funcionando.

**Ficou de fora, anotado (tela → precisa de mockup):** a tela não manda
`codigoTribunal` na busca por CPF (o servidor aceita; o padrão é a sede);
`ImportarAdvboxDialog.tsx` escreve "consulta pública (TRF-5…)" em texto fixo em
três lugares; `GradeTribunais.tsx` diz "12 estados" no cabeçalho; o rótulo
derivado "PJe — todos os estados (N)" conta TRFs e TRTs como estados;
`consultarCNJSincrono` ("Carregar detalhes" das novas ações) não passa pelo
despachante; filtro por segmento (TJ/TRF/TRT) na grade do "Testar tudo".
**Próxima fase**: TJSP (e-SAJ, `esaj_tjsp`), a partir do spike `EsajTjceScraper`
(login + busca prontos, extração não).

### 15.2 Limites vendidos que o código não impõe

Três dos números impressos nos cartões não têm trava correspondente:

| vendido | o que o código faz |
|---|---|
| **armazenamento** (2 GB / 10 GB / 50 GB) | a soma por escritório **existe e está pronta** (`verificarLimite` com o recurso `armazenamento`, em `plan-limits.ts`) — e **nenhum caminho de upload a chama**. O único consumidor dela é `obterResumoUso`, que só desenha a barrinha na tela. Pior: `salvarArquivo` recebe o tamanho **do navegador** (`tamanho` é um campo opcional do input), então o número que a soma usaria é informado por quem sobe o arquivo |
| **número de WhatsApp** (1 / 2 / 5) | o limite existe e funciona nos **dois caminhos manuais** (`criarCanal` e `conectarWhatsappCloudManual`) e **não existe nos dois que o cliente realmente usa**: `connectWhatsApp` (o Embedded Signup, o botão "Conectar com a Meta") e `exchangeCode` (CoEx). Os dois gravam o canal direto, sem olhar o plano |
| **usuários** (2 / 5 / 15) | a única trava é no **envio** do convite; `aceitarConvite` não confere nada. E o comentário em cima da trava diz "Conta ativos + convites pendentes pra dar feedback antes da pessoa aceitar" — a função que ele chama conta **só colaboradores ativos**. Mandar 10 convites com 2 vagas passa; os 10 entram |

Isso é generosidade acidental, não fraude — mas é dinheiro na mesa e, pior, é um
número que o comercial usa para diferenciar plano e que não diferencia nada.

### 15.3 Recursos vendidos que não existem

- **Instagram aparece em três lugares da venda** (a lista de integrações da landing,
  o card "Atendimento omnichannel — WhatsApp, Instagram e e-mail num inbox só", e o
  cartão do plano de entrada, que vende "Atendimento no WhatsApp oficial (API Meta) e
  Instagram") e **o produto não recebe nem envia uma única mensagem de Instagram**.
  - **Não recebe:** a primeira linha do processamento do webhook é
    `if (body.object !== "whatsapp_business_account") return;` — descarte em silêncio,
    e não existe nenhum outro endpoint no servidor que atenda `object: "instagram"`.
  - **Não envia:** o despachante de canal recusa o tipo `instagram` explicitamente, e
    **há teste travando a recusa** (`canal-envio.test.ts`, "recusa tipos não
    suportados"). Ou seja: a ausência é deliberada e conhecida no código.
  - **O que funciona é só conectar:** `connectInstagram` cria o canal e o botão de
    testar bate na Graph API só pra ver se o token vive. O canal fica verde,
    escrito "conectado", para sempre — sem nunca trocar uma mensagem.
  O conserto barato aqui é o texto, não o código: tirar Instagram da venda enquanto
  não existe. Isso é **remoção** e depende de autorização sua.
- **O cartão "Sob medida" promete "Tudo do Escala, e mais"** — e entrega **menos**.
  Conferido migration a migration: a 0217 transformou o antigo plano `completo` em
  "Sob medida" mexendo **só** em nome, descrição, preço sob consulta, ordem e texto
  dos cartões. Os limites dele continuam os da seed de 0108, de muito antes:
  - **atendentes de IA: 5** (o Escala, que ele diz superar, tem 10);
  - **JurisIA bloqueado**: a regra que libera exige o módulo na cesta **e** cota
    maior que zero (`addon-jurisia.ts`). O módulo ele tem, herdado do grandfather da
    0200; a cota nunca foi preenchida e continua no default 0 da 0172. O Escala tem
    200. Ou seja, o cartão mais caro é o único dos quatro em que o JurisIA não abre;
  - os tetos mensais da 0221 (consultas de processo, buscas de documento, resumos de
    IA) foram preenchidos para `atende`, `escritorio` e `escala` — e **não** para ele.
  Esse é o efeito colateral clássico de vender por dado editável: os três planos novos
  nasceram completos na migration e o quarto ficou para trás sem ninguém notar, porque
  nada no sistema compara o que um cartão promete com o que a linha dele contém.

### 15.4 Uma cláusula dos Termos que o código contradiz

A cláusula 5 dos Termos de Uso diz, com todas as letras:

> "Ao cancelar a assinatura, o acesso permanece até o fim do período já pago."

O cancelamento **corta o acesso no mesmo segundo**. Conferi o caminho inteiro:

1. A procedure de cancelar (`cancel`, em `subscription.ts`) grava
   `status: "canceled"` **e** `cancelAtPeriodEnd: true` na mesma linha. O comentário
   dela até explica o porquê: "Asaas não tem cancel at period end".
2. Quem decide se a conta tem acesso é `temAcessoAtivo`. Ela libera `active`,
   `trialing` dentro do prazo e cortesia dentro do prazo. `canceled` cai no
   `return false` final — **sem olhar `currentPeriodEnd` nem `cancelAtPeriodEnd`**.
3. O campo `cancelAtPeriodEnd` **não é lido por tela nenhuma**: o servidor o devolve
   no payload de `getAllSubscriptionsWithUsers` (listagem do painel admin), mas nenhum
   arquivo do client o consome e nenhuma regra de acesso o consulta. (Corrigido em
   12/09 pela crítica do mockup: a versão anterior deste item dizia "para exibir".)

Então a coluna que existe justamente para cumprir a promessa do contrato é escrita
com o valor certo e **ninguém a lê**. Não é um bug de tela: é o documento contratual
dizendo uma coisa e o sistema fazendo outra, contra o cliente que já pagou o mês.
É o item `auth-5` da seção 12, e aparece aqui porque a consequência é jurídica.

**A boa notícia é que o conserto é pequeno**, porque a peça já está no lugar: bastaria
`temAcessoAtivo` liberar `canceled` enquanto `cancelAtPeriodEnd` for verdadeiro e
`currentPeriodEnd` estiver no futuro. É mudança de regra de negócio (mexe em dinheiro
e acesso), então precisa da sua decisão antes — não de análise técnica.

### 15.4.1 Decisões do dono (12/09/2026)

Lidas as seções 15.1–15.4, o dono decidiu, nas palavras dele: **"Deixar o
Instagram como 'em breve', cobertura do tribunal corrigir, e o 3 não entendi."**
E fixou uma regra de trabalho: **toda sugestão nasce como mockup HTML navegável**,
para ele entender e aprovar — ou não — antes de qualquer código.

| item | decisão | estado |
|---|---|---|
| Instagram (15.3) | fica na venda, marcado **"em breve"** — não some | aguardando mockup |
| Cobertura de tribunais (15.1) | **corrigir** | aguardando mockup (o mockup mostra os dois caminhos: corrigir o texto e ampliar a cobertura, com o custo de cada um) |
| Acesso após cancelar (15.4) | não entendido | o mockup explica com datas, antes de pedir decisão |
| "Sob medida" entrega menos (15.3) | sem decisão ainda | entra no mesmo mockup como aviso |

**Mockup entregue em 12/09: `mockup-instagram-tribunais-cancelar.html`** (raiz do repo;
HTML navegável, fontes embutidas, sem referência externa; 4 abas; revisado por seis
leitores críticos contra o código antes da entrega). O que a crítica mudou na proposta,
e que vale como fato para quem for implementar:

- **Instagram**: são **8 lugares** (3 na venda + 5 telas do app — a 5ª é a descrição do
  gatilho "Mensagem recebida" em `GATILHO_META`, `shared/smartflow-types.ts`). Em
  Configurações → Canais, **quem abre o diálogo é o `onClick` do Card inteiro**, não o
  botão "Conectar" (que não tem handler) — travar só o botão não resolve. E
  `TIPO_CANAL_META` já marca `instagram`/`facebook` com `emBreve: true`, flag que nenhuma
  tela lê: é a fonte única natural. O inbox **não tem canal de e-mail** (enum de
  `canaisIntegrados.tipo`), então "WhatsApp, Instagram e e-mail num inbox só" promete
  duas coisas que não existem — virou decisão 1c.
- **Tribunais**: vigiar por número = **17** (16 com credencial + TRF5 público); vigiar por
  CPF = 16; consultar na hora = **1** (`motor-proprio-runner.ts` só trata `tjce`; por
  CNJ os outros 16 falham *depois* de `contarUso`; por CPF busca só TJCE em silêncio).
  São **quatro** mensagens de erro divergentes, não três (a 4ª: "Sistema cofre pra TRF-5
  ainda não mapeado" — o TRF5 não consulta na hora). Dos 16 com credencial, 6 têm
  endereço confirmado com login que não passou (tjrj, tjrn, tjpa, tjro, tjpe, tjdf —
  overrides no `REGISTRO`) e 8 são derivados nunca tentados. `adminTribunais.auditar` é
  um GET **sem credencial** (só diz se o portal redireciona pro SSO do PDPJ), e o Cofre
  **não aceita TRT** (`SISTEMAS_VALIDOS` deriva do REGISTRO; regex `tj|trf`) — o "teste
  sem código" responde só se o login é o mesmo. Caminho mais barato para a Justiça do
  Trabalho: **consulta pública TRT2/TRT15** (o `TRF5Scraper` de produção herda do
  `TRT2Scraper` do spike) — dias, não semanas, só por CNJ. Fonte única de siglas
  proposta: `TRIBUNAIS_PJE` (grafia TJDFT) + consulta pública.
- **Cancelar**: **`cancel` faz DELETE da assinatura no Asaas** — "reativar" não é
  religar, é criar assinatura nova com vencimento no fim do período (ou adiar o DELETE).
  `subscriptions` **não guarda ciclo nem data do último pagamento**: honrar o período
  exige dado novo (migration) ou consulta ao Asaas na hora. **Quatro** lugares gravam
  `canceled`: `subscription.cancel` (único com o flag), `cancelarAssinaturaAdmin`,
  `cancelarAssinaturaPorAsaasId` e o webhook `SUBSCRIPTION_DELETED`. A tela mostra
  "Próxima cobrança em 30/09" para `dueDate` 01/09 + 30d por causa do fuso
  (`toLocaleDateString` de meia-noite UTC). Efeitos colaterais de liberar `canceled` em
  `temAcessoAtivo`: botão Cancelar deve sumir; `cancel` deve recusar; troca de plano na
  carência e `encerrarOutrasAssinaturas` (que hoje só encerra
  `STATUS_SUBSTITUIVEIS`); ordem em `getActiveSubscription`; o teste
  `cortesia-acesso.test.ts` ("status='canceled' bloqueia") terá de mudar.

**Decisões do dono (12/09, depois do mockup): "em relação aos tribunais, quero que
crie logo o motor, nada de datajud, processos lá tem atrasos de meses. o resto tá
aprovado."** Lido item a item:

| decisão | resultado |
|---|---|
| 1 · Instagram | aprovado como proposto: selo nos 8 lugares, card travado — **ENTREGUE** (fonte única `canalEmBreve` em `shared/smartflow-types.ts`; o `onClick` do Card em Configurações → Canais não abre o diálogo quando em breve; migration 0222 troca só o 1º bullet do Atende, idempotente; amarra `instagram-em-breve.test.ts`, 19 testes, 10 mutações vermelhas) |
| 1b · Messenger | aprovado: mesmo selo — **ENTREGUE** junto com o 1 |
| 1c · "e-mail" | aprovado como proposto: "Instagram e e-mail em breve" (a palavra fica) — **ENTREGUE** junto com o 1 |
| 2 · Tribunais, texto | aprovado: todos os lugares, incluindo as 4 trocas de texto marcadas como remoção — **ENTREGUE** (fonte única em `shared/tribunais-pje.ts`: `coberturaTribunais`, `textoCoberturaCurto`, `listaSiglasCobertas`, `mensagemTribunalSemMotor`, `chipPjeIntegracoes`…; o servidor DERIVA `TRIBUNAIS_CONSULTA_PUBLICA` do shared e as 5 recusas de tribunal sem motor passam pelo mesmo helper; migration 0223 troca o bullet "Vigia…" dos 3 planos pelo índice certo; diálogo Monitorar avisa antes do clique e abre o pedido preenchido via `?tab=cofre&interesse=<SIGLA>`; **fila que avisa**: migration 0224 `interesse_tribunais.avisadoEm`, procedures `admin.interessesTribunais`/`admin.avisarInteressadosTribunal`, card "Fila de tribunais pedidos" em /admin/saude → Visão rápida, e-mail `tribunal_disponivel` ao dono do escritório, um por escritório, auditado; amarra `tribunais-texto-honesto.test.ts`, 42 testes, 12 mutações vermelhas). Ressalva: o bullet gravado em `planos.features` é retrato de hoje — tribunal novo no registro atualiza site/app/erros sozinho, mas o bullet do plano precisa de migration nova (o teste acusa) |
| 3 · Tribunais, cobertura | **motor próprio para TJSP e TRTs (caminhos B, C e D); DataJud (A) recusado** — "processos lá têm atrasos de meses" |
| 4 · Cancelar | aprovado: honrar a cláusula 5 — **ENTREGUE** (migration 0225: `ultimo_pagamento_em`, `ciclo`, `fim_periodo_pago_em`, `aviso_fim_acesso_enviado_em` em `subscriptions`, backfill não destrutivo; o webhook de pagamento grava o fim do período pago = vencimento + 1 mês/1 ano no fuso do escritório, 30 dias quando o ciclo é desconhecido; `temAcessoAtivo` libera `canceled` com `cancelAtPeriodEnd` e período pago no futuro; `escolherAssinaturaAtiva` (pura) fixa a ordem cortesia > active > trialing > cancelada-em-carência; regra única de "até quando" em `shared/assinatura-carencia.ts`; os 4 lugares que cancelam gravam a marca; `encerrarOutrasAssinaturas` encerra a cancelada-em-carência quando a nova é paga, sem chamar o Asaas de novo; Plans.tsx trocou o `confirm()` por AlertDialog com a data e o hero mostra "Acesso até"; e-mails `assinatura_cancelada` e `acesso_termina_3dias` (cron diário, uma vez); amarra `cancelar-periodo-pago.test.ts`, 33 testes + 3 em `cortesia-acesso`, 17 mutações vermelhas). Ressalvas: assinaturas canceladas ANTES desta entrega continuam bloqueadas (não há como saber o período pago delas — reparo por SQL só com decisão do dono); ativa com `currentPeriodEnd` já vencido fica sem data até o próximo pagamento; textos dos dois e-mails escritos sem mockup |
| 4b · Reativar | aprovado: sim — **ENTREGUE** (`subscription.reativar`: cria assinatura nova no Asaas com `nextDueDate` no dia seguinte ao fim do período pago, `billingType UNDEFINED`, mesmo plano/ciclo/valor negociado; a MESMA linha volta a `active`; falha do Asaas não muda nada e volta como BAD_GATEWAY legível) |
| 4c · Cancelamento direto no Asaas | aprovado: honra o período também — **ENTREGUE** (webhook `SUBSCRIPTION_DELETED`, `cancelarAssinaturaAdmin` e `cancelarAssinaturaPorAsaasId` gravam `cancelAtPeriodEnd` e, se faltar, `fimPeriodoPagoEm` a partir de `currentPeriodEnd` futuro) |
| 5 · Sob medida | aprovado: igualar ao Escala — **ENTREGUE** (migration 0226: cada limite vira `GREATEST(atual, Escala)`, NULL/0 = sem limite preservados, módulos do Escala entram sem duplicar; amarra `sob-medida-igual-escala.test.ts`, 14 testes, 3 mutações vermelhas) |

Ressalva registrada na resposta ao dono: **este ambiente não alcança nenhum portal de
tribunal**; o motor para TJSP/TRTs é construído e testado com páginas gravadas, e nasce
marcado "não testado" até o dono validar pelo "Testar tudo" do Cofre. Implementação em
andamento — o estado de cada item entra aqui no commit da entrega.

### 15.5 Por que isto está num documento de engenharia

Porque todos os itens acima se consertam de dois jeitos — mudar o código ou mudar o
texto — e **os dois são baratos**. O que custa caro é descobrir pela reclamação de
um cliente que assinou esperando o TJSP, ou por um pedido de reembolso amparado na
cláusula 5. Nenhum deles precisa de decisão técnica: precisam de uma decisão do dono
sobre o que prometer.

---

## 16. Apagar, impersonar e avisar — três varreduras finais

Estas três não estavam no pedido original com esse nome, mas saem dele: "regras de
negócio" inclui o que o sistema promete fazer com o dado de uma pessoa, e "código
morto" tem um primo pior, que é o **código que existe mas não é chamado**. Os três
casos abaixo são desse tipo.

### 16.1 Excluir cliente não apaga o cliente inteiro

O comentário no topo de `excluir-cliente.ts` diz, com essas palavras:

> "Quando um cliente é removido do sistema, **todos os dados relacionados também
> devem ser removidos**."

Contei as tabelas do schema que guardam o `contatoId` de um cliente: são **16**. A
exclusão em cascata trata **11**. Ficam de fora, intactas, cinco:

| tabela | o que continua guardado sobre a pessoa excluída |
|---|---|
| `agendamentos` | **o telefone dela** (`contatoTelefone`), o título, a descrição e a observação do atendimento |
| `acordos` | **nome e telefone da parte contrária**, e todos os valores negociados |
| `cliente_processos` | o **número CNJ** dos processos dela, o tribunal, a classe e o valor da causa |
| `jurisia_conversas` | o **título da conversa** com a IA — que costuma ser a pergunta jurídica do caso |
| `atendimentos` | o registro de cada atendimento: quando abriu, quem atendeu, quando fechou |

Não há bloqueio nem aviso: a exclusão termina com `success: true` e a tela diz que
o cliente foi excluído.

**Por que isso importa mais aqui do que em outro sistema.** Os Termos de Uso do
JuridFlow colocam o **escritório como controlador** dos dados (é a palavra da LGPD
para "quem responde pelo dado"). Quando o cliente de um advogado pede exclusão, é o
escritório que tem a obrigação legal de apagar — e a ferramenta que ele usa para
cumprir isso é esse botão. Ele clica, o sistema confirma, e o número CNJ, o telefone
e a pergunta jurídica continuam na base.

### 16.2 Os arquivos continuam no disco

A exclusão apaga sim os blobs, mas por um caminho com uma trava de segurança que,
sem querer, vira um filtro:

```
const expected = `/uploads/escritorio_${escritorioId}/`;
if (!url || !url.startsWith(expected) || url.includes("..")) {
  return; // URL externa (S3 legacy, etc) ou maliciosa — ignorar silenciosamente
}
```

A trava existe por um bom motivo (impedir que uma URL manipulada apague arquivo de
outro escritório). Só que **dois tipos de arquivo do produto não moram nessa pasta**:

- a mídia recebida no WhatsApp, que vai para `/uploads/whatsapp-cloud/<escritório>/…`
  — foto, áudio, documento que o cliente mandou na conversa;
- o documento de assinatura eletrônica, em `/uploads/assinaturas/escritorio_<id>/…`.

Os dois caem no `return` silencioso. As linhas do banco somem, os arquivos ficam no
volume para sempre — e sem a linha do banco, **ninguém mais sabe que eles existem**,
nem para apagar depois.

### 16.3 Nada nunca é apagado por idade

Procurei rotina de expurgo, retenção, faxina por data: **não existe nenhuma**. Mensagem
de 2024, conversa encerrada, lead perdido, log de e-mail, execução de fluxo — tudo
fica indefinidamente. Isso tem dois custos: o banco só cresce (e o backup da
plataforma já não termina por causa disso — item **D-14**), e a LGPD trabalha com a
ideia de que dado pessoal se guarda pelo tempo necessário, não para sempre.

Não estou dizendo para sair apagando. Estou dizendo que **hoje não existe a decisão**
— e "para sempre" é uma decisão, tomada por omissão.

### 16.4 Impersonação: o desenho é bom, a premissa que o sustenta é falsa

Quando você entra na conta de um cliente pelo painel, o sistema faz um monte de coisa
certa: a sessão dura 1 hora e não a duração normal, não deixa impersonar outro admin,
o cache de permissão é separado para não vazar entre as duas sessões, e a saída
confere o seu cargo **naquele momento** (se você tivesse sido rebaixado no meio,
sair derruba tudo, não devolve poderes).

E dentro da impersonação você vira superusuário do escritório. O código diz por quê:

> "Admin impersonando: acesso total de superuser, independe do cargo do alvo.
> (decisão de produto — **ações ficam auditadas em nome do admin original**.)"

A troca é explícita e defensável: poder total em troca de rastro total. **O problema
é que o rastro quase não existe.** Medi:

| | |
|---|---|
| procedures no servidor | **779** |
| chamadas de `registrarAuditoria` | **49** |
| onde elas estão | 36 no painel admin, 8 nos agentes de IA, 2 no financeiro do admin, **2 no app inteiro** |

As duas do app são "cancelar contrato" e "reativar contrato". Tudo o mais que se faz
dentro do escritório durante uma impersonação — editar cliente, apagar cliente, mexer
em cobrança, mudar fluxo, subir ou excluir documento — **não gera uma linha de log**.

A parte de auditoria que funciona é boa: a entrada é registrada com hora, IP e alvo, e
quando há registro o ator gravado é o **admin de verdade**, não o usuário-alvo. O que
falta é o registro existir nas ações.

E há um segundo buraco, independente da impersonação: a tabela `audit_log` **não tem
coluna de escritório**. Ela é uma trilha da plataforma, para você. O escritório — que
é o controlador dos dados perante a lei — não tem como ver o que foi feito dentro da
conta dele, nem por você, nem por um colaborador dele.

**O que eu faria** (não fiz, é mudança de código): auditar as ações destrutivas do app
— excluir cliente, excluir arquivo, excluir card/coluna, mexer em cobrança, trocar
responsável — e dar à `audit_log` a coluna de escritório, para que essa trilha possa
um dia virar uma tela do escritório. São poucas linhas em cada procedure e nenhuma
mudança visível para o advogado, o que dispensa mockup.

### 16.5 Notificações: aqui está certo

Registro o que está bem-feito, porque documento que só lista defeito ensina errado.

As notificações do sino são amarradas pelo `userId` em **todas** as operações — ler,
marcar como lida, marcar todas, apagar uma, limpar as lidas. Cada uma tem a cláusula
do dono na mesma consulta que faz a mudança, que é exatamente o padrão que falta em
outros lugares deste documento. Não achei um caminho de vazamento.

A única ponta solta é a mesma da 16.1: notificação **não é apagada** quando o cliente
é excluído, e o texto dela costuma trazer o nome da pessoa.

---

## 17. Otimização — o que está lento, medido

Esta seção fecha a última parte do pedido que gerou este documento ("otimização de
código"). Tudo aqui foi **medido**, não estimado, e o comando que produziu cada
número está junto.

Antes de começar, uma ressalva honesta: **não medi o sistema rodando com dados
reais**. Não tenho acesso ao banco de produção. O que está abaixo são custos que se
enxergam no código e no build — os que aparecem sem precisar de um cronômetro.

### 17.1 O que o navegador baixa antes de mostrar qualquer coisa

Rodei o build do client (`npx vite build`, 50 segundos). O resultado:

| | |
|---|---|
| arquivo principal | **7.311 kB** (1.772 kB compactado) |
| arquivos gerados ao todo | 332 |
| total publicado | 22 MB |

O arquivo principal é o que **todo usuário baixa na primeira visita**, antes de a
primeira tela aparecer. 1,77 MB compactado é muito: num celular em 4G de corredor de
fórum, são vários segundos de tela branca.

A causa é simples e está numa linha só de configuração: o `App.tsx` importa as **54
páginas de uma vez**, de forma estática. Não existe `React.lazy` em lugar nenhum do
client (`grep -c "React.lazy" = 0`). Então o código da Agenda, do SmartFlow, dos
Relatórios e do painel admin entra no mesmo pacote da tela de login.

O próprio Vite avisa isso no fim do build, com o nome do remédio:

> "(!) Some chunks are larger than 500 kB. Consider: using dynamic import() to
> code-split the application."

**O conserto é pequeno e não muda nada do que o advogado vê**: trocar os `import` das
páginas por `lazy(() => import(...))` e envolver as rotas num `<Suspense>`. Cada tela
passa a baixar quando é aberta. Não é mockup — é a mesma tela, chegando mais rápido.

### 17.2 Uma biblioteca de markdown que trouxe um compilador junto

Entre os 332 arquivos do build há coisas assim:

```
emacs-lisp-…js      779 kB
cpp-…js             626 kB
wasm-…js            622 kB
cytoscape.esm-…js   442 kB
mermaid.core-…js    403 kB
wolfram-…js         262 kB
```

Um sistema jurídico não tem por que carregar realce de sintaxe de **Emacs Lisp,
C++, Wolfram e Objective-C**, nem um desenhador de diagramas. Rastreei: vêm todos de
uma dependência só, `streamdown`, usada em quatro telas para transformar a resposta
da IA (texto com markdown) em texto formatado. Ela puxa `shiki` (realce de código,
com dezenas de gramáticas) e `mermaid` + `cytoscape` (diagramas) junto.

Esses pedaços **não estão no arquivo principal** — são carregados só se a página
precisar. Então o custo hoje não é de download, é de peso do build e de superfície:
22 MB de arquivos publicados para renderizar um parecer em negrito e itálico.

Não estou propondo arrancar a `streamdown` (seria remoção, e ela funciona). Estou
registrando que, se um dia o tamanho incomodar, **é aqui que está a gordura**, e a
troca por uma biblioteca de markdown simples resolve sem mudar uma vírgula do que
aparece na tela.

### 17.3 Consultas em laço — o caso que dá para ver

Varri o servidor procurando laço com consulta ao banco dentro: **104 ocorrências**.
A maioria é legítima (importação, robô, cron — coisas que precisam ir uma a uma).
O que interessa é o que está no caminho de uma tela. O mais claro:

**Abrir o painel de um card do Kanban** (`detalheCard`, em `router-kanban.ts`) busca
até 50 movimentações do card e, **para cada uma**, faz três consultas: o nome da
coluna de origem, o da coluna de destino, e o nome de quem moveu. São até **150
consultas ao banco para abrir uma gaveta**.

O conserto é a mesma ideia em três linhas: um funil tem meia dúzia de colunas e o
escritório tem poucos colaboradores — carrega-se a lista inteira **uma vez** e
resolve-se o nome na memória. Zero mudança visível.

**Renomear ou apagar uma etiqueta** (`editarTag` / `deletarTag`) tem a mesma forma:
busca todos os contatos e todos os cards que citam a etiqueta e atualiza **um por
um**, em laço. Num escritório grande com uma etiqueta popular, é uma operação que
pode demorar visivelmente — e o botão não avisa que está trabalhando.

### 17.4 Índice de banco: 24 colunas muito usadas sem nenhum

Esta é a mais importante da seção, e a que quase me fez errar.

Índice é o que permite ao banco achar uma linha sem ler a tabela inteira. Cruzei
**todas** as fontes de índice do projeto — os declarados no `schema.ts`, os criados
nas migrations, as chaves estrangeiras e os três criados no boot pelo
`auto-migrate.ts` — contra as colunas que o código realmente filtra.

> **Errei antes de acertar, e vale registrar:** minha primeira contagem deu 39
> colunas sem índice. Estava errada — meu filtro não reconhecia a escrita
> `CREATE INDEX IF NOT EXISTS`, que é justamente a que a migration 0017 usa. Refeito
> com a sintaxe certa, o número real é 24. É o mesmo tipo de erro que este documento
> cobra dos outros: contar sem conferir a fonte.

As 24, filtradas 10 vezes ou mais no código e **sem índice em lugar nenhum**:

| coluna | filtros no código |
|---|---|
| `tarefas.statusTarefa` | 39 |
| `agendamentos.statusAgendamento` | 34 |
| `canais_integrados.escritorioId` | 30 |
| `cliente_processos.escritorioIdCliProc` | 24 |
| `kanban_colunas.funilIdKC` | 23 |
| `agentes_ia.escritorioId` | 21 |
| `asaas_clientes.contatoIdAsaas` | 20 |
| `kanban_funis.escritorioIdKF` | 18 |
| `cliente_arquivos.escritorioId` | 17 |
| `canais_integrados.tipoCanal` | 16 |
| `cofre_credenciais.escritorioId` · `cliente_processos.contatoIdCliProc` · `cliente_pastas.escritorioIdPasta` | 14 cada |
| `smartflow_cenarios.escritorioIdSF` · `assinaturas_digitais.escritorioId` · `asaas_cobrancas.contatoIdAsaasCob` | 13 cada |
| e mais 9 entre 10 e 11 filtros | |

**Por que isso é pior num sistema multi-escritório do que num sistema comum.** Repare
quantas das colunas acima são `escritorioId` — a coluna que separa um escritório do
outro. Sem índice nela, toda vez que um escritório abre a tela de canais, de agentes
de IA, de documentos ou do cofre, o banco **lê as linhas de todos os escritórios**
para achar as dele. O efeito é que o sistema fica mais lento para cada cliente à
medida que **outros** clientes crescem. Hoje, com pouca gente, não aparece. É
exatamente o tipo de problema que só se manifesta depois de vender.

**De onde vem a lacuna.** Existe uma migration que faz esse trabalho — a **0017**,
chamada "Add missing indexes and foreign key constraints". Ela é boa e cobre o
essencial de `conversas`, `leads`, `contatos`, `tarefas`, `agendamentos`. O problema
é que foi uma **lista escrita à mão, uma vez**. Tabelas anteriores a ela ficaram de
fora (`agentes_ia` é da 0003, `canais_integrados` da 0011) e as posteriores só
ganharam índice quando quem escreveu a migration lembrou.

**A recomendação concreta**, e é barata: já existe no repo o teste
`migrations-colunas-de-indice.test.ts`, que confere se o nome da coluna de cada
índice bate com o schema — foi ele que pegou um erro de anos. Dá para estender o
mesmo teste com uma segunda regra: **toda tabela que tem `escritorioId` precisa ter
índice nele**. Aí a lacuna deixa de depender de memória. Criar os índices que faltam
é uma migration só, aditiva, sem mudança de comportamento — mas em tabela grande um
`CREATE INDEX` trava a tabela por um tempo, então isso se faz em janela combinada.

### 17.5 Arquivos que ficaram grandes demais

Não é lentidão de máquina, é lentidão de gente — e afeta a qualidade de tudo que vier
depois. Os maiores arquivos do projeto:

| arquivo | linhas |
|---|---|
| `client/src/pages/SmartFlowEditor.tsx` | 6.527 |
| `server/integracoes/router-asaas.ts` | 6.029 |
| `client/src/pages/Processos.tsx` | 5.202 |
| `client/src/pages/Atendimento.tsx` | 4.742 |
| `client/src/pages/Clientes.tsx` | 4.468 |
| `client/src/pages/Agenda.tsx` | 3.891 |
| `server/escritorio/router-relatorios.ts` | 3.701 |
| `server/smartflow/engine.ts` | 3.619 |

Seis arquivos passam de 3.500 linhas. Isso tem custo real e medível em três frentes:
é onde mais aparecem regras duplicadas (as três cópias do portão
`contatoEhDoEscritorio` estão em arquivos assim), é onde uma correção tem mais chance
de quebrar outra coisa, e é o que torna uma revisão completa inviável.

**Não estou propondo quebrar esses arquivos agora** — refatoração desse tamanho sem
motivo é risco puro, e a regra da casa é não mexer no que não foi pedido. Registro
como o lugar a preferir quando houver escolha: quando uma entrega encostar em um
deles, vale extrair a parte tocada em vez de engordar mais.

### 17.6 O que NÃO está lento, e é importante dizer

Documento que só aponta defeito ensina a temer o sistema inteiro. Conferi e está
certo:

- **As listas grandes paginam.** `clientes.listar` recebe `limite` (máximo 100) e
  `pagina`, e a consulta termina em `.limit(limite).offset(offset)`. A tela mais
  pesada do produto não carrega a base inteira.
- **As mensagens têm índice composto** (`conversaIdMsg, createdAtMsg`), que é
  exatamente o par pelo qual o inbox busca. Foi criado no boot, no `auto-migrate.ts`.
- **A matriz de permissão tem cache** com tempo de vida, e o cache é
  deliberadamente pulado durante impersonação para não vazar entre as duas sessões
  — detalhe fino, e está certo.
- **O histórico de movimentações tem teto** (`.limit(50)`). O problema do 17.3 é o
  laço, não a consulta.

## 18. Central de ajuda — REMOVIDA por inteiro (13/09)

O dono mandou: *"remova todo o módulo ajuda"*, depois de *"remova esse ajuda,
irei gravar os vídeos"*. A Central inteira saiu do produto; o lugar dela vai
ser ocupado por vídeos que ele mesmo vai gravar.

**O que foi apagado** (tudo em um commit, com o histórico no git):

- Telas: `client/src/pages/Ajuda.tsx`, `client/src/pages/ajuda/`
  (`AjudaTarefa.tsx`, `TextoComRotulos.tsx`, `tarefas.ts` — as 5 tarefas
  escritas e os 16 títulos "em breve").
- O "?" das telas: `client/src/components/AjudaDaTela.tsx` e os 5 usos
  (Processos, Clientes, Configurações → Equipe, Configurações → Canais,
  Financeiro).
- Rotas `/ajuda` e `/ajuda/:tarefa` no `App.tsx`, junto com o wrapper
  `ClientAreaSoTermos`, que só existia para elas.
- Portas de entrada no `AppLayout`: o botão do rodapé da barra lateral, o item
  "Ajuda" do menu do avatar no modo atendimento e a liberação de `/ajuda` no
  modo focado do celular.
- Primeiros passos por completo: `server/escritorio/router-ajuda.ts`
  (procedure `ajuda.primeirosPassos` e as 5 detecções), as regras puras de
  `shared/primeiros-passos.ts`, o bloco
  `client/src/pages/dashboards/PrimeirosPassos.tsx` (bloco do Dashboard +
  resumo da Central) e o namespace `ajuda` de `shared/modulos-contratacao.ts`.
- Os 9 prints reais de `client/public/ajuda/` (1,9 MB).
- As amarras do módulo: `central-de-ajuda.test.ts` e `primeiros-passos.test.ts`.

**O que FICOU de pé, de propósito:** a "Visão rápida" de `/admin/saude` em 3
linhas e o `shared/saude-semaforos.ts` nasceram na mesma entrega, mas são o
painel de saúde do admin — não são a Central, e ninguém mandou tirá-los. O
`redirect: false` do `serveStatic` também fica: ele nasceu por causa da pasta
`dist/public/ajuda`, mas vale para qualquer rota da SPA que colida com pasta de
arquivo estático (o comentário foi reescrito para não citar a Central).

O bloco "Primeiros passos" já tinha saído do Dashboard minutos antes, por um
pedido separado dele ("informação demais aqui") — a remoção do módulo alcançou
o resto.

Medido depois: typecheck limpo, 5.920 testes verdes em 400 arquivos.

## 19. A cor do menu vem da logo — APROVADA pelo dono (13/09)

Pedido dele, com um print do menu ao lado da logo: *"Vamos deixar a cor desse
menu mais alinhado com a logo real? vc tambem mudou a cor do icon."* As duas
observações estavam certas, e foram medidas no app rodando antes de propor.

### 19.1 O que estava acontecendo

| Onde | Antes | Na logo |
|---|---|---|
| Fundo do menu | `#16202c`, azul-ardósia | roxo-quase-preto |
| «Jurid» | `#c4ced8`, cinza-azulado | branco puro |
| «Flow» e o ponto do «J.» | `#a584ff`, violeta clareado | `#7c3aed` |
| Item aberto (barra e ícone) | `#6fa5dd`, azul | a logo não tem azul |

A cor do ícone mudou mesmo, e o histórico diz quando: em 02/09 uma troca de
paleta levou a marca junto e ela virou azul; em 04/09 ela voltou ao violeta
por um token só dela (`--marca`), mas um passo mais clara, para continuar
legível sobre o menu azul.

### 19.2 O que foi entregue (opção B do mockup)

`--sidebar`, `--sidebar-accent`, `--sidebar-primary` e `--sidebar-ring`
passam ao matiz da marca nos DOIS temas; `MarcaJ` escreve «Jurid» em branco
puro e mantém o acento no token da marca. Medido no navegador: fundo
`#191229`, marca branca + `#9a73ff`, item aberto `#a583ff` sobre `#32284b`.

O violeta EXATO da logo não passa no menu: dá 2,89:1 sobre o azul de antes e
3,18:1 sobre o roxo novo, contra o mínimo de 4,5:1 de leitura. O tom entregue
é a clareada mínima que passa — 5,41:1.

**A cor de ação do conteúdo não mudou**: à direita continua o marinho
`#194b86`. O violeta ficou dentro do menu, que é onde a marca aparece.

Amarra: `menu-cor-da-logo.test.ts` (6 testes) — 11 mutações, todas vermelhas
(`scratchpad/mutar-menu-cor.py`). Ela guarda as duas pontas: o menu na família
da logo e o marinho como cor de ação do conteúdo.

### 19.3 O que fica anotado

- `InstallPWA` e o cabeçalho do modo atendimento no celular pintam o ponto do
  «J.» com `--sidebar-primary` em vez do token da marca. Com esta entrega os
  dois passam a sair violeta por consequência, não por desenho — apontar para
  o token da marca é higiene e não foi pedido.
- A skill `mockup-juridflow` dizia "violeta não é o app". Continua verdade
  para o CONTEÚDO e deixou de ser para o menu; o texto foi corrigido junto.
- As opções A (só a marca) e C (meio-termo) ficaram no comparador
  `mockup-cor-do-menu.html`, caso ele queira voltar atrás.

---

## 20. Monitoramento voltando erro — ENTREGUE e autorizado pelo dono (13/09)

O dono relatou: *"processos estão retornando erro em monitoramentos, antes
funcionava mas outra sessão fez alterações e quebrou algo"*, e depois mandou o
texto do erro:

> O processo apareceu na busca, mas a página dele não abriu.
> URL: https://pje.tjce.jus.br/pje1grau/Processo/ConsultaProcesso/listView.seam

São **duas causas diferentes** na mesma frente, uma de cada entrega recente. A
que ele está vendo na tela é a 20.1. As outras três nasceram da entrada dos 24
TRTs no registro e já estavam envenenando a credencial dele em silêncio.

### 20.1 A guarda de 11/09 recusava página boa (é o erro do print)

Em 11/09 o adapter ganhou uma guarda contra ler a TABELA DE RESULTADOS: quando
a página do processo não abre, «Classe judicial» e «Polo ativo» estão na tela
como TÍTULOS DE COLUNA, e o scraper devolvia o título vizinho como valor do
campo — foi assim que «Polo ativo» virou a natureza da ação num card, e o poll
regravava `hashUltimasMovs` com o hash de ZERO movimentações, soltando uma
avalanche de "novas" no ciclo seguinte.

O diagnóstico estava certo; o **mecanismo** estava errado. A guarda decidia por
sniffing de página (`estaNaPaginaDoProcesso`): *"ainda tem a grade no DOM e
nenhum marcador de detalhe que eu conheça → desisto"*. Só que o PJe também
**monta o detalhe na MESMA aba, por AJAX**: não abre aba, a URL continua
`listView.seam` — é a URL do print — e a grade de resultados fica no DOM. Se o
painel usa um id fora da lista de marcadores, a guarda recusava uma página que
TINHA o processo aberto. Antes de 11/09 esse caso funcionava, porque o código
extraía da página atual sem perguntar.

Pior: a guarda passava **na frente** de uma rede de segurança que já existia
desde sempre no mesmo arquivo — o `conseguiuExtrair`, que reporta `parse_falhou`
com diagnóstico rico (tabelas da página, mensagens, estado do RichFaces, forms).

**O que mudou:** a decisão saiu do palpite sobre a página e foi pro RESULTADO da
extração. O clique que não confirma nada agora só levanta uma bandeira
(`detalheNaoAbriu`) e tira a foto; o fluxo segue, tenta extrair, e o erro só sai
se não vier conteúdo. Quem protege contra ler a tabela de resultados continua
sendo a recusa de rótulo dentro da extração (`ehRotuloDeTabela`), que devolve
campo nulo — não o sniffing. `orgaoJulgador` entrou na conta de "veio conteúdo"
junto com classe, partes e movimentações: detalhe que trouxe só a vara é página
do processo do mesmo jeito.

De passagem, o mesmo clique deixou de torrar o tempo do cron: ele esperava
`context.waitForEvent("page")` por 15s, **duas vezes**, por uma aba que nunca
vem quando o PJe resolve na mesma página — 30s por processo. Agora a espera é
uma corrida entre "abriu aba" e "o marcador apareceu aqui", com
`primeiroSinal`, que ignora quem falha (um `Promise.race` cru deixaria o null
ganhar a corrida e matar a espera que ia dar certo). Os marcadores do detalhe
viraram **uma** constante (`SELETOR_DETALHE_PROCESSO`) usada pela espera e pela
conferência — duas listas divergindo faria a espera desistir de uma página que a
conferência aceitaria.

### 20.2 Falha de portal candidato para de falar pela credencial

Medido neste container com `tsx`: o registro do PJe foi de **16 para 40**
tribunais (12 TJs + 4 TRFs + 24 TRTs), e a grade do Cofre de uma credencial
nacional foi de **30 para 78 logins reais**, 48 deles TRT. Os endereços dos TRTs
saíram do padrão histórico do PJe-JT e o próprio comentário de `pdpjTrtConfig`
diz "CANDIDATOS, sem exceção".

O estrago estava em `atualizarStatusAposLogin` e `marcarCredencialExpirada`:
as duas escrevem na **linha da credencial**, sem escopo de tribunal. Como os
TRTs entram no fim da fila de `Object.keys(REGISTRO)` e nenhum tem como
responder, era **sempre um TRT que dava a palavra final** — a credencial do
TJCE, que funciona todo dia, terminava a bateria marcada como `erro`. O mesmo
por outro caminho: qualquer relogin num TRT falhava e marcava a credencial como
`expirada`, com notificação "credencial caiu" pro dono.

`falhaDerrubaCredencial(tribunal)` (cofre-helpers) é a régua nova: **sucesso
sempre promove** a credencial — é ele que religa monitoramento preso —, e
**falha só derruba em caminho comprovado**. O resultado por tribunal continua
gravado sempre por `registrarTribunal`, inclusive no crash técnico (que antes
não registrava em tribunal nenhum): a célula do TRT fica vermelha e explicada, e
nada sai da tela. A de "credencial não pôde ser decriptada" segue global de
propósito — essa é da credencial, não de portal nenhum.

### 20.3 Os candidatos saem da fila do "Testar tudo", não da tela

O servidor marca cada linha da grade com `emTeste` (pela mesma régua da shared),
e a bateria roda só caminho comprovado com endereço: **78 → 30 alvos**, medido na
amarra. Os TRTs ficam numa dobra «Em teste — Justiça do Trabalho», cada um
testável pelo botão da própria linha, com o texto dizendo por que estão fora.

`alvosDaBateria` é fonte única: a barra de progresso e a fila usam a MESMA
conta — antes a tela tinha a sua, e prometer um total e rodar outro é o tipo de
coisa que ninguém nota até o dono ficar olhando a barra.

As contagens do rodapé passaram a falar só do caminho comprovado. Somar os
candidatos ali diria "48 falharam" sobre portais que ninguém prometeu.

### 20.4 Processo trabalhista só entra com prova de login

Decisão do dono, nas palavras dele: *"processos trabalhistas nega até credencial
de verdade"*.

`server/processos/tribunal-comprovado.ts`: `tribunalPrecisaDeProva` = é
candidato **e** depende de credencial (os 22 TRTs; TRT2 e TRT15 têm consulta
pública aberta e ficam de fora — barrar eles fecharia um caminho que já
funciona). A prova é objetiva e já estava no banco desde 01/09: uma linha `ativa`
daquele tribunal em `cofre_credencial_tribunais`, numa credencial não removida do
escritório. **Passou um login real, o tribunal libera sozinho** — sem mudar uma
linha de código, que é o ponto: quem decide se a Justiça do Trabalho entra é o
portal, não a nossa aposta.

O portão está nas quatro portas de processo (`consultarCNJ`,
`consultarCNJSincrono`, `criarMonitoramento`, `criarMonitoramentoNovasAcoes`) e,
na importação de planilha, como linha não elegível **com o motivo escrito** — a
planilha não aborta por causa de um processo trabalhista, e a leitura da prova é
UMA consulta pro lote inteiro (por linha, 500 processos seriam 500 idas ao
banco). Na consulta o portão vem **antes de `contarUso`**: consulta que já nasce
condenada a falhar não gasta consulta do plano.

### 20.5 `linkedom` era devDependency de um import de produção

`server/processos/adapters/parse/dom.ts` importa `linkedom`, e `pnpm build` usa
`--packages=external` — o pacote não é embutido, é resolvido em runtime. Hoje
nada de produção chama esse parser, então era uma mina: o dia em que
`adapters/parse/pje-lista.ts` entrasse no caminho de produção, o servidor
morreria no import, e o typecheck não vê isso. Movido pra `dependencies`, com
amarra.

### 20.6 Amarras

`tribunal-candidato-nao-derruba.test.ts` (18) e
`detalhe-no-lugar-nao-e-falha.test.ts` (10) — **27 mutações, todas vermelhas**
(`scratchpad/mutar-candidato-e-detalhe.py`). Quatro sobreviveram na primeira
volta e pelo MESMO motivo, que já é história conhecida da casa: o literal
continuava de pé em outro lugar do arquivo. As duas leituras de prova têm as
mesmas três condições (então conferir o arquivo inteiro deixava tirar de uma); os
dois caminhos de falha do relogin têm a mesma guarda (conferir um deixava o outro
escapar); e contar o nome da constante de marcadores não impede passar a
constante pro `evaluate` e procurar um seletor cravado lá dentro.

`cofre-grau.test.ts` teve um `expect` atualizado: a conta de quem entra na
bateria mudou de lugar (virou `alvosDaBateria`), a regra não.

### 20.7 Os dois resíduos — FECHADOS no mesmo dia ("pode fazer" do dono)

**Consulta pública no `consultarCNJSincrono`.** O `consultarCNJ` ganhou o desvio
em 12/09 e esta procedure não: ela pedia credencial do Cofre para tribunal que
não tem login. Ficou pior em 13/09, quando `sistemaCofrePorTribunal` passou a
devolver a credencial nacional para os 24 TRTs — TRT2 e TRT15, que funcionam
pela consulta aberta, passaram a tentar o login do PJe-JT, que não responde.

Agora os dois caminhos nascem do MESMO despachante: `consultaPublica =
!tribunalRequerCredencial(...)`, tudo que é do Cofre (sistema, credencial,
sessão) vive dentro do ramo que exige credencial, e o scrape é
`consultarProcesso(codigo, cnj, storageState)` com `storageState` nulo na
consulta aberta. Cobra igual — o que o tribunal dispensa é o login, não o custo
de rodar o robô — e cobra **depois** de todas as guardas, inclusive a do
tribunal candidato. Tribunal do registro sem endereço mapeado continua recusado
sem cobrar: não é tentativa que falhou, é cobertura que não existe.

**A foto do erro sobrevive ao deploy.** `tirarScreenshotErro` já fotografava a
tela do tribunal na falha e gravava em
`scripts/spike-motor-proprio/samples/screenshots/` — disco efêmero do container,
fora do volume, e nenhuma tela lia o caminho. O robô tirava a prova do que viu e
a jogava fora; foi exatamente o que faltou no diagnóstico da 20.1, que saiu de
leitura de código em vez de evidência.

`server/processos/print-do-erro.ts` move o arquivo para
`./uploads/monitor-erros/escritorio_<id>/` (servido com sessão + checagem de
escritório, como o resto de `/uploads`) e devolve a URL; a migration 0228 guarda
ela em `motor_monitoramentos.ultimo_erro_print_url`. A divisão é de propósito: o
adapter é código de spike e não sabe de tenancy, então quem CONHECE o dono do
monitoramento é que coloca o arquivo na pasta do escritório — a origem continua
sendo escrita onde sempre foi, nada mudou lá. Copia e apaga em vez de renomear
(o volume é outro mount, e `rename` falha entre dispositivos), nunca lança
(problema de disco não derruba o ciclo do cron) e o nome do arquivo é saneado
porque entra numa URL e num caminho de disco.

**Sucesso limpa a foto nos quatro caminhos** que limpam o erro — foto de erro
antigo ao lado de monitoramento saudável manda procurar problema na tela errada.
É o item 3 do padrão de observabilidade da casa (persistir → mostrar → auto-cura).

Na tela, o único pixel novo: um link «ver a tela do tribunal» ao lado do motivo
da parada no card do monitoramento, que só aparece quando há erro **e** foto.

Amarra: `consulta-publica-e-print-do-erro.test.ts` (13 testes) — **18 mutações,
todas vermelhas** (`scratchpad/mutar-publica-e-print.py`).

### 20.8 O que segue anotado e NÃO mexido

- **`sistemaCofrePorTribunal` devolve `pje_*` para trt2 e trt15**, que são
  consulta pública — o comentário logo abaixo do mapa afirma o contrário
  ("TRF-5 e demais tribunais de consulta pública NÃO entram aqui"). Com o desvio
  da 20.7 isso deixou de causar dano no caminho da consulta, mas o mapa continua
  discordando do próprio comentário.
- A falha de um TJ comprovado que esteja fora do ar (TJMG, digamos) continua
  marcando a credencial inteira. É pré-existente e não foi autorizado: a régua
  entregue trata só o portal candidato.
- A foto só é guardada no **poll de movimentações**. O laço de novas ações grava
  as falhas por tribunal em `varreduraJson` e não tem campo para foto — cabe o
  mesmo tratamento, não foi pedido.

---

## 21. Bloco comercial — ENTREGUE e autorizado pelo dono (13/09)

Ele perguntou o que dá pra melhorar no serviço oferecido. A resposta que deu
código foram três coisas que estavam **custando venda**, achadas conferindo o
repo e não de memória. Nenhuma é bug de tela: as três são dinheiro que não
entrava.

### 21.1 O cupom recusava exatamente os planos que estão à venda

`criarCupom` conferia `planosIds` contra a lista FIXA de
`server/billing/products.ts` (`free`, `basico`, `intermediario`, `completo`).
A tela do cupom (`CuponsSection`) lista os planos de
`admin.listarPlanosEditaveis` — a tabela `planos`, por slug. **A tela oferecia
o que o servidor recusava**: marcar «Escritório» no diálogo devolvia
`Plano "escritorio" não existe`. Ou seja, promoção, campanha e desconto de
fechamento não funcionavam em nenhum dos três planos vendidos desde 09/09.

Agora a conferência é a união catálogo + lista fixa — a fixa fica como reserva
pra base sem catálogo, mesmo padrão do `planosAtuais`. Nada removido.

### 21.2 Extras avulsos: os upsells anunciados agora têm mecanismo

Usuário a R$ 29, +100 processos a R$ 29, número extra a R$ 49 foram anunciados
com o pacote de 3 planos e ficaram **sem mecanismo** — o teto vive na linha do
PLANO, e não havia onde registrar "este cliente comprou 200 processos a mais".
O upsell mais fácil que existe (cliente dentro, já pagando, já com a dor) não
era vendável.

**Sem migration**: moram em `escritorio_addons` com produto `extra:<chave>`, a
MESMA tabela e a mesma semântica dos módulos avulsos. `limiteMensal` guarda a
QUANTIDADE e `precoCentavos` o preço mensal TOTAL, congelado na concessão.

Por que o preço é o total e não o unitário: ele anunciou "+100 processos por
R$ 29", que é pacote, não unidade — e negociar "200 por R$ 49 pra fechar o
cliente" tem que caber. Total congelado deixa a fatura somar a linha como já
soma a dos módulos, sem multiplicação e sem discutir o que é "um".

**A decisão do dono foi somar** ao que o plano dá: é aditivo, não mexe em quem
já tem, e revogar é apagar a linha.

**A sutileza que decide a correção** (`shared/extras-avulsos.ts`): os tetos do
produto **discordam sobre o que significa zero**. Em monitoramentos, `0` e
`null` querem dizer "sem teto" — `avaliarLimiteMonitoramentos` libera. Em
conexões de WhatsApp, `0` quer dizer "nenhuma" e bloqueia. Somar sem saber disso
daria dois erros opostos: transformaria plano ilimitado em plano limitado ao
extra, e deixaria o número comprado sem efeito em plano sem WhatsApp. Por isso
cada extra declara `zeroEIlimitado`, e `somarAoTeto` exige a opção explícita no
lugar de adivinhar.

Enforcement em quatro tetos: processos e CPFs (`limites-monitoramento`),
colaboradores (`plan-limits`) e conexões de WhatsApp. Neste último a conta
estava **copiada em três lugares** (a leitura da tela e os dois caminhos que
criam canal); virou `limiteConexoesWhatsapp`, uma função — extra que valesse só
num deles faria o número comprado funcionar ou não dependendo de por onde o
cliente entrou. Cortesia segue acima de qualquer teto.

Na fatura, `ItemFatura.tipo` ganhou `"extra"` e `calcularFatura` um campo
`extras` opcional — caller antigo sem extras produz a fatura de antes, e o
desconto do escritório incide sobre o extra também.

No painel, o cartão «Módulos & cobrança» ganhou o botão **Extra**, a lista das
concessões e o diálogo «Vender um extra» (quantidade + preço mensal + validade
+ observação, com sugestão por tipo). O X cancela zerando a quantidade, e o teto
volta a ser o do plano. Auditado como `extra.avulso`.

### 21.3 O JurisIA era vendido e a fatura não cobrava

Ele entrou no plano Escala em 09/09 com 200 consultas. Há **dois** caminhos de
concessão no painel e cada um quebrava de um lado:

- o **cartão do JurisIA** grava o produto `jurisia` seco (é o add-on mais antigo,
  anterior ao prefixo `modulo:`). A composição da fatura varre `modulo:%`, então
  nunca o via: o preço digitado era guardado no banco e **jamais cobrado**;
- o **diálogo de módulos avulsos** grava `modulo:jurisia`. A fatura somava, mas
  `acessoJurisIA` buscava só o produto seco — **cobrava e não liberava**, e o
  cliente batia na tela de bloqueio.

Os dois lados foram fechados, aditivamente: a fatura passou a incluir o add-on
do cartão (`avulsoJurisiaCobravel`) e a leitura de acesso passou a aceitar os
dois produtos (`addonJurisiaPorQualquerCaminho`). Duas proteções que valem a
pena registrar: concessão de graça (`precoCentavos <= 0`) não vira linha de
R$ 0 na fatura, e quando as duas concessões existem e estão vigentes a cobrança
**não dobra**. Vencido ou suspenso nos dois devolve a linha existente em vez de
null, pra a decisão pura explicar o motivo certo em vez de "nunca contratou".

### 21.4 Amarra

`bloco-comercial-extras-cupom-jurisia.test.ts` (22 testes) — **24 mutações,
todas vermelhas** (`scratchpad/mutar-bloco-comercial.py`). Duas sobreviveram na
primeira volta: a amarra do botão do painel conferia o `onClick` e não o RÓTULO
(apagar o texto deixava um botão invisível e ela passava), e a do prefixo do
produto só morreu com um caso que discrimina de verdade — `"modulousuarios"`,
que tem seis letras antes de uma chave válida, então quem cortasse cego sem
conferir o prefixo devolveria `usuarios` pra um produto que não é extra.

### 21.5 O que fica anotado, e a pergunta que sobrou

- **`getUserCreditsInfo`, `health.plansCount` e `db.ts` getPlanName/getPlanPrice
  ainda leem `PLANS`.** O cupom saiu da lista; esses quatro seguem nela e não
  foram autorizados.
- **Os extras não aparecem para o cliente.** Ele não vê "você tem +200
  processos" em lugar nenhum, e não há autoatendimento para comprar — hoje é
  venda pela conversa e concessão pelo painel, que é como ele descreveu.
  Mostrar na tela do advogado pede mockup.
- **O JurisIA segue sem Sentry e sem tela de consumo** (itens A.1/A.6 da fila).
  A cobrança cruzada — que era o A.1 — está fechada; o resto do A.6 continua:
  erro da OpenAI vai cru pro advogado e fica gravado no histórico dele, e a
  tabela `jurisia_uso` não é lida por tela nenhuma.
- **O maior limite do produto não é conserto, é investimento**: TJSP não tem
  adapter (é e-SAJ, motor diferente), e é o maior mercado de advocacia do país.
  Ou o motor cresce para lá, ou a venda se concentra nos estados que funcionam e
  o site diz isso com clareza. Decisão do dono.

---

## 22. Retorno do teste de uso do dono (13/09)

Ele entrou como cliente pra sentir a experiência e trouxe quatro coisas. Duas
**não eram defeito** — e explicar isso vale mais que "consertar" o que está
certo. Duas eram, e foram feitas.

### 22.1 "Os termos para aceite não apareceram" — não é defeito

O modal de termos (`TermosGate`) não aparece em dois casos legítimos, e o teste
dele caiu num deles:

- **Cadastro pelo site**: `auth.signup` já grava `termosVersaoAceita` porque o
  aceite acontece NO formulário (caixa de marcar + botão travado). O aceite já
  foi dado; pedir de novo no primeiro login seria pedir duas vezes.
- **Impersonação**: `termos.status` devolve `precisaAceitar: false` quando
  `ctx.user.impersonatedBy` existe. É de propósito — admin entrando na conta de
  alguém não pode aceitar contrato no lugar do cliente.

Onde o modal É o caminho: conta criada pelo painel (`admin.criarCliente`, que
**não forja** o aceite) e conta antiga, de antes da v2 dos termos.

**Consequência de produto, que é o que importa aqui**: testar a experiência
impersonando NÃO mostra a experiência real. O modal de termos some, e qualquer
coisa que dependa de `impersonatedBy` muda de comportamento. Pra sentir o que o
cliente sente, tem que entrar pela tela de login com a conta dele.

### 22.2 "Meta API não configurada" ao clicar em Conectar — falta config, e o diagnóstico é mudo

A tela diz "o administrador precisa cadastrar o App Meta". Ela está certa no
fato e ruim no diagnóstico: `getMetaAppConfig` devolve `null` em QUATRO situações
diferentes e as quatro viram a mesma frase.

1. `META_APP_ID` e `META_APP_SECRET` no ambiente — exige **os dois**; só um, cai
   pro banco;
2. banco: a linha `whatsapp_cloud` de `admin_integracoes`, cujo JSON precisa ter
   **appId E appSecret**;
3. decriptação falhando (a `ENCRYPTION_KEY` mudou) — vira `log.warn` e `null`;
4. sem banco.

O formulário do painel (Admin → Integrações → WhatsApp Cloud) pede os três
campos e só salva com os três, então quem preencheu por ali está coberto. O que
**não** cobre: `META_APP_SECRET_EXTRA`, que alimenta o HMAC do webhook, não
serve pro Embedded Signup — são coisas diferentes, e o registro de 03/09 no
CLAUDE.md fala do App Secret sem dizer que o **App ID** também precisa estar
salvo pra o botão Conectar funcionar.

**Gap de produto encontrado de passagem, NÃO corrigido**: o Embedded Signup do
WhatsApp precisa de um `config_id` da Meta, e o formulário do painel **não tem
esse campo** — ele só chega por `META_CONFIG_ID` no ambiente. `getMetaAppConfig`
até lê `config.configId` do banco, mas nada nunca escreve lá: caminho morto. Sem
ele, o popup abre um Facebook Login genérico em vez do fluxo de onboarding do
WhatsApp. Proposta (aguardando "pode fazer"): campo Config ID no formulário +
um diagnóstico no painel dizendo QUAL peça falta, em vez do silêncio de hoje.

### 22.3 Os cards que ensinam a usar saíram do Dashboard — a pedido dele

`PrimeirosPassos` saiu de `Dashboard.tsx`. O Dashboard é a tela de trabalho de
quem já sabe usar, e o bloco cobrava espaço do dono todo dia.

**Não foi apagado**: o conteúdo vive na Central de ajuda (`/ajuda`, via
`PrimeirosPassosResumo`), que é onde alguém vai quando tem dúvida. A amarra
`primeiros-passos` inverteu de lado — antes travava o bloco NO Dashboard, agora
trava que ele **não volta** e que o conteúdo **continua** em `/ajuda`. Repor é
uma linha.

**Ficou de fora, esperando a palavra dele**: o `GuiaProcessual`, o outro bloco
que ensina a usar, na variante processual do Dashboard (plano só-Processos).
Ele disse "os cards", no plural, mas os dois vivem em painéis mutuamente
exclusivos e ele só vê o primeiro — tirar o segundo sem confirmar seria remover
o que ele não olhou.

### 22.4 O diálogo "Cadastrar credencial" não cabia na tela, e pedia OAB

Duas coisas no mesmo diálogo, as duas do print dele.

**Não cabia**: o `DialogContent` não tinha teto de altura nem rolagem, e o
formulário é alto — apelido, as duas opções de alcance, o seletor de tribunal,
CPF, senha e o 2FA com dois modos. Num notebook a caixa passava da tela: o
TÍTULO cortado em cima e os botões «Cancelar» e «Cadastrar e testar login»
cortados embaixo. "Fora de padrão" tem número: **41 diálogos do client usam
`overflow-y-auto` e 19 usam `max-h-[90vh]`** — este era a exceção. Agora segue a
convenção da casa.

**Pedia «CPF ou OAB»**: o login do PJe/PDPJ é o CPF. Oferecer OAB convidava a
digitar o que o tribunal não aceita, e o erro só apareceria no "testar login",
depois da senha já preenchida. Virou «CPF», com o exemplo só de CPF.

O manual da Central de ajuda citava «CPF ou OAB» e mudou no MESMO commit — é a
regra que nasceu em 13/09 (rótulo citado entre «» tem que existir no arquivo da
tela), e o teste `central-de-ajuda` teria quebrado se eu tivesse esquecido.

Amarras: `dialogo-credencial-cabe-na-tela` (5 testes) e `primeiros-passos`
(reescrita a seção do client) — **8 mutações, todas vermelhas**
(`scratchpad/mutar-dialogo-e-dashboard.py`). Uma delas apaga o resumo de
`/ajuda`: remover da tela de trabalho é diferente de apagar, e o teste separa as
duas coisas.

---

## 23. Ponto fora de produção e a limpeza da tela de Processos (13/09)

Duas decisões que o dono deu em sequência, no mesmo teste de uso da seção 22.
Nenhuma das duas é mockup pendente: ele nomeou item por item o que queria fora,
e remoção de elemento nomeado não tem desenho novo pra aprovar.

### 23.1 O módulo Ponto sai de produção e fica em staging com selo "beta"

Palavras dele: *"esse modulo ponto vamos remover por enquanto de produção e em
stating vamos deixar com a etiqueta beta"*.

**Não é remoção de código.** Nada do módulo foi apagado — nem tela, nem
procedure, nem tabela, nem a linha do plano. O que muda é ONDE ele é oferecido.

Uma lista só, em `shared/modulos-por-ambiente.ts` (`MODULOS_BETA`), lida pelas
**três** portas que decidem se um módulo existe. Três listas divergindo dariam o
pior resultado possível: item escondido no menu com a API aberta, ou o contrário.

| porta | onde | o que faz |
|---|---|---|
| menu | `AppLayout` (`itemVisivelNoMenu`) | o item some em produção; em staging aparece com selo |
| rota | `ModuloGuard` | tela `ModuloEmTestes` em vez de renderizar o módulo |
| procedures | `conferirModuloDoPath` (`gate-modulos.ts`) | FORBIDDEN `modulo_em_beta` |

Três decisões de desenho que valem registro, porque cada uma é uma armadilha
evitada:

1. **Ambiente desconhecido conta como produção.** `moduloRemovidoNoAmbiente`
   trata `null`/`undefined` como produção: na dúvida sobre onde estamos, mostrar
   por engano em produção é exatamente o erro que a decisão existe pra evitar.
2. **No porteiro, a recusa vem ANTES do atalho de admin e ANTES da conta de
   contrato.** É a única exceção consciente ao fail-open do gate: "tudo liberado
   por erro nosso" (cesta indeterminada) não pode abrir um módulo que o dono
   tirou do ar. Mesma ordem na rota, pelo mesmo motivo.
3. **Cesta `null` continua `null`.** `filtrarModulosDoAmbiente` não transforma o
   indeterminado em lista vazia — quem decide o bloqueio nesse caso é a porta.
   Mexer aqui trocaria o fail-open do gate inteiro por efeito colateral da lista.

A resposta de `subscription.modulosContratados` passou a levar o `ambiente`
junto, inclusive no ramo de admin/impersonação (que recebe `modulos: null`):
sem ele o client trataria tudo como produção e esconderia o Ponto em staging.

**O que o dono precisa saber, e que não estava no pedido:** o plano **Escala**
(migration 0217) tem `'ponto'` na cesta, e a lista de vantagens dele vende
*"Comissões automáticas por colaborador e ponto da equipe"*. A migration não foi
tocada — quem assina o Escala segue com o módulo na cesta e volta a vê-lo quando
o beta sair —, mas **em produção o cartão do plano anuncia uma coisa que a conta
não mostra**. Tirar o texto do cartão é outra remoção e depende dele.

Pra devolver o Ponto a produção: apagar `"ponto"` de `MODULOS_BETA`. Nada mais.

Amarra: `modulo-ponto-fora-de-producao` (16 testes) — inclui o par oposto
(aparece em staging **e** não aparece em produção), porque esconder nos dois
seria a remoção que ele não pediu.

### 23.2 Cinco remoções na tela de Processos

Palavras dele, em duas mensagens: *"podemos remover essa aba alertas pq ja pega
em monitoramento, os creditos pq não usamos mais, resumo diarío também pode
remover pq construiremos essa função em smartflow e consulta cnj desnecessário"*
e *"e os cards monitorados, nova ação e parados tambem desnecessário"*.

**A conferência que precedeu a remoção da aba Alertas.** A aba era o painel de
aprovar prazo sugerido pela IA (`prazosSugeridos.listar/aprovar/descartar`), e no
client inteiro **só `Processos.tsx`** toca esse namespace. Se a aba fosse o único
caminho de aprovar, tirá-la deixaria o cron enchendo uma tabela que ninguém lê —
uma remoção silenciosa de função, que é justamente o que a regra da casa proíbe.
**Não é**: a timeline do Monitoramento tem o selo «Requer prazo» e o botão
«＋ Criar prazo» chamando a MESMA `prazosSugeridos.aprovar`. O dono estava certo
ao dizer "já pega em monitoramento". É esse par que a amarra trava.

**O que ficou sem tela**: `prazosSugeridos.descartar`. O botão «Descartar» era só
da aba; hoje a sugestão que ninguém aprova fica pendente e mantém o selo na
movimentação. Não inventei substituto — está anotado aqui pro dono decidir.

As três pastilhas de contagem (monitorados · parados · nova ação) saíram porque
repetiam o número que já estava logo abaixo: `MonitoramentosCount` mostra
parados/total no badge da aba Monitoramento e `NovasAcoesBadge` mostra as não
lidas no badge de Novas Ações. As duas queries que alimentavam as pastilhas eram
cópia das que os badges já fazem — o cabeçalho fazia 2 chamadas para mostrar de
novo o que a barra de abas mostrava. `CabecalhoProcessos` ficou sem props e sem
query: só título e a linha do que a tela faz.

**Link antigo não quebra**: `?tab=alertas` existe solto em e-mail e histórico de
navegador. Ele cai na Central de Movimentações em vez de abrir uma aba que não
existe mais.

**O que NÃO foi removido, de propósito:**

- **`ConsultarTab`** — a busca avulsa por CNJ/CPF/CNPJ continua no arquivo, sem
  porta, com o motivo escrito no topo da função. Ele autorizou tirar o BOTÃO;
  apagar a consulta é outra decisão. Pra devolver, é montar o componente num
  Dialog outra vez.
- **`ConfigResumoDiario`** — vive em `Movimentacoes.tsx`, exportado. Só o mount
  em Processos saiu. Ele disse que a função será refeita no SmartFlow.
- **O aviso «Saldo baixo»** (aparece com saldo < 5) e os textos de custo em
  crédito dentro dos diálogos de monitoramento («2 créditos/mês», «15
  créditos/mês», «3 créditos base»). São crédito, como a pastilha — mas ele
  apontou a pastilha, e no print dele o saldo era 5.816, então o aviso nem
  estava na tela. **Pergunta aberta pro dono**: tiro esses também?

Amarra: `processos-cabecalho-enxuto` (10 testes). Duas amarras existentes foram
atualizadas para a verdade nova em vez de apagadas: `movimentacoes-na-carteira`
(a consulta avulsa não tem aba **nem** botão — conferido pelo MECANISMO, estado
e montagem, porque o rótulo «Consultar CNJ» segue escrito no comentário que
explica a decisão) e `telas-cabem-no-celular` (a fileira de 425px que vazava no
celular de 390px não existe mais; quem segura a largura agora é o `flex-wrap` da
tira de abas). `fuso-telas-usam-helper` perdeu a metade que exigia a pill da aba
e manteve a que protege: nenhuma data de prazo sugerido volta a ser formatada à
mão.

**31 mutações, todas vermelhas** (`scratchpad/mutar-ponto-e-processos.py`). Uma
sobreviveu na 1ª volta pelo motivo de sempre: a amarra do porteiro conferia a
POSIÇÃO da recusa de ambiente, e dava pra deixar a chamada onde está e desarmar a
condição (`args.role !== "admin" &&` na frente). Agora ela confere que o `if` é
incondicional.

Baseline depois destas duas entregas: **6.070 testes verdes em 407 arquivos**
(**6.075 em 408** na ponta final, depois de trazer `develop` — a cor do menu
chegou com um arquivo de teste a mais)
(`pnpm test`), `pnpm check` limpo, `pnpm vite build` passando.

---

## 24. Editar plano cabia 2110px numa janela de 1440 — ENTREGUE (13/09)

Print do dono: *"aqui também está feio. Vamos refazer essa tela"* — o editor
de plano (`/admin/planos/:slug`) com a coluna da direita cortada.

### 24.1 O que estava acontecendo, medido

| Onde | Antes | Depois |
|---|---|---|
| Conteúdo numa janela de 1440px | 2110px (670 fora da tela) | 1440px |
| Conteúdo num celular de 390px | 1605px (1215 fora) | 390px |
| Coluna "Geral" | 206px — o aviso do código caía POR CIMA do slug | 300px |
| Linha do destaque longo | 1531px exigidos, em 1 linha | 3 linhas dentro da coluna |

### 24.2 A causa, que era uma só

Na lista "Destaques do cartão" o texto usava `flex-1 truncate`. `truncate` é
`white-space: nowrap`, e um **item de flex nasce com `min-width: auto`** — os
dois juntos fazem o texto EXIGIR a largura inteira dele (1467px medidos no
navegador), o que estica cartão → coluna → grid → página. Não era a tela que
era larga: era uma linha de texto que se recusava a quebrar.

Trocar `truncate` por `break-words` sozinho **não** resolveria: sem `min-w-0`
o item continua com a largura mínima do conteúdo.

### 24.3 O que mudou (quatro classes, nada removido)

- destaque: `flex-1 truncate` → `min-w-0 flex-1 break-words` (decisão do dono:
  quebrar em linhas, não cortar — é o texto que ele está editando);
- grid: `1fr 1.15fr 0.95fr` → `300px minmax(0,1fr) 330px`;
- "Código interno": o aviso "não muda depois de criado" saiu de dentro da
  faixa de 36px e virou linha de apoio embaixo, como os outros campos;
- grade de limites: `grid-cols-2 sm:grid-cols-3` → `grid-cols-1
  [&>*]:min-w-0 sm:grid-cols-2 lg:grid-cols-3`.

Campo, aviso, botão, prévia do cartão e módulos: todos intactos.

Amarra: 3 testes novos em `telas-cabem-no-celular.test.ts` (12 no total) — 6
mutações novas em `scratchpad/mutar-telas-celular.py`, 21/21 vermelhas.
Comparador `mockup-editor-plano-e-visual.html`.

### 24.4 O que NÃO entrou (o dono aprovou "a tela editar plano apenas")

O **piloto da linguagem visual** do mesmo comparador — raio de 12px, elevação
de verdade no cartão e Poppins nos títulos, tudo em token — ficou de fora.
Está escrito e fotografado na branch `descartavel/editor-plano`, commit
`3a691e07`, se ele voltar ao assunto. Junto com ele fica anotado o achado que
a foto do tema escuro rendeu: no cartão verde do Financeiro o valor "R$ 10,7
mil" é verde escuro sobre verde e o vizinho sai violeta — decisão de paleta,
não de layout.

---

## 25. Dois achados do dono em produção, consertados no mesmo dia (13/09)

Os dois vieram de print dele usando o sistema, e os dois foram **reproduzidos no
app rodando** antes de qualquer linha de código — receita em
`docs/rodar-o-app-localmente.md`. O "antes" de cada um é foto, não dedução.

### 25.1 A Central escondia movimentação pendente atrás do teto da página

Print: «Nada pendente nos últimos 30 dias · As 80 movimentações do período já
foram resolvidas», com o badge da aba marcando **11**.

**Causa única.** A lista pede as movimentações do período ordenadas por DATA e
cortadas em `limite` (80 por padrão; a tela nunca pede mais e não tem "carregar
mais"). Só depois do corte é que ela separava resolvida de pendente. O
escritório tinha 91 no período e as 11 pendentes eram mais ANTIGAS que as 80
que couberam: **caíam fora da consulta**. Não eram só mal contadas — não havia
como chegar nelas por aquela tela (trocar para 90 dias piora: janela maior,
mesmo teto; só a busca alcançava, porque ela roda antes do corte).

Os dois números discordavam porque nasciam de lugares diferentes: o badge
(`contarMovimentacoesNaoLidas`) conta o BANCO, sem teto; a tela contava a
PÁGINA. O `80` de «Resolvidas (80)» era o tamanho da página, não o total.

Conferido de passagem para não acusar a causa errada: contador e lista filtram
exatamente o mesmo recorte (movimentação, 30 dias, escritório), e
`prazos_sugeridos` tem UNIQUE em `evento_id` — o `leftJoin` não duplica linha.
A única diferença entre os dois era o teto.

**Conserto, em duas garantias que só valem juntas:**

1. **Ordem** — `asc(lido), desc(dataEvento)`: pendente vem primeiro, sempre.
   É isso que impede o teto de comer trabalho. Nas abas «A resolver» e
   «Resolvidas» a ordem na tela não muda (a lista já é de um estado só); em
   «Todas», pendente sobe — que é o que essa aba deveria fazer.
2. **Janela** — uma contagem à parte, no banco, separada por estado
   (`aResolverPeriodo` / `resolvidasPeriodo`), viaja em `triar(...).janela`.
   `contagem` continua descrevendo a PÁGINA e continua encolhendo com o filtro
   de tipo, como foi decidido quando a tela nasceu; a janela é a régua que diz
   se a página é tudo.

A tela passou a usar a janela onde antes usava a página: o texto «as N do
período já foram resolvidas», a decisão entre «nada no período» × «tudo
resolvido», e o rótulo «Resolvidas (N)» (que volta ao número da página quando
há filtro de tipo — é o que o seletor promete). E ganhou o aviso que faltava:
**«Mostrando 69 de 80 resolvidas…»**, só quando falta algo de verdade. Sem ele,
a mesma mentira voltaria na 81ª pendência.

**Medido no app, mesmo banco, 91 eventos (80 resolvidas recentes + 11 pendentes
de 20–25 dias atrás):** antes, «Nada pendente» com badge 11; depois, as 11 na
tela, badge 11, e o aviso correto na aba Resolvidas.

### 25.2 Cliente em teste não tinha como pagar o plano que estava testando

Print: «quando clico em adicionar pagamento não acontece nada». Não era o botão
— eram **três portas fechadas** ao mesmo tempo, com o servidor pronto do outro
lado:

1. A faixa do topo mandava para `/configuracoes?tab=meu-plano` — a tela em que
   ele **já estava**. Navegar para a rota atual é um não-evento.
2. O bloco do plano atual só oferecia botão para plano **sob consulta**
   («Fechar valor com a gente») e para **carência de cancelamento**
   («Reativar»). Para plano de preço fechado em teste: nada — só a frase
   "Pagamento seguro via Asaas".
3. O cartão do próprio plano ficava **travado** em «✓ Você está aqui», que é o
   texto de quem JÁ paga. O rótulo **«Continuar com este plano»**, escrito
   exatamente para este caso, existia no código e **nunca chegava à tela**.

O servidor nunca foi o problema: `createCheckout` tem o caminho documentado
("Cenário B: conversão trial → pago", que aproveita a linha do teste e marca
`trialConvertido`) e não recusa o plano atual. Faltava porta.

O único jeito de pagar era escolher um plano **diferente** — pagar o que não se
escolheu. Numa véspera de venda, isso é receita parada.

**Conserto:** botão «Adicionar pagamento» no bloco do plano atual, só para
teste em plano de preço fechado e fora de carência, levando ao checkout do
PRÓPRIO plano (vira «Ver o pagamento» quando já há cobrança aberta);
`travadoPorSerOAtual` passou a distinguir quem já paga de quem está testando,
destravando o cartão e deixando o rótulo antigo aparecer; e a faixa do topo
ganhou `irPagar()` — de outra tela navega, já em «Meu plano» rola até o botão e
põe o foco nele.

**Medido no app com conta em teste no Atende:** antes — nenhum botão no bloco,
cartão travado em «✓ Você está aqui», clique na faixa sem efeito. Depois —
botão presente, cartão com «Continuar com este plano» **habilitado**, e o
clique na faixa levando o foco para `#adicionar-pagamento`. (O travamento por
`billingOk === false` continua valendo: em ambiente sem Asaas conectado os dois
botões seguem desabilitados, como antes.)

### 25.3 Amarras

`central-nao-esconde-pendente` (12) e `pagar-o-plano-em-teste` (14) —
**31 mutações vermelhas** (`scratchpad/mutar-pendente-e-pagamento.py`).
Três sobreviveram na 1ª volta, todas pelo mesmo motivo de sempre: a amarra
conferia que o NOME existia, não que ele alimentava o número — dava para
reatribuir a variável à página com o literal de pé em outro lugar do arquivo.
Ancoradas na atribuição, morreram.

`central-grupos` ganhou dois testes e teve um `expect` de objeto inteiro
atualizado (o retorno de `triar` cresceu); os 17 de comportamento não foram
tocados — inclusive o que trava «o filtro de tipo encolhe as contagens de
estado junto», que é decisão antiga da casa e continua valendo.

Baseline: **6.106 testes verdes em 410 arquivos** na ponta final, depois de
trazer `develop` (o editor de plano chegou com 3 testes a mais), `pnpm check`
limpo e `pnpm vite build` passando.

---

## 26. Cabeçalho do Dashboard: busca no topo, abas minimalistas (13/09)

Três pedidos do dono depois de ver o navegável: *"só gostei do buscar ficar
alinhado com nome do usuário. e pode remover o botão outro período também.
[…] e o navbar geral, comercial, operacional e financeiro podemos refazer
também o estilo para algo mais minimalista"*.

### 26.1 Busca alinhada com o nome

`BuscaDoTopo` (em `dashboards/common.tsx`) entra dentro do `PainelTopo`, na
mesma linha do "Bom dia, <nome>". Abre a **mesma** paleta do ⌘K — não é uma
busca nova: `AbrirPaletaContexto`
(`components/paleta-comandos-contexto.tsx`) leva o `setPaletaAberta` do
`AppLayout` até a tela. Fora do AppLayout (login, assinatura) o contexto é
`null` e o botão não é desenhado.

**A busca do rodapé do menu SAIU** — ele pediu logo depois ("remova o buscar
no menu lateral"). Ficou só a do cabeçalho. O que some é o BOTÃO: o atalho de
teclado ⌘K/Ctrl+K continua ligado no `AppLayout` (o `keydown` não foi tocado),
e o rodapé do menu segue com o botão **Ajuda**, agora sozinho na linha. A
amarra `central-de-ajuda.test.ts` inverteu o sinal: o rodapé agora é conferido
por **não** conter `⌘K`, para o botão não voltar sem querer.

Vale para os cinco painéis que usam `PainelTopo` (Geral, Comercial,
Operacional, Financeiro, Processual) — é o mesmo cabeçalho.

### 26.2 "Ver outros períodos" saiu

Removido do `PainelTopo` do Dashboard Geral, a pedido expresso. `/relatorios`
continua no menu e é por onde se vê outro período; o comentário do arquivo que
explicava a ausência de seletor de range continua válido.

### 26.3 Abas em sublinhado

`Geral · Comercial · Operacional · Financeiro` deixaram de ser pílulas dentro
de uma moldura com fundo (`rounded-md border bg-muted p-1.5` + `data-[state=
active]:bg-card`) e viraram texto com **sublinhado de 2px na ativa**, sobre uma
linha fina que atravessa a tira. Sem moldura, sem fundo, sem sombra.

`max-w-full overflow-x-auto` ficou no invólucro de propósito: são as duas
classes que impedem as abas de empurrarem a página inteira de lado num celular
de 390px, e `telas-cabem-no-celular.test.ts` trava as duas.

**Defeito da 1ª versão, achado pelo dono na tela (13/09): um retângulo preto em
volta da aba ativa.** O `TabsTrigger` da casa já traz `border border-transparent`
nos QUATRO lados; `data-[state=active]:border-foreground` colore os quatro, então
o que devia ser sublinhado virou caixa (1px em cima e nas laterais + 2px
embaixo). Conserto: `border-0 border-b-2` no trigger e
`data-[state=active]:border-b-foreground` — só o lado de baixo existe e só ele
ganha cor. `focus-visible:ring-0` entrou junto para o anel de foco do
componente-base não redesenhar a caixa no clique. Amarra no mesmo arquivo de
testes (3 mutações vermelhas).

**A régua NÃO é curta** (ele também estranhou o comprimento): medido no
navegador com o app rodando, a linha da tira tem exatamente a largura do
conteúdo — 1132px numa janela de 1440, 1612px em 1920, 2252px em 2560, sempre
igual ao cartão mais largo da página. O que fazia a linha parecer solta era o
painel de baixo estar em branco, pela quebra descrita na seção 29.

Medido depois: 5.987 testes verdes, typecheck limpo, build ok.

Medido depois: 5.983 testes verdes, typecheck limpo, build ok.

---

## 27. A moeda "crédito" saiu do produto (13/09)

Autorização do dono, na mesma mensagem que tirou o Ponto do cartão: *"tudo
referente a creditos pode excluir caso pois não usaremos mais isso"*.

### 27.1 Por que a remoção era segura — e por que era urgente

**Crédito já não decidia nada desde 11/09.** `consumirCredito`, chamada pelos
quatro routers de cálculo, por dentro chamava `verificarUso`/`registrarUso` do
TETO MENSAL e não encostava em saldo nenhum. O nome sobreviveu à troca, e era
ele que fazia a tela dizer **"Seus créditos acabaram. Adquira mais créditos"** —
mandando o cliente comprar o que não estava à venda. Virou
`contarCalculoNoMes`, e a mensagem passou a dizer o que de fato aconteceu.

**O achado grave.** `cobrarMonitoramentosMensais` rodava **a cada 6 horas**, em
produção: debitava crédito por processo vigiado (2/mês) e por CPF vigiado
(15/mês) e, quando o saldo não dava, marcava o monitoramento como **`pausado`**
e notificava "Monitoramento pausado por falta de créditos". O saldo só era
reposto por outro cron (`resetCotaMensalEscritorios`). Ou seja: a moeda
continuava viva o bastante para **desligar vigia de processo** por uma conta
que ninguém mais olhava. Os dois crons saíram juntos — e é por isso que
remover o mecanismo pela metade seria pior que não remover.

### 27.2 O que saiu

| Camada | O que era | Substituto que já existia |
|---|---|---|
| operação avulsa | débito de saldo | teto mensal (`limites-uso`, `contarUso`) |
| vaga de monitoramento | 2 ou 15 créditos/mês | vaga do plano (`limites-monitoramento`) |
| "dar créditos" no painel | `concederCreditos` | `aumentarLimiteDoMes` (extra deste mês) |
| barra do Dashboard | saldo × consumido | `UsoDoMes` |

Módulos apagados: `billing/escritorio-creditos.ts`,
`processos/custos-creditos.ts`, `billing/migrate-legacy-credits.ts`.
Procedures: `processos.saldo`, `processos.pacotes`, `processos.transacoes`,
`processos.adicionarCreditos`, `dashboard.credits`, `admin.concederCreditos`,
`admin.retirarCreditos`, `admin.migrarCreditosLegacy`. Telas: chip de saldo e
todos os textos de custo em Processos, "consome 1 crédito" nos cálculos, cartão
de créditos e botões do painel admin, barra do Dashboard.

**Consequência que vale registrar:** acesso ao app passou a ser **só
assinatura**. `hasAccess = hasSubscription || hasCredits` era a regra;
`hasCredits` deixou de existir. Pagante, teste e cortesia têm linha de
assinatura e não sentem nada — quem entrava **só** por crédito sobrante agora
cai em "Meu plano". É o comportamento correto e é uma mudança de porta.

### 27.3 O que NÃO saiu, e por quê

1. **`creditosCalculosMes`.** A coluna guardou o nome antigo, mas É o teto
   mensal de cálculos (`CAMPO_DO_PLANO.calculo`). Apagá-la tiraria o limite.
   Mudou o RÓTULO na tela do painel: «Créditos cálculo/mês» → «Cálculos por
   mês».
2. **As tabelas** `escritorio_creditos` e `escritorio_transacoes`. Histórico não
   se joga fora por migration — a convenção da casa é ALTER não-destrutivo.
   Ninguém mais lê. **Se o dono quiser apagar de vez, é decisão dele.**
3. **"Crédito" no sentido financeiro**: «Cartão de crédito», «Crédito Pessoal»
   do módulo bancário, `creditoMesDiferente` do Financeiro, «Banco Crédito S/A».
   Mesma palavra, outro assunto — **uma varredura cega por "crédito" destruiria
   o módulo de cálculo bancário**, e duas mutações da bateria existem só pra
   travar essa distinção.
4. **O rótulo `user.concederCreditos` na Auditoria**, marcado
   "(descontinuado)": as linhas antigas continuam no banco e alguém precisa
   conseguir ler o que elas dizem.

### 27.4 O cartão do Escala parou de vender o Ponto

Migration **0229**. O módulo saiu de produção em 13/09 (seção 23) e o cartão
seguia anunciando "Comissões automáticas por colaborador e ponto da equipe" —
o cliente assinava lendo isso e não achava o módulo. A **cesta não foi tocada**:
o Ponto continua contratado e volta sozinho quando sair do beta. A troca é por
TEXTO EXATO (`JSON_SEARCH`), não por posição: `features` é editável no painel,
quem já reescreveu a frase não é afetado, e rodar duas vezes não faz nada.

### 27.5 Amarras

`credito-saiu-do-produto` (19 testes) — **28 mutações vermelhas**
(`scratchpad/mutar-credito-e-cartao.py`). Duas sobreviveram na 1ª volta pelo
motivo de sempre: o literal de pé em outra ocorrência (o import × a chamada de
`consumirUso`; o `JSON_SEARCH` do caminho × o do `WHERE`).

Seis amarras existentes foram **atualizadas para a verdade nova em vez de
apagadas**, e em três delas a metade que ainda protege foi preservada de
propósito: `lancamento-creditos-limites` perdeu `cotaMensalDoPlano` e manteve
`limitesDoPlano` (a tabela `planos` como fonte); `admin-excluir-conta-alvo`
perdeu o caminho de retirar crédito e manteve o de **excluir conta**, que é o
bloqueador P0-D; `superlancamento-planos` passou a travar a VAGA em vez da
ordem "vaga antes do crédito". As outras: `creditos-viram-limites`,
`pacote-3-planos`, `processos-cofre-lancamento`, `novas-acoes-capa` e
`processos-cabecalho-enxuto` (esta inverteu: o aviso «Saldo baixo» tinha ficado
de pé em 13/09 porque ele pediu só a PASTILHA — na mensagem seguinte veio a
moeda inteira).

Baseline: **6.119 testes verdes em 411 arquivos**, `pnpm check` limpo,
`pnpm vite build` passando.

---

## 28. O uso só libera depois de escolher plano ou teste (13/09)

**Pedido do dono**, depois de ele descrever o fluxo que quer — *"cadastra >
confirma e-mail > aceita termos > escolhe plano ou teste > libera uso do
sistema"* — e perguntar como garantir: *"quero que só libere o uso após
escolha do plano/teste. resolva logo isso"*.

### 28.1 O que estava garantido e o que era só desenho

Conferido degrau a degrau no código antes de mexer:

| degrau | quem segurava | valia fora da tela? |
|---|---|---|
| cadastra | `auth.signup` (exige WhatsApp e aceite, grava `aceites_termos`) | sim |
| confirma e-mail | o cadastro **não cria sessão**; `login` recusa com `email_nao_confirmado` | sim — sem confirmar não existe cookie, e sem cookie não existe API |
| aceita termos | `TermosGate` | **não** — diálogo no navegador; nenhum porteiro confere `termosVersaoAceita` |
| escolhe plano ou teste | `SubscriptionGuard` | **não** — a API respondia tudo |
| libera uso | consequência do anterior | **não** |

O quarto degrau era o mais frouxo, e por um motivo que não se vê olhando a
tela: o porteiro de módulos (`gate-modulos.ts`) é **fail-open de propósito** e
lê "sem assinatura" como "não sei" — então liberava a cesta inteira. Quem
fechasse a tela e chamasse o servidor direto usava o produto sem plano nenhum.

O terceiro degrau (termos) **continua só na tela** — não foi o que ele pediu, e
fica registrado aqui como pendência conhecida.

### 28.2 O que entrou

`shared/acesso-sem-plano.ts` (regra pura) + `server/_core/gate-assinatura.ts`
(o porteiro) + `requirePlanoEscolhido` na corrente do `protectedProcedure`,
entre `requireUser` e `requireModuloContratado`.

**A régua de quem tem acesso NÃO mudou.** É a mesma
`getActiveSubscriptionComHeranca` que o `SubscriptionGuard` já consultava —
cortesia > paga > teste > cancelada dentro do período pago, colaborador
herdando a do dono. O que mudou é o lugar onde ela é conferida. Por isso a
mudança é invisível pra quem segue o fluxo: ninguém que entra hoje passa a ser
barrado, e ninguém que era barrado na tela passa a entrar.

Quatro decisões que valem lembrar:

1. **Deny-by-default, o oposto do porteiro de módulos.** Namespace que ninguém
   declarou EXIGE plano. Lá o fail-open protege contra derrubar escritório
   pagante; aqui o mesmo desenho entregaria o produto de graça toda vez que um
   router novo nascesse sem porteiro. O teste confere a lista contra o
   `appRouter`, então "desconhecido" só acontece com chamada inventada.
2. **O caminho de escolher o plano fica aberto** — `auth`, `termos`,
   `subscription`, `configuracoes`, `permissoes`, `notificacoes`, `push`,
   `ajuda`. Não é generosidade: o «Meu plano» mora DENTRO de Configurações, que
   pede escritório e cargos ao montar. Sem esses dois, a pessoa ficaria
   trancada fora da própria tela de pagamento — exatamente o defeito que ele
   relatou hoje de manhã ("clico em adicionar pagamento e não acontece nada").
   Os `admin*` estão na lista por honestidade do teste: passam por
   `adminProcedure`, que não é `protectedProcedure` e não chega no porteiro.
3. **O cache guarda o SIM e nunca o NÃO.** Guardar o "não" por 30s faria quem
   acabou de clicar em «Testar grátis» levar recusa na cara nos segundos
   seguintes. Quem tem plano custa uma consulta por 30s; quem não tem é
   re-consultado a cada chamada, e são poucas — a tela dele é uma só.
4. **Fail-open na indeterminação.** Banco fora, exceção na consulta: passa. Só
   um "não tem assinatura" explícito bloqueia. Admin da plataforma e
   impersonação passam sempre — a impersonação é justamente o dono olhando a
   conta SEM plano.

No client, as três contagens de badge do menu (`movimentacoes.contador`,
`agenda.contadores`, `crm.contarConversas`) pararam de perguntar sem plano: o
servidor recusa, o menu já está trancado, e seriam três 403 a cada 2 minutos na
tela onde a pessoa está escolhendo o plano.

### 28.3 Conferido no app rodando (não deduzido)

Conta com a assinatura apagada do banco, navegador de verdade:

- login cai em `/configuracoes?tab=meu-plano` e **a tela renderiza inteira** —
  três planos, toggle Mensal/Anual, 4 botões «Testar grátis»;
- `agenda.contadores` e `movimentacoes.contador` respondem **403** com
  "Escolha um plano ou comece o teste grátis para usar o JuridFlow.";
- `subscription.plans`, `configuracoes.meuEscritorio`, `termos.status` e
  `ajuda.primeirosPassos` respondem **200**;
- `/clientes` devolve pra Meu plano, como antes;
- clicar em «Testar grátis» leva ao Dashboard e o produto responde **200 na
  hora** — sem esperar os 30s do cache. É a decisão 3 valendo na prática.

### 28.4 Efeitos colaterais conscientes

- **Teste vencido e assinatura cancelada fora da carência** param de responder
  pela API, não só pela tela. É a mesma régua de sempre; a diferença é que
  agora ela vale nos dois lugares.
- **Caller de servidor tem path sem namespace.** O cron de relatórios
  programados (`createCallerFactory` de um router solto) chama
  `comercialDashboard`, não `relatorios.comercialDashboard` — cai no
  deny-by-default. Para escritório com plano nada muda; sem plano, o envio
  grava `ultimoErro` com a frase do porteiro e o cron segue, sem quebrar.
- **Teste que chama procedure por caller precisa desligar o porteiro**
  (`vi.mock("../_core/gate-assinatura", …)`): o banco falso desses testes não
  tem assinatura nenhuma. Cinco arquivos já foram ajustados com o comentário
  explicando; quem escrever o sexto vai encontrar o mesmo 403.

### 28.5 Amarra

`uso-so-com-plano.test.ts` (17 testes) — **32 mutações vermelhas**
(`scratchpad/mutar-uso-so-com-plano.py`). Quatro sobreviveram na 1ª volta, três
pelo motivo de sempre (o literal de pé em outro lugar: o import × a chamada; o
comentário × o código; a linha que aparece 3× em `subscription.ts`) e uma por
falta de relógio — a validade do cache só morre com `vi.useFakeTimers` e 31s de
avanço, senão "plano vencido segue passando pra sempre" passa despercebido.
`modulos-contratacao` teve só o `expect` da corrente atualizado (a de módulo
continua sendo o último elo, e é isso que ele guarda).

Baseline: **6.136 testes verdes em 412 arquivos**, `pnpm check` limpo,
`pnpm vite build` passando.

## 29. Painel Comercial abria em BRANCO sem setor comercial (13/09)

`dashboard.comercial` tem uma saída antecipada para quando nenhum colaborador
está num setor do tipo Comercial: devolve `modo: "gestor"`, `ranking: []`,
`temSetor: false` — **e nenhuma chave `totais`**. A tela seguia direto para
`totais!.contratosFechados`, confiando no `!` do TypeScript, e derrubava o React
inteiro: aba Comercial em branco, sem mensagem nenhuma.

Quem via era exatamente quem tem menos chance de entender: o dono de conta nova,
no primeiro clique da aba, antes de montar a equipe. A não-nulidade do `!` é
promessa de quem escreveu, não garantia do servidor — e aqui a promessa era
falsa por um caminho de retorno que ninguém releu.

Conserto na tela (o servidor não foi tocado): guarda `if (data.modo ===
"gestor" && !data.totais)` **antes** do primeiro uso, devolvendo o `Aviso` que
o arquivo já tinha, com texto que diz o que fazer ("Crie o setor em
Configurações → Equipe e vincule quem vende"). Amarra:
`painel-comercial-sem-setor.test.ts` (3 testes; a guarda é conferida com o
`if (` colado na condição — sem isso, um `false &&` na frente desligava o
conserto e o teste continuava verde). 5 mutações vermelhas em
`scratchpad/mutar-abas-e-comercial.py`.

Varrido de passagem: o único outro `!` sobre dado do servidor nos painéis é
`cashFlow!` no Financeiro, e ele está dentro de um `(cashFlow?.x ?? 0) > 0` —
não alcança o mesmo buraco.

## 30. Buscar e Ajuda saem do menu; módulo de ajuda removido (13/09)

Três pedidos seguidos do dono, na ordem em que chegaram:

1. *"remova o buscar no menu lateral"* — saiu o BOTÃO do rodapé da barra
   lateral. A busca do cabeçalho (seção 26) ficou como única porta visível e o
   atalho ⌘K/Ctrl+K continua ligado no `AppLayout`.
2. *"não continua, os cards, se continuar já mandei remover"* — o bloco
   "Primeiros passos" saiu do topo do Dashboard do dono.
3. *"remova esse ajuda, irei gravar os vídeos"* → *"remova todo o módulo
   ajuda"* — a Central inteira, detalhada na seção 18.

O rodapé da barra lateral ficou só com o avatar, engrenagem e sair.

Amarra: o teste do módulo foi apagado junto com ele; o que sobrou guardando a
decisão é o de "as telas cabem num celular", que trava a régua de abas, e o
`modulos-contratacao.test.ts`, que quebraria se um router `ajuda` voltasse sem
se declarar.

## 31. Cofre: o cartão da credencial media 2.566px de altura (13/09)

Print do dono: *"esse card das credenciais está muito comprido, quero que
redesenhe para ficar mais bonito."* Aprovado com o comparador
`mockup-cofre-cartao-credenciais.html` (*"pode fazer"*).

### 28.1 A causa, medida antes de mexer

A grade de tribunais (`GradeTribunais.tsx`) mora DENTRO do cartão da
credencial, e esse cartão é item de uma lista `md:grid-cols-2
lg:grid-cols-3` — feita para três cartões lado a lado. Resultado numa janela
de 1440: a grade tinha **335px de largura útil**, com **800px vazios** ao lado,
e **2.143px de altura**; o cartão inteiro, **2.566px**; a página do Cofre,
3.211px — 3,6 telas de rolagem.

O desenho antigo gastava altura em moldura: cada estado era uma caixa com DUAS
caixas dentro (uma por grau), cada uma com rótulo, ponto, texto e botão de
testar — 78 blocos empilhados numa coluna de 106px. E o texto do Keycloak era
repetido inteiro embaixo de cada estado que falhou.

### 28.2 O que mudou (nada de informação saiu)

- **Uma linha por estado**: sigla à esquerda, os graus como selos à direita, no
  mesmo eixo (`grid-cols-[repeat(auto-fill,minmax(186px,1fr))]` +
  `[&>*]:min-w-0`). O selo **é** o botão de testar aquele grau.
- **A credencial nacional ocupa a fileira inteira** (`lg:col-span-3` quando
  `sistema === SISTEMA_NACIONAL`). A credencial de um tribunal só continua no
  cartão de 1/3.
- **A contagem subiu** para o lado do "Testar tudo": validados · falharam ·
  nunca usados, com os mesmos pontos coloridos de antes.
- **Os erros viraram uma dobra** "Por que N falharam", com um parágrafo por
  estado e o «detalhe técnico» de sempre dentro. Fechada por padrão; o número
  de falhas fica sempre à vista, em vermelho, na linha do botão.
- `2º sem endereço` virou `2º s/ portal`: por extenso vazava 31px da coluna e
  invadia a vizinha (medido no navegador, não deduzido).

Continuam na tela: os dois graus separados, os três estados possíveis, a
contagem de processos de quem validou, o selo do grau sem portal, o texto cru
do erro, o aviso do "não testado" e a barra de progresso da fila.

### 28.3 Medido depois

| medida | antes | depois |
|---|---|---|
| altura do cartão, computador | 2.566 px | 612 px |
| altura do cartão, celular | 5.069 px | 1.831 px |
| largura útil da grade | 335 px | 1.098 px |
| altura só da grade | 2.143 px | 248 px |
| altura da página do Cofre | 3.211 px | 1.257 px |

Fotos do app rodando com uma credencial nacional de 40 tribunais × 2 graus
(78 combinações). Amarras: teste novo em `telas-cabem-no-celular.test.ts` e
`cofre-erros.test.ts` atualizado — 6 mutações vermelhas em
`scratchpad/mutar-cofre-grade.py` (a do resumo do erro só morreu depois de a
amarra olhar a CHAMADA em vez do import).

### 28.4 Anotado e NÃO corrigido

No celular a página do Cofre rola **1px** de lado: é o `animate-ping` do selo
"Ativa", que escala ao dobro e escapa do cartão. **Já era assim antes desta
mudança** (medido nas duas versões: 400px antes, 399px depois). Consertar
significa cortar o pulso ou trocar a animação — mudança visível que o dono não
pediu. Fica aqui até ele decidir.

## 32. As marcas dos cards passaram a ser as REAIS (13/09)

Pedido do dono, com todas as letras: *"esse card conexão simplificada acho que
pode remover pq ja podemos conectar com 1 clique. Tambem quero que use as logos
reais nos cards (whatsapp, facebool, instagram) em canais e app externos. nada
de parecido, quero icones reais."*

### 32.1 As marcas

`client/src/components/logos-marcas.tsx` (padrão do `IconeTwilio`, que já
existia): SVG embutido, traçado do Simple Icons (dados em CC0), cor da MARCA e
não do tema — `currentColor` faria um WhatsApp roxo no dia em que a paleta
mudar. Cinco: WhatsApp (#25D366), Instagram (degradê oficial — chapado ele
deixa de ser a marca que se reconhece), Messenger (#0866FF), OpenAI (preta, com
`dark:fill-white` pra não sumir no tema escuro) e Claude (#D97757).

Saíram da tela os emojis 💬 📸 💙 🤖 🦾.

**O ladrilho mudou junto, e precisava:** ele era um degradê CHEIO da cor do
canal, desenhado para um emoji branco por cima. Marca verde sobre ladrilho
verde some. Agora é claro, com borda; o degradê sobrou só no cartão
"+ Adicionar outro", que não tem marca.

**Uma escolha dita na cara:** o card é "Facebook Messenger", então leva a marca
do **Messenger** — o "f" azul é o Facebook, que é outro produto.

**O Asaas entrou na segunda rodada** (*"só o ícone do asaas que não tem nada a
ver"*, e ele tinha razão: era um saco de dinheiro). A marca não está no Simple
Icons e o proxy do ambiente bloqueia o site deles, mas o registro do npm passa
— o traçado veio do pacote `@asaasbr/n8n-nodes-asaas`, o nó de integração com a
Asaas, **copiado do arquivo, não redesenhado**. É a única das seis que é um
QUADRADO (azul #0030B9 com o desenho vazado em branco): é o ícone de aplicativo
deles, e é assim que a Asaas se apresenta — por isso entra no card com canto
arredondado, e não como glifo solto.

Lição que fica pro ambiente: quando um CDN de ícone estiver bloqueado, o
**registro do npm não está** (`registry.npmjs.org` é exceção no proxy). Marca de
serviço costuma viajar dentro do pacote de integração dele.

### 32.2 O banner saiu — e o que ele carregava, não

O banner azul "conexão simplificada" saiu: os cards já conectam com 1 clique e
o texto repetia isso.

**O cuidado que valeu:** dentro dele morava a ÚNICA porta do **cadastro manual
do WhatsApp Cloud** — o caminho de quando o OAuth não roda (App Review
pendente, Tech Provider não aprovado, BM dona do app). Tirar o banner inteiro
levaria junto uma função que ninguém mandou remover. Ela virou uma linha
discreta embaixo dos cards, com o mesmo clique.

O aviso "Instagram e Messenger: em breve", que o banner também dava, continua
na descrição de cada card, no pill ao lado do nome e no botão travado — o teste
`instagram-em-breve` foi ajustado para conferir esses três em vez do banner.

Amarra: `logos-reais-nas-integracoes.test.ts` (7 testes) — 10 mutações vermelhas
em `scratchpad/mutar-logos-reais.py`.
