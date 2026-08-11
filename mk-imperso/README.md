# Mockup — faixa de impersonação

Proposta aguardando aprovação do dono. Sai do repositório assim que for
implementada.

`gerar.py` monta `faixa-impersonacao.html` embutindo o CSS **compilado** do
próprio app (`dist/public/assets/index-*.css`). É isso que faz o mockup valer
como evidência em vez de desenho: as classes são as mesmas do componente, então
o que aparece aqui é o que vai aparecer na tela.

Para regerar depois de um `pnpm vite build`, ajuste o nome do arquivo de CSS no
topo do script — ele muda de hash a cada build.

Classes que só existem no mockup não entram no CSS, porque o Tailwind varre a
partir de `client/src`. Quando precisar delas, acrescente temporariamente

    @source "/home/user/jurify/mk-imperso/**/*.html";

logo abaixo do `@import "tailwindcss"` em `client/src/index.css`, rode o build,
e **remova a linha em seguida** — ela não pode ir pra produção.
