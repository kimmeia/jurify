# Mockup navegável: como se faz

> Regra do dono, 12/09/2026: *"gere o mockup em html navegável para eu
> visualizar como ficará no mundo real e aprovar ou não. adote como regra."*

Para tela que **já existe**, mockup não se desenha: se captura do app
rodando. Esta é a receita, do zero ao arquivo que o dono abre no navegador.

## Por que assim

Em 11/09 uma rodada de mockups desenhados à mão foi reprovada: *"seus
mockups não retratam o de uso real hoje, fez uma cópia barata e muito mal
feita"*. A causa era simples e não tinha defesa — as telas foram desenhadas
a partir de `grep` no código, sem ninguém nunca ter subido o app. `grep
'<h1'` mede a TAG, não o título: Clientes e Financeiro "não tinham título"
no meu diagnóstico e na verdade têm um hero inteiro, melhor do que o
cabeçalho que eu estava propondo.

Um segundo motivo, igualmente prático: **tela vazia esconde defeito**. Sem
dados, a varredura de celular disse que quatro telas não rolavam de lado.
Com dados, seis rolavam.

## Os quatro passos

### 1. Suba o app e povoe o banco

Receita do ambiente local: `docs/rodar-o-app-localmente.md` (~5 min neste
container — MariaDB por apt, `.env`, `pnpm dev` roda as migrations sozinho,
`scripts/seed-staging.ts`, aceitar os Termos e salvar o `storageState`).

Dados jurídicos plausíveis: `scratchpad/estudo-telas/povoar.sql`.

```bash
mariadb --default-character-set=utf8mb4 -ujf -pjf -h127.0.0.1 juridflow \
  < scratchpad/estudo-telas/povoar.sql
```

Duas coisas que já deram errado e estão resolvidas nesse arquivo:

- **`--default-character-set=utf8mb4` é obrigatório.** Sem ele a acentuação
  entra quebrada ("petiÃ§Ã£o") e vira falso achado na captura.
- **Ele é idempotente** — apaga o que ele mesmo criou antes de inserir, e
  resolve todo vínculo **por nome**, nunca por id fixo (o DELETE move a
  faixa de ids e referência fixa quebra a chave estrangeira de `leads`). Os
  DELETEs que chaves estrangeiras exigem (mensagens, conversas, tarefas)
  vêm no bloco do topo, antes do DELETE de `contatos`.

Povoa: 10 clientes, 8 compromissos, 10 leads (5 ganhos), 6 cards de Kanban,
7 cobranças, 7 monitoramentos, 7 movimentações, 1 canal de WhatsApp,
6 conversas com 8 mensagens e 7 tarefas.

### 2. Serialize as telas

```bash
node scratchpad/estudo-telas/serializa.mjs <pasta-de-saida> <sessao.json> [tela,tela]
```

Grava `css.txt` (o CSS compilado do app, uma vez) e
`<desktop|celular>/<tela>.html` (só o `<body>`). O que ele resolve:

- **script nenhum sobrevive** — o HTML salvo é foto, não app;
- `<img>` do mesmo host vira `data:` URI (offline não existe `/uploads/…`);
- `<canvas>` (gráfico pintado por JS) vira imagem via `toDataURL`;
- o que está digitado vive em `.value`, não no atributo — é copiado;
- **no celular o app abre em "modo atendimento"** e joga qualquer outra rota
  para `/atendimento` (`AppLayout.tsx`, `modoFocadoMobile`). O script liga
  `localStorage jurify:mobileCompleto = "1"`, que é a "versão completa" —
  é ela que precisa ser fotografada.

### 3. Capture os DOIS lados

"Antes" é o código sem a mudança; "depois" é com. Os dois serializados do
app. Com a mudança em poucos arquivos, dá para ir e voltar sem trocar de
branch:

```bash
git checkout <commit-antes> -- client/src/pages/Financeiro.tsx ...
# espera o Vite recarregar, serializa para ser-antes/
git checkout <commit-depois> -- client/src/pages/Financeiro.tsx ...
```

O próprio log da serialização já entrega a prova: ele marca
`ROLA DE LADO` quando a página empurra de lado, e a diferença entre os dois
logs é o antes/depois medido, não opinado.

### 4. Monte e confira o navegável

```bash
node scratchpad/estudo-telas/fontes.mjs > fontes.css      # Inter+Poppins base64
node scratchpad/estudo-telas/gera-navegavel.mjs \
  ser-antes ser-depois fontes.css mockup-navegavel.html
node scratchpad/estudo-telas/confere-navegavel.mjs mockup-navegavel.html fotos/
```

O HTML de saída é auto-contido (~4 MB): fontes em base64, CSS do app
embutido, cada tela num `iframe` alimentado por `srcdoc`. Tem menu de
telas, chave **Antes ⟷ Depois** (tecla `A`), chave **Computador ⟷ Celular**
(tecla `C`), zoom "cabe na tela / tamanho real", e em cada tela o que muda
escrito em português de gente. O menu do próprio app navega dentro do
mockup (clique em link é interceptado e vira troca de tela).

`confere-navegavel.mjs` dirige o arquivo como o dono vai dirigir: passa por
cada combinação tela × estado × tamanho, mede nós/texto/largura do corpo,
acusa combinação que saiu vazia e erro de página, e tira as fotos. **Olhe as
fotos com o Read** — houve regressão que passou por typecheck e por 4.696
testes e só o olho pegou (um `whitespace-nowrap` que trocou quebra de linha
por invasão do cartão vizinho).

## A lição de 12/09: navegar não é comparar

O primeiro navegável foi entregue e o dono respondeu: *"o antes e depois tá a
mesma coisa, não consegui entender as diferenças."* Ele estava certo, e o
defeito era da apresentação:

1. **Abria no computador, e cinco dos seis consertos só aparecem no celular.**
   A primeira tela que ele viu era, de fato, idêntica nos dois estados.
2. **A chave Antes/Depois pede memória.** Apertar um botão e comparar com o
   que se viu dois segundos antes não funciona para diferença de 40px.
3. **O quadro de 390px CORTA o que vaza.** O vazamento é justamente o defeito
   — e ele ficava invisível, então o "antes" parecia normal.
4. **Nada dizia onde olhar.**

O que resolveu (`gera-comparador.mjs`, saída `comparador-antes-depois.html`):

- **uma comparação por achado**, que já abre na tela E no tamanho onde ele
  acontece (o item diz "no celular" ou "no computador");
- **os dois lados ao mesmo tempo**, com o MESMO recorte e a MESMA rolagem —
  quando o conserto empurra o elemento para a linha de baixo, é essa descida
  que conta a história;
- **anel** em cima do elemento que mudou, nos dois lados;
- **linha tracejada da borda da tela** (390px) nas comparações de celular:
  o anel cruza a linha no "antes" e não cruza no "depois". É esse par que
  torna o vazamento visível;
- **régua medida** embaixo ("antes 461px · depois 390px");
- **"Onde olhar"**, uma frase dizendo exatamente o que procurar;
- **"Piscar"**, que sobrepõe os dois no mesmo lugar alternando a cada 0,9s —
  é assim que olho humano acha diferença pequena;
- e o passeio pelo sistema continua lá, numa seção à parte.

Duas armadilhas encontradas ao montar, que valem para a próxima vez:

- **O anel tem que estar no elemento que MUDA.** `mede-alvos.mjs` mede o
  retângulo do alvo nos dois estados e classifica a história
  (`cruza→cabe` · `muda de tamanho` · `MESMO retângulo`). Três alvos estavam
  no elemento errado — o anel ficava idêntico nos dois lados, que é o mesmo
  problema de novo, só menor.
- **Zoom demais mata o contexto.** Com o recorte calculado só pelo alvo, um
  botão de 85px dava 2,4× e a linha da borda saía da foto. O recorte agora
  cobre os dois retângulos e, no celular, sempre inclui a borda dos 390px;
  o zoom tem teto de 1,8×.

## Limites honestos

- É **foto**, não protótipo: dentro do iframe nada abre, filtra ou envia. A
  navegação entre telas é do mockup, não do app.
- Um `iframe` de 390px de largura reproduz as media queries de celular, mas
  não o toque, nem o teclado virtual, nem a barra do navegador móvel.
- Diálogo/popover só aparece se estava aberto na hora da captura.
