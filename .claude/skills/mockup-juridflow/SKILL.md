---
name: mockup-juridflow
description: Gera mockups de tela do JuridFlow. Para tela que JÁ EXISTE, o mockup é NAVEGÁVEL e sai do app rodando (DOM serializado, antes ⟷ depois, computador ⟷ celular) — desenhar de memória foi reprovado pelo dono. Para tela que ainda não existe, desenha em HTML no tom visual aprovado (marinho #194b86, cards brancos, Inter). Use sempre que o pedido envolver mockup, protótipo, "gere uma tela", "como podemos melhorar esse módulo", proposta de redesign, nova visão/aba de um módulo, ou qualquer coisa que o dono precise **ver** antes de aprovar implementação — inclusive quando ele não usar a palavra "mockup" e só perguntar como melhorar uma funcionalidade.
---

# Mockups do JuridFlow

## ANTES DE TUDO: a tela já existe?

**Se existe, o mockup NÃO é desenhado — é capturado do app rodando.** Regra
do dono, 12/09/2026, nas palavras dele: *"gere o mockup em html navegável
para eu visualizar como ficará no mundo real e aprovar ou não. adote como
regra."* Antes disso ele havia reprovado uma rodada de mockups desenhados à
mão: *"seus mockups não retratam o de uso real hoje, fez uma cópia barata e
muito mal feita"*. Estava certo — aquelas telas foram desenhadas a partir de
`grep`, sem ninguém nunca ter subido o app.

O caminho, em `docs/mockup-navegavel.md` (receita completa, com os scripts):

1. **Suba o app** (`docs/rodar-o-app-localmente.md`, ~5 min) e **povoe com
   dados** (`scratchpad/estudo-telas/povoar.sql`). Tela vazia esconde
   defeito: sem dados, quatro telas "não rolavam de lado" no celular — com
   dados, seis rolavam.
2. **Serialize o DOM** das telas (`serializa.mjs`): HTML real + CSS
   compilado do app, imagens e canvas embutidos, nos dois tamanhos
   (1440×900 e 390×844).
3. **Capture os dois lados.** "Antes" é o código sem a mudança, "depois" é
   com — os dois serializados do app, nenhum desenhado.
4. **Monte o navegável** (`gera-navegavel.mjs`): um HTML auto-contido com
   menu de telas, chave **Antes ⟷ Depois**, chave **Computador ⟷ Celular**
   e, em cada tela, o que muda escrito em português de gente. O menu do
   próprio app navega dentro do mockup.
5. **Dirija o mockup** com Playwright (`confere-navegavel.mjs`) e **olhe as
   fotos** com o Read. Sem isso você não sabe se alguma combinação saiu em
   branco.

O resto desta skill vale para **tela que ainda não existe** — e para ela o
desenho à mão continua sendo o caminho.

O dono aprova mudança de produto olhando, não lendo. Um mockup bom encurta
a conversa de três idas e voltas para uma: ele bate o olho, diz "ficou
lindo" ou aponta o que incomodou, e aí a implementação começa com o escopo
já fechado.

O tom visual aqui não é decoração — foi escolhido e aprovado. Manter os
mesmos tokens entre módulos faz as propostas parecerem parte do mesmo
produto, e não telas de origens diferentes coladas numa apresentação.

## O tom: clean

Cinco decisões explicam quase todo o resto.

**Fundo cinza, conteúdo branco.** A página é `#f8fafc`; tudo que é conteúdo
vive num card branco com borda `1px solid #e2e8f0` e raio 14px. Sem
sombras para separar blocos — a borda de 1px já separa, e sombra empilhada
suja a tela. Sombra fica reservada para o que flutua de verdade
(popover, bloco de agenda) e para o botão primário.

**Uma cor de ação.** Marinho `#194b86`, e só. Botão primário, controle
selecionado, dia de hoje, o que é novo. Se dois elementos disputam o
marinho na mesma tela, um dos dois não é ação primária — deixe neutro.
Estado ativo de chip/filtro usa tinta sólida `#0f172a`, não marinho.
⚠ O violeta `#7c3aed` que aparece em mockups antigos e no `assets/base.html`
**não é o app**: o violeta foi rejeitado pelo dono ("doía na vista") e
trocado por marinho. Mockup em violeta não retrata o produto.

**Hierarquia por peso e cor, não por tamanho.** Os tamanhos saem da escala
de `client/src/index.css` (`--text-micro` 11px · `--text-apoio` 11.5px ·
`--text-corpo` 13px · `--text-secao` 15px · `--text-titulo` 20px ·
`--text-numero` 22px · `--text-pagina` 26px). Piso de 11px: abaixo disso não
entra nada. Onde faltar contraste entre dois elementos, a saída é peso
(500 → 600 → 700) e cor (`#0f172a` → `#334155` → `#64748b` → `#94a3b8`) —
não inventar mais um tamanho.

**Poppins é só a marca.** A fonte de texto é Inter, inclusive nos títulos de
tela (`font-bold`). Poppins (`--font-display`) serve ao "J" do logotipo e
aos títulos das telas de login. Mockup antigo que escreve título em Poppins
está descrevendo algo que o app não faz.

**Micro-labels em maiúscula.** `10–11px`, `font-weight:700`,
`letter-spacing:.06em`, cor `#94a3b8`. É o que rotula legenda, seção de
popover, cabeçalho de coluna — informa sem competir.

**Densidade alta, respiro constante.** Padding de card 11–16px, gap entre
controles 9–10px. A tela mostra bastante coisa sem parecer apertada porque
o espaçamento nunca varia aleatoriamente: escolha um gap e repita.

Os valores exatos estão em `assets/base.html`, que já é um esqueleto
pronto com os tokens e os controles básicos. **Comece copiando ele.**
Receitas de componentes maiores — barra de filtros, popover de
multi-seleção, calendário mensal, swimlanes por pessoa, barra de carga,
legenda, rodapé de resumo — estão em `references/componentes.md`; leia
quando for montar um desses.

## Fluxo

Trabalhe no scratchpad da sessão e mova o HTML final para a raiz do repo
como `mockup-<assunto>.html` (é onde vivem os ~24 mockups anteriores). Os
PNGs não são versionados — são reproduzíveis.

**1. Escreva o HTML.** Copie `assets/base.html` junto com a pasta
`assets/fonts/` para o diretório de trabalho, ajuste o `<link>` da fonte e
monte a tela. Regras que evitam retrabalho:

- HTML e CSS na mão, sem framework, sem CDN. As fontes são locais porque o
  ambiente pode não ter rede — e fonte que não carrega muda todo o
  espaçamento sem avisar.
- Nada de JavaScript. O mockup é um retrato, não um protótipo clicável.
  Estado (popover aberto, aba selecionada, linha marcada) você escreve
  direto no HTML.
- `html,body` travados no tamanho exato do screenshot com
  `overflow:hidden`. Isso é de propósito: o que estourar o palco some do
  PNG, e o script de render acusa.
- Deixe aberto o que precisa ser visto. Um select fechado não comunica
  nada; o popover aberto é o mockup.

**2. Renderize.**

```bash
node .claude/skills/mockup-juridflow/scripts/render.mjs mockup-agenda-equipe.html
```

O script acha o Playwright e o Chromium sozinho, espera `document.fonts.ready`,
salva o PNG ao lado do HTML em 2x, e avisa se houve overflow ou recurso não
carregado. Passe `1600x1050` como argumento para forçar outro tamanho, ou
uma pasta para renderizar tudo.

Tamanhos usados até aqui: tela de app `1600x1050`, login/cadastro
`1600x900`, feed Meta `1080x1350`, story `1080x1920`.

**3. Olhe o PNG.** Com o Read, de verdade, sempre. Este passo não é
opcional e não dá para pular achando que o CSS está certo — em praticamente
toda iteração desta skill apareceu algo que só o olho pega: texto cortado
na célula, selo "NOVO" em cima de outro label, coluna estourando a grade,
contraste ruim de um bloco colorido. Corrija e renderize de novo até estar
limpo.

**4. Entregue.** `SendUserFile` com o PNG e uma explicação curta: o que
mudou, por que resolve o problema que ele levantou, e o que fica de fora.
Quando a proposta for grande, quebre em fatias implementáveis (ex: "1.
só o filtro; 2. filtro + visão Equipe; 3. + arrastar para reatribuir") para
ele escolher até onde ir.

## Conteúdo do mockup

Dados falsos, mas plausíveis e do domínio: nomes brasileiros completos,
vocabulário real do módulo (prazo, audiência, compromisso, protocolo,
cliente, processo, parcela, comissão). "Lorem ipsum" e "Fulano 1" fazem o
dono avaliar o layout no vazio, em vez de avaliar se a tela funciona para
o escritório dele.

Números precisam ser coerentes entre si: se a legenda diz "Ana 7", conte 7
eventos da Ana na grade. Incoerência aparece e derruba a confiança na
proposta inteira.

E uma linha que não pode ser cruzada: **não invente fato que possa vazar
para produção como se fosse real** — depoimento de cliente, logo de
empresa parceira, métrica de resultado, preço de plano. Preço vem da
tabela `planos`; se precisar de prova social no mockup, use um placeholder
óbvio e avise que é placeholder. Já aconteceu de um depoimento inventado
num mockup de cadastro quase virar página no ar.

## Armadilhas

**Overflow silencioso.** É o erro mais frequente. Grade com muitos itens
empurra o rodapé para fora e o PNG sai cortado sem nenhum aviso do
navegador. Use `overflow:hidden` na célula, `grid-auto-rows:1fr` na grade e
um "+3" em vez de listar tudo. O render acusa (exit 1), mas o olho é quem
confirma — e há um caso que só o olho pega: dentro do `.wrap`, que é flex
coluna, um filho grande demais **encolhe** em vez de transbordar. Nada é
cortado, tudo fica espremido, e o checador não reclama porque tecnicamente
coube. Se uma seção apareceu achatada no PNG, é isso; dê `flex:0 0 auto`
nela e reduza outra coisa.

**Badge posicionado com valor negativo.** `top:-9px; right:-9px` escapa do
card e cai em cima do vizinho dependendo do que estiver ao lado. Confira no
PNG.

**Excesso de destaque.** Um selo "NOVO" por mockup. Se tudo é novo, nada é.

**Divergir dos tokens.** Antes de escrever uma cor nova, procure em
`assets/base.html` — o tom que você quer quase sempre já existe com outro
nome. Paleta por pessoa (violeta, ciano, âmbar, esmeralda, rosa) é fixa e
nessa ordem, para a mesma pessoa ter a mesma cor entre telas.

**Mockup que só embeleza.** Toda tela precisa responder a uma pergunta que
o dono fez. Se o pedido foi "não dá para filtrar a agenda por responsável",
o mockup mostra o filtro em uso com pessoas selecionadas — não uma agenda
bonita com um select a mais no canto.
