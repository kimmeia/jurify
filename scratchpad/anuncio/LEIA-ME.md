# Capturas do relatório de anúncios (14/09)

Scripts que produziram `mockup-relatorio-anuncio.html`. O "antes" e o
"depois" são FOTO do app rodando — nenhum pixel desenhado à mão.

Receita, na ordem:

1. Ambiente: `docs/rodar-o-app-localmente.md` (MariaDB por apt — se o
   `apt-get install` der 404, rode `apt-get update` antes; o índice do
   container costuma estar velho).
2. Dados: `pnpm tsx scripts/seed-staging.ts` e depois
   `mariadb --default-character-set=utf8mb4 -uroot juridflow < scratchpad/estudo-telas/povoar.sql`.
   **O `--default-character-set=utf8mb4` não é opcional**: sem ele o acento
   entra quebrado, o `UPDATE ... LIKE '%João Silva%'` não casa e os leads
   falham com "contatoIdLead cannot be null".
3. Aba Comercial exige **setor do tipo `comercial`** com colaboradores
   dentro (`colaboradores.setorIdCol`). Sem isso ela renderiza vazia — é o
   caso da seção 29 do documento de estado, e foi o que me fez achar que o
   cartão não estava aparecendo.
4. Cobrança só entra no Recebido se for comissionável:
   `comissionavelOverrideAsaasCob = 1`, ou categoria comissionável.
   Com os dois nulos ela cai em "indefinido" e some da conta.

Scripts: `login.mjs` (guarda a sessão; aceita os Termos), `foto.mjs`,
`recorta.mjs` (recorta o cartão no computador), `cel2.mjs` (celular —
precisa de `localStorage jurify:mobileCompleto=1`, senão o app fica no
modo focado do Atendimento e `/relatorios` cai em `/atendimento`),
`full.mjs` (tela inteira), `confere2.mjs` (dirige o comparador e prova
que nenhuma das 4 combinações sai em branco).

O Playwright do repo é importado por caminho absoluto: o pacote não está
no `node_modules` raiz, só em `.pnpm`.
