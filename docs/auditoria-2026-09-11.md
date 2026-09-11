# Auditoria de saúde — 11/09/2026

Rotina agendada: "procure falhas no código incansavelmente pra garantir que
nada esteja sem funcionar". Escopo: saúde mecânica (typecheck + suíte
inteira) + revisão adversarial do que foi mesclado desde a última auditoria
grande (03/09), que é o código com menos quilometragem — features de
09/09 e 10/09 rodaram em produção por 1-2 dias antes desta passada.

## Método

1. Instalação limpa (`pnpm install` — o container não tinha `node_modules`),
   `pnpm check` e `pnpm test` completos.
2. Dois leitores em paralelo, cada um sem contexto do outro: um caçando
   bugs de correção nos 5 commits mais recentes e arriscados (retomada do
   robô por timeout, encerrar conversa cancela roteiro parado, mesclar
   campo a campo, cancelar contrato, fuso no servidor); outro caçando
   especificamente vazamento entre escritórios (a classe de bug que foi o
   P0-A da auditoria de 03/09) em todas as procedures novas desde então.
3. Os 2 achados que sobraram foram conferidos por mim, lendo o código e o
   caminho até a tela (não só o diff) antes de aceitar.
4. **Os dois foram corrigidos nesta mesma passada** — são bugs de lógica
   sem tela nova (não pedem mockup) e de baixo risco de regressão, cobertos
   por teste antes do commit. Segue a regra do dono: nada removido, só
   validação adicionada.

## Resultado mecânico

- `pnpm check` (typecheck): **limpo**.
- `pnpm test`: **374 arquivos, 5413 testes, todos verdes** (mais os 13
  testes novos desta auditoria).
- Vazamento entre escritórios: **nada novo encontrado** nas procedures
  criadas depois de 03/09 (cancelar-contrato, reconhecer-cadastro,
  conferência de cadastros, mesclar campo a campo, admin.trocarPlanoAdmin).
  De passagem, o leitor confirmou que `agentesIa.listarCapturadosDoContato`
  (server/integracoes/agente-captura-campos.ts) tinha esse exato problema
  e **já foi corrigido dentro da própria janela** — não é um achado novo,
  é uma conferência de que o fix já está no código atual.

## Achados corrigidos nesta passada

### 1. "Cancelar também os contratos" aceitava qualquer data, inclusive antes do próprio contrato fechar

`server/escritorio/cancelar-contrato.ts` — `cancelarContratosDoContato`.

O cancelamento individual (`cancelarContrato`) sempre validou a data:
não pode ser no futuro, não pode ser antes do dia em que ESSE contrato
fechou (`validarDataCancelamento`). A versão em lote — usada quando o
usuário marca "cancelar também os contratos" ao encerrar o serviço pela
ficha do cliente (`clientes.encerrarServico`) — só checava o FORMATO da
data; aplicava a mesma data escolhida a todos os contratos `fechado_ganho`
abertos do cliente, sem checar nem o futuro nem o fechamento de cada um.

Cenário real: cliente com dois contratos fechados em datas diferentes
(ex.: 01/06 e 01/08). O usuário encerra o serviço com data 15/06 e marca
"cancelar também os contratos" — o campo de data no diálogo
(`client/src/pages/Clientes.tsx:4172`) é um `<input type="date">` sem
`min`/`max`, então a tela deixa escolher livremente. O segundo contrato
(fechado 01/08) seria gravado como cancelado num dia ANTES de ter fechado.
Isso corrompe o Relatório Comercial (funil "cancelado" e "recebido antes
de cancelar" partem de `canceladoEm >= fechadoEm` implicitamente).

**Fix**: `cancelarContratosDoContato` agora recebe o fuso do escritório,
recusa data no futuro (igual ao caminho individual) e filtra a lista pra
só cancelar os contratos cuja PRÓPRIA data de fechamento é `<=` a data
escolhida — usando a mesma `validarDataCancelamento` de sempre. Contrato
que não passa fica de fora (não cancela, não lança erro) — continua
aberto e pode ser cancelado depois, individualmente, com a data certa.
Não muda tela.

Testes novos em `server/__tests__/cancelar-contrato.test.ts`: recusa
futuro; dois contratos com datas de fechamento diferentes — só o que a
data serve é cancelado.

### 2. Mesclar campo a campo: escolher um lado vazio apagava o valor que já estava certo

`server/escritorio/reconhecer-cadastro.ts` — `unificarComRegistro`.

A tela (`mesclar-escolher-campos.tsx`) só deixa clicar no lado que tem
valor — proteção só no client. A procedure aplicava a escolha recebida
direto (`fonte.email ?? null`, `fonte.responsavelId ?? null`, etc.) sem
reconferir se o lado escolhido realmente tinha valor. Uma chamada direta
de `crm.unificarContatos`/`clientes.mesclarDuplicados` (gate:
`clientes.excluir`) com, por exemplo, `escolhas: { responsavelId:
"duplicado" }` apontando pro lado sem responsável apagaria o
`responsavelId` de quem sobrevive — campo que, segundo o próprio
`CLAUDE.md`, decide acesso, comissão e rodízio de atendimento. O mesmo
valia pra email/cpfCnpj/observações.

**Fix**: cada ramo só grava a escolha quando o lado escolhido de fato tem
valor (mesma regra que decide se a tela oferece a linha como "escolha" em
`linhasDaMesclagem`). Lado vazio escolhido = a procedure ignora e mantém o
que a mesclagem de sempre já decidiu. Não muda tela nem o comportamento
via UI (que já impedia clicar no lado vazio) — só fecha a porta pra quem
chamar a procedure direto.

Testes novos em `server/__tests__/mesclar-escolher-campos.test.ts`: lado
vazio escolhido não apaga cpfCnpj/observações preenchidos; responsável em
branco escolhido não desliga o responsável de quem fica.

## O que NÃO foi mexido

Tudo que já está documentado no `CLAUDE.md` como decisão pendente do dono
ou item conscientemente adiado (HMAC brando da Meta, CSP desligado,
body-parser 3GB, robô de jornada, card "Recebido" do Relatório Comercial,
disparo proativo que não confere conversa em atendimento, JurisIA
comercial, extras avulsos do pacote de 3 planos, `admin.criarCliente` sem
WhatsApp obrigatório) **continua como está** — não é escopo desta rotina
reabrir isso sozinho.

## Commit

Ambos os fixes + testes estão no branch desta sessão, com `pnpm check` e
`pnpm test` (5413 testes) verdes depois da mudança. Aguardando autorização
do dono pra mesclar em `develop`/`main`, seguindo a regra do próprio
`CLAUDE.md` (autorização é dada na hora, não fica implícita numa rotina
agendada).
