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

## Limites honestos

- É **foto**, não protótipo: dentro do iframe nada abre, filtra ou envia. A
  navegação entre telas é do mockup, não do app.
- Um `iframe` de 390px de largura reproduz as media queries de celular, mas
  não o toque, nem o teclado virtual, nem a barra do navegador móvel.
- Diálogo/popover só aparece se estava aberto na hora da captura.
