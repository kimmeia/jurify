---
name: mockup-juridflow
description: Gera mockups de tela do JuridFlow em HTML renderizado para PNG, no tom visual clean aprovado pelo dono (slate + violeta, cards brancos, tipografia Inter/Poppins). Use sempre que o pedido envolver mockup, protótipo, "gere uma tela", "como podemos melhorar esse módulo", proposta de redesign, nova visão/aba de um módulo, ou qualquer coisa que o dono precise **ver** antes de aprovar implementação — inclusive quando ele não usar a palavra "mockup" e só perguntar como melhorar uma funcionalidade.
---

# Mockups do JuridFlow

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

**Uma cor de ação.** Violeta `#7c3aed`, e só. Botão primário, controle
selecionado, dia de hoje, o que é novo. Se dois elementos disputam o
violeta na mesma tela, um dos dois não é ação primária — deixe neutro.
Estado ativo de chip/filtro usa tinta sólida `#0f172a`, não violeta.

**Hierarquia por peso e cor, não por tamanho.** O corpo inteiro vive entre
10px e 13.5px. O que mudam são o peso (500 → 600 → 700) e o tom do cinza
(`#0f172a` → `#334155` → `#64748b` → `#94a3b8`). Título de página é
Poppins 700/27px, título de seção Poppins 700/16px — só isso é Poppins, o
resto é Inter.

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
