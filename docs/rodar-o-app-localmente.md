# Subir o JuridFlow local e fotografar as telas REAIS

**Por que este arquivo existe.** Em 11/09 um mockup foi reprovado pelo dono
com a palavra certa: *"seus mockups não retratam o de uso real hoje, fez uma
cópia barata e muito mal feita"*. A causa raiz foi eu ter desenhado as telas
a partir de `grep` no código em vez de **olhar o sistema rodando**. Dá para
subir o app inteiro neste ambiente em ~5 minutos. Não desenhe tela de
memória de novo.

> **Regra que fica:** proposta de mudança visual começa com a FOTO da tela
> real. O "antes" nunca é desenhado — é `screenshot`.

---

## Receita completa

### 1. Banco (MariaDB local)

Docker **não** serve aqui: o proxy do ambiente bloqueia o CDN de blobs do
Docker Hub (403 no `production.cloudfront.docker.com`). O apt funciona.

```bash
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq mariadb-server
mkdir -p /var/run/mysqld && chown mysql:mysql /var/run/mysqld
(mariadbd-safe >/tmp/mariadb.log 2>&1 &)
until mariadb -uroot -e "SELECT 1" >/dev/null 2>&1; do sleep 2; done
mariadb -uroot -e "CREATE DATABASE IF NOT EXISTS juridflow CHARACTER SET utf8mb4;
  CREATE USER IF NOT EXISTS 'jf'@'%' IDENTIFIED BY 'jf';
  GRANT ALL ON juridflow.* TO 'jf'@'%'; FLUSH PRIVILEGES;"
```

### 2. `.env` (fica fora do git — já está no `.gitignore`)

Só `DATABASE_URL` e `JWT_SECRET` derrubam o boot; o resto falha em silêncio e
não atrapalha quem só quer ver tela.

```bash
cat > .env <<'EOF'
DATABASE_URL=mysql://jf:jf@127.0.0.1:3306/juridflow
JWT_SECRET=<qualquer string longa — é banco descartável>
NODE_ENV=development
JURIFY_AMBIENTE=staging
JURIFY_SEED_FORCE=1
SMOKE_PASSWORD=Smoke123!
PORT=3000
EOF
```

### 3. Subir (ele migra sozinho) e semear

`server/_core/auto-migrate.ts` roda no boot — foram 225 migrations num banco
vazio, sem precisar de `drizzle-kit`.

```bash
pnpm install --frozen-lockfile        # se node_modules estiver vazio
pnpm dev > /tmp/jf-dev.log 2>&1 &
until grep -q 'Server running' /tmp/jf-dev.log; do sleep 3; done
pnpm tsx scripts/seed-staging.ts      # 4 contas + escritório + 5 clientes
```

Contas do seed (senha `Smoke123!`):
`dono-smoke@` (dono) · `gestor-smoke@` · `atendente-smoke@` · `admin-smoke@`.

### 4. Logar, **aceitar os Termos** e guardar a sessão

O `TermosGate` é bloqueante pro DONO (`TERMOS_VERSAO=2`) e cobre a tela
inteira com um diálogo. Se você fotografar sem aceitar, TODAS as fotos saem
com o modal por cima — aconteceu na primeira tentativa.

```js
await p.goto("http://localhost:3000/login");
await p.fill('input[type="email"]', "dono-smoke@juridflow.com.br");
await p.fill('input[type="password"]', "Smoke123!");
await p.click('button[type="submit"]');
await p.waitForTimeout(4000);
await p.locator('[role="checkbox"]').first().click();
await p.click('button:has-text("Aceitar e continuar")');
await ctx.storageState({ path: "sessao.json" });   // reusar nas próximas
```

Depois é só `browser.newContext({ storageState: "sessao.json" })` e navegar.
Playwright do repo:
`node_modules/.pnpm/playwright@1.59.1/node_modules/playwright/index.mjs`;
Chromium em `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.

### 5. Limpar

```bash
pkill -f 'tsx watch' ; pkill -f mariadbd ; rm -f .env
```

---

## O que as fotos revelaram (11/09) — leia antes de propor qualquer coisa

O `grep '<h1'` **mede a tag, não o título**. Por isso a minha medição de
"18 variantes de `<h1>`" descreveu mal o produto. Na tela, o JuridFlow tem
**três linguagens de cabeçalho**, e duas delas são deliberadas e boas:

| Tela | O que tem no topo, de verdade |
|---|---|
| Processos · Agenda | `<h1>` `text-pagina` + subtítulo + pastilhas |
| Acordos | `<h1>` `text-[22px]` |
| Tarefas | `<h1>` `text-xl` |
| Relatórios | `<h1>` `text-2xl` |
| **Clientes** | **hero branco**: selo "● CLIENTES", linha "Cadastro · histórico · documentos · financeiro", KPI grande "Clientes ativos 5", bloco "ATENÇÃO" com 3 mini-cards, marca d'água |
| **Financeiro** | **hero verde**: "PAINEL FINANCEIRO", intervalo de datas, 4 KPIs, tendência, marca d'água |
| **Dashboard · Atendimento** | **saudação**: "Bom dia, Dono", "Boa tarde, Dono! ☀️" |
| Kanban · Modelos | sem título de tela |

Consequências para a Fatia 2, que estava escrita sem saber disso:

1. **"Clientes e Financeiro não têm título" era falso na prática.** Não têm
   `<h1>`, mas têm hero com nome, subtítulo e números — melhores que o
   `PageHeader` que eu propus.
2. **A saudação do Dashboard e do Atendimento é decisão de produto.** Trocar
   por "Dashboard"/"Atendimento" seria **remoção**, e a regra do dono exige
   autorização expressa para isso.
3. **`/movimentacoes` renderiza a MESMA tela de Processos** (mesmo `<h1>`,
   mesmas 5 abas). Contar as duas como telas distintas infla qualquer
   número de "N telas".
4. `text-[22px]` segue vivo em Dashboard e Acordos — ficaram fora da Fatia 1,
   que cobriu só as 6 telas do dia a dia.

**Ou seja: o sistema está em estado melhor do que o meu diagnóstico dizia, e
a proposta "um cabeçalho para todas" pioraria pelo menos duas telas.** A
Fatia 2 precisa ser repensada a partir das fotos, não do grep.
