# Mockups dos painéis setoriais

Proposta visual para Comercial, Operacional e Financeiro na mesma linguagem já
aplicada no painel Geral. **Aguardando aprovação do dono** — nada aqui é código
de produção, e a pasta sai do repositório quando a implementação entrar.

## Por que não é um mockup desenhado à mão

As três páginas usam as classes reais do app e carregam o CSS compilado do
próprio projeto. Isso é o que garante que o layout aprovado seja o layout que a
tela vai ter: a altura que o navegador calcula aqui é a mesma que o React vai
calcular lá, porque é o mesmo CSS resolvendo as mesmas classes.

Um mockup com CSS próprio prova só que o desenho é bonito. Este prova que o
desenho *cabe*.

## Como regerar

```bash
python3 mockups-painel/gerar.py        # monta os .html
```

O Tailwind v4 varre a partir da pasta do CSS de entrada (`client/src/`), então
classes que só existem aqui não entram no bundle. Para compilar um CSS que as
cubra, adicione temporariamente em `client/src/index.css`, logo abaixo do
`@import "tailwindcss"`:

```css
@source "/caminho/absoluto/para/mockups-painel/**/*.html";
```

Depois `pnpm vite build`, copie `dist/public/assets/index-*.css` para
`mockups-painel/app.css` e **reverta a linha `@source`** — ela não pode subir
para produção. Sem isso as barras e marcadores somem, que foi exatamente o
sintoma na primeira rodada.

```bash
node mockups-painel/shot.mjs           # PNGs claro/escuro + medidas de altura
```

O `shot.mjs` imprime a altura do card principal e do card lateral de cada
página. Os dois números precisam bater — é a verificação de que o card lateral
está travado na altura do vizinho em vez de esticar a linha.

## Pendência conhecida

"Ticket médio recebido", no Financeiro, é o único número que o backend ainda
não fornece — precisaria de uma contagem de pagamentos no `cashFlow`.
