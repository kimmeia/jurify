# Mockup — módulo Acordos

Proposta de redesign (layout + funcionalidades) aguardando aprovação do dono.
Some do repositório quando for implementada.

## Por que HTML e não figura

As classes são as **mesmas do app**, e a página carrega o CSS compilado do
próprio projeto. Isso troca "desenho que parece a tela" por "a tela, com dados
falsos": o que for aprovado transfere pro componente sem tradução, e um layout
que quebra aqui quebra igual em produção.

## Como regerar

```bash
# 1. Faz o Tailwind varrer esta pasta (senão as classes que só existem no
#    mockup não entram no CSS e barras/marcadores somem sem erro nenhum).
#    Em client/src/index.css, logo após `@import "tailwindcss";`:
#      @source "/home/user/jurify/mk-acordos/**/*.html";

python3 mk-acordos/gerar.py
pnpm vite build
cp dist/public/assets/index-*.css mk-acordos/app.css
node mk-acordos/shot.mjs          # gera os PNG claro/escuro

# 2. Reverter o @source antes de commitar.
```

## O que as duas telas mostram

- `lista.html` — visão do escritório: o que travou, de quem é a vez, e a régua
  da negociação em cada linha.
- `detalhe.html` — o painel que abre ao clicar numa linha: proposta atual
  contra limite e meta, quem negocia do outro lado, e o histórico.
