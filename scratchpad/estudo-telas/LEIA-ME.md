# scratchpad/estudo-telas — a oficina do mockup navegável

Tudo aqui serve a uma regra do dono (12/09/2026): **mockup de tela que já
existe sai do app rodando, navegável, antes ⟷ depois.** Receita contada em
`docs/mockup-navegavel.md`.

| Arquivo | Para que serve |
|---|---|
| `povoar.sql` | Povoa o banco local com dados jurídicos plausíveis. Idempotente; resolve vínculos por NOME, nunca por id. Rodar com `--default-character-set=utf8mb4`. |
| `aceita-termos.mjs` | Aceita o TermosGate e salva o `storageState` da sessão do dono. |
| `serializa.mjs` | Serializa o DOM real das telas (HTML + CSS do app, imagens/canvas embutidos) em 1440×900 e 390×844. |
| `fontes.mjs` | Baixa Inter (variável) + Poppins e devolve um CSS com as fontes em base64, subconjunto latin. |
| `gera-navegavel.mjs` | Monta o HTML navegável auto-contido a partir de duas pastas serializadas. |
| `confere-navegavel.mjs` | Dirige o navegável com Playwright, mede cada combinação, acusa tela vazia e tira as fotos. |
| `culpado-tarefas.mjs` | Acha QUEM empurra uma tela de lado no celular (elemento, classe, largura). Trocar a rota para reusar. |
| `captura.mjs` · `cel-completo.mjs` · `medir.mjs` | Da rodada do estudo (11/09): fotos PNG e medições por tela. |

Ordem de uso:

```bash
# 1. app no ar + dados
mariadb --default-character-set=utf8mb4 -ujf -pjf -h127.0.0.1 juridflow < povoar.sql
# 2. os dois lados
node serializa.mjs /tmp/ser-depois /tmp/sessao.json
git checkout <antes> -- client/src/pages/...   # e espera o Vite recarregar
node serializa.mjs /tmp/ser-antes  /tmp/sessao.json
git checkout <depois> -- client/src/pages/...
# 3. monta e confere
node fontes.mjs > /tmp/fontes.css
node gera-navegavel.mjs /tmp/ser-antes /tmp/ser-depois /tmp/fontes.css /tmp/mockup.html
node confere-navegavel.mjs /tmp/mockup.html /tmp/fotos
```

Os HTMLs serializados e as fotos **não são versionados** — são
reproduzíveis, e o conjunto passa de 4 MB.
