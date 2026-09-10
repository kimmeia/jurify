# Geradores dos mockups de tipografia (10/09/2026)

Contexto e plano completos em `docs/frontend-sistema-visual-2026-09-10.md`.

`antes` e `depois` saem do MESMO gerador de propósito: mesmo conteúdo, mesma
grade, mesmas cores — a única diferença entre os dois HTMLs é o bloco de
tipografia. Se precisar mexer, mexa aqui e regere os dois; editar um HTML à
mão quebra a comparação.

## Como rodar

O `node_modules` do repo pode estar vazio numa sessão nova. Nesse caso, sem
tocar no repo:

```bash
SC=<seu scratchpad de sessão>
npm --prefix "$SC" install playwright-core     # o Chromium já vem em /opt/pw-browsers

# 1. bloco de fontes embutido em base64 (mockup tem que ser auto-contido)
F=.claude/skills/mockup-juridflow/assets/fonts
UR='U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'
{
  echo "<style>"
  printf "@font-face{font-family:'Inter';font-style:normal;font-weight:400 800;font-display:block;src:url(data:font/woff2;base64,%s) format('woff2');unicode-range:%s}\n" "$(base64 -w0 $F/inter-latin.woff2)" "$UR"
  for w in 600 700 800; do
    printf "@font-face{font-family:'Poppins';font-style:normal;font-weight:%s;font-display:block;src:url(data:font/woff2;base64,%s) format('woff2');unicode-range:%s}\n" "$w" "$(base64 -w0 $F/poppins-$w-latin.woff2)" "$UR"
  done
  echo "</style>"
} > "$SC/fontes.html"

# 2. gerar os 3 HTMLs na raiz do repo
node scratchpad/mockup-tipografia/gera.mjs        "$SC/fontes.html" .
node scratchpad/mockup-tipografia/gera-escala.mjs "$SC/fontes.html" .

# 3. renderizar os PNGs (PNG não é versionado — é reproduzível)
NODE_PATH="$SC/node_modules" node .claude/skills/mockup-juridflow/scripts/render.mjs \
  mockup-tipografia-antes.html mockup-tipografia-depois.html mockup-tipografia-escala.html
```

## Os outros dois scripts

- `mede.mjs` — mede no Chromium, com a fonte Inter real, a largura de um selo
  em 9px caixa alta contra 11px caixa normal. É de onde saem os números da
  tabela "Subir para 11px quase não custa largura". Não estimar: rodar.
- `ok2hex.mjs` — converte os tokens OKLCH do `client/src/index.css` para hex,
  que é o que o mockup usa. Rodar de novo se a paleta do produto mudar.

## Cuidados que já custaram uma volta

1. **Uma linha a mais do que cabe na lista**: o `overflow:hidden` do card
   corta em silêncio e o checador do render NÃO acusa. Confira o PNG.
2. **Card encolhendo em vez de transbordar**: dentro de uma coluna flex, um
   card grande demais é espremido e o conteúdo some sem aviso. Por isso
   `.card{flex:0 0 auto}` no `gera-escala.mjs` — não tire.
3. A skill `mockup-juridflow` ainda documenta o acento **violeta** `#7c3aed`,
   que o produto abandonou ("doía na vista"). O produto é **navy** `#194b86`;
   o violeta sobrou só na logo. Estes geradores já usam o navy.
