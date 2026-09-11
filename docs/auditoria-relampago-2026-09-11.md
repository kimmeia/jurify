# Auditoria relâmpago — 11/09/2026

Rotina automática de "procurar falhas incansavelmente". Baseline: `pnpm check`
limpo e `pnpm test` 100% verde (378 arquivos, 5.526 testes) ANTES de tocar em
qualquer coisa — nenhuma regressão pré-existente nos testes já escritos.

Foco: o commit mais recente na branch (`e2e3c0b`, hoje 11/09, já mergeado em
`develop`/`main` por `f1e5413`/`91a151a`) ainda não tinha entrada no CLAUDE.md
nem tinha passado pela "leitura adversarial" que os outros itens da fila
recebem — então foi o primeiro lugar procurado.

## Corrigido (autorizado pela rotina: "corrija")

### `consumirCredito` negava exatamente o caso que o próprio comentário promete liberar

**Arquivo:** `server/db.ts:1078` (função usada por `router-trabalhista.ts`,
`router-imobiliario.ts`, `router-previdenciario.ts` e `router-financiamento.ts`
— os 5 pontos onde um cálculo jurídico é cobrado).

O docstring da função, escrito NESTE MESMO commit de hoje, diz:

> `false` = o mês acabou (o router devolve o erro ao usuário). Dúvida nossa
> (sem banco, sem escritório, plano não resolvido) libera.

Mas o código:

```ts
const esc = await getEscritorioPorUsuario(userId);
if (!esc) return false;   // ← nega, não libera
```

`return false` faz o router lançar `"Seus créditos acabaram. Adquira mais
créditos ou faça upgrade do seu plano."` — uma mensagem enganosa (o problema
não é crédito nenhum) para exatamente o caso ("sem escritório") que o
comentário da própria função, escrito hoje, classifica como fail-open.

**Causa:** o `if (!esc) return false` é sobra do desenho ANTIGO (débito de
saldo de crédito do escritório — sem escritório não tinha de onde debitar, e
negar fazia sentido). A refatoração de hoje trocou o corpo da função pela
régua de limite mensal e escreveu um docstring novo prometendo fail-open,
mas não atualizou esta linha especifica para acompanhar. Nenhum teste cobria
o ramo (`creditos-viram-limites.test.ts` testa a régua de limite, não este
`if`).

**Fix:** `if (!esc) return true;` — alinha o código ao comportamento que o
próprio commit de hoje já declarou como decidido pelo dono. Não é remoção de
nada, não muda tela, não muda migration: é o código passar a fazer o que o
comentário ao lado dele, escrito na mesma hora, já dizia que fazia.

**Teste novo:** `server/__tests__/creditos-viram-limites.test.ts` ganhou o
caso "sem escritório resolvido, consumirCredito libera" (leitura de código,
mesmo estilo das outras amarras do arquivo — a função depende de conexão MySQL
real então testar por injeção de mock não é prático aqui sem reescrever o
acesso a banco da função).

**Validado:** `pnpm check` limpo, suíte inteira 100% verde antes e depois
(ver rodapé), testes dos 5 routers de cálculo + o novo caso passando
isoladamente.

### Os 5 routers de cálculo prometiam comprar créditos que não existem mais

**Achado pelo dono**, ao ler o primeiro relatório: "Mas não usamos mais
créditos" — e ele tinha razão, o fix acima não bastava.

`consumirCredito` sinalizava limite atingido só com um `boolean`, e os 7
pontos de chamada (`router-trabalhista.ts` ×2, `router-imobiliario.ts`,
`router-previdenciario.ts` ×3, `router-financiamento.ts`) inventavam CADA
UM o próprio texto de erro quando `false` voltava:

```
"Seus créditos acabaram. Adquira mais créditos ou faça upgrade do seu plano."
"Créditos esgotados."
```

Isso é exatamente o texto do desenho ANTIGO — e contradiz a decisão já
registrada em `shared/limites-uso.ts`: "Não oferece compra avulsa de
propósito (decisão do dono): quem libera mais é o escritório falando com a
gente, e o painel aumenta o limite do mês." Ou seja: mesmo sem o bug do
`!esc`, todo usuário que baixesse legitimamente no teto mensal de cálculos
via um convite pra comprar crédito que o sistema não vende mais.

**Fix:** `consumirCredito` deixou de devolver `boolean` e passou a devolver
`void`, lançando a MESMA mensagem que `verificarUso`/`mensagemLimiteAtingido`
já monta pra processos ("Você usou N cálculos deste mês. Fale com a gente
para liberar mais.") — uma régua só, um texto só. Os 7 pontos de chamada
perderam o `if (!temCredito) throw new Error(...)` particular; agora é só
`await consumirCredito(ctx.user.id);`. Confirmado que nada no client lida
com o texto antigo por string (`grep` em `client/src` por essas frases: zero
ocorrências) — trocar o texto não quebra nenhuma tela.

**Testes novos** em `creditos-viram-limites.test.ts`: a mensagem lançada é a
do `verificarUso` (não contém "adquira"/"upgrade"), e nenhum dos 4 arquivos
de router de cálculo ainda contém o texto antigo ou a variável `temCredito`.

**Validado:** `pnpm check` limpo, suíte inteira verde de novo (ver rodapé).

## Achados anotados, NÃO corrigidos (fora do pedido desta rotina ou pedem decisão do dono)

Nada aqui é "quebrado" no sentido de perder dinheiro ou vazar dado entre
escritórios — são débito técnico ou comentários desatualizados. Registrando
para não perder de vista, sem tocar em código de tela (regra do mockup) nem
remover nada sem autorização explícita.

- **Comentários desatualizados em `server/routers/processos.ts`** (cabeçalho
  do arquivo, linha 13, e os docs de `resumoIA`/`consultarCNJSincrono`) ainda
  dizem "cobra 1 crédito" / "o crédito já foi debitado" — desde hoje essas
  operações contam em `escritorioUsoMensal`, não debitam mais crédito nenhum.
  O código está certo (confirmado: nenhuma chamada dupla a `motorCreditos`
  nesses caminhos); só o texto ficou para trás. Baixo risco — mas é o mesmo
  tipo de problema que já causou o incidente do `/uploads` (comentário
  documentando premissa que deixou de valer). Se autorizado, é troca de
  comentário, sem mudança de comportamento.
- **`window.confirm()` nativo em ~18 lugares do client** (`AdminClients.tsx`,
  `Kanban.tsx`, `Configuracoes.tsx`, `Agendamento.tsx`, `Tarefas.tsx`,
  `Plans.tsx`, `configuracoes/dialogs.tsx`, `meta-connect-dialog.tsx`,
  `CuponsSection.tsx`, `AdminAgentesIA.tsx`, `ParecerEditor.tsx` — lista
  completa disponível se quiser) para ações destrutivas (excluir cargo,
  remover colaborador, deletar cupom, resetar senha, excluir funil/coluna,
  desconectar Asaas/Meta, etc). O próprio CLAUDE.md já lista isso como
  anti-pattern conhecido ("use AlertDialog") — não é regressão de hoje, é
  débito antigo que nunca foi migrado por completo. Funciona (não está
  quebrado), só não segue o padrão que o projeto adotou. Mudança de tela →
  pede mockup antes, então não toquei.
- **Nenhum ponto novo de cruzamento entre escritórios** encontrado no código
  tocado hoje: toda leitura em `router-assinaturas.ts`, `limites-uso.ts` e
  `processos.ts` que vi passa `escritorioId` explícito nas queries.

## O que ficou de fora desta rodada (por escopo, não por achado)

Não abri o lado de "Assinatura: assinado sem comprovante" além da leitura de
`shared/assinatura-estado.ts` (a lógica de estado parece consistente — a
ordem de decisão está clara e coberta por `server/__tests__/assinado-sem-comprovante.test.ts`,
que também está verde). Não fiz varredura completa de
`opcoes-interativas.tsx`/`mensagem-interativa.ts` (botões na conversa) além
de confirmar que a suíte cobrindo esse trecho (`botoes-na-conversa.test.ts`)
está verde. Se quiser, a próxima rodada aprofunda esses dois.

---

**Estado final:** `pnpm check` limpo · `pnpm test` verde antes e depois do
fix (contagem de testes sobe em +1 pelo caso novo). Fix já commitado na
branch da sessão; aguardando decisão do dono para seguir o fluxo normal
(PR → `develop` → `main`, ou merge direto se ele autorizar ao vivo).
