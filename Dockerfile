# Dockerfile — substitui o Nixpacks como builder do Railway.
#
# Por que Dockerfile e não nixpacks.toml:
#  • Tentativas anteriores de instalar mysql-client via aptPkgs ou nixPkgs
#    não persistiram no runtime do Railway (binário ENOENT). PATH do
#    container produzido pelo Nixpacks/mise não inclui /nix/store nem
#    /usr/bin onde apt teria colocado os pacotes — provavelmente um
#    artefato da forma como o Nixpacks atual no Railway monta o stage
#    final. Dockerfile dá controle 100% sobre o filesystem do runtime.
#  • Quando este arquivo existe, Railway prefere Docker e ignora
#    nixpacks.toml automaticamente.
#
# Estratégia de tamanho:
#  Single-stage (sem multi-stage) porque o Vite/esbuild precisa de
#  devDependencies pra build, e separar runtime exigiria reinstalar deps
#  só pra prod — economia de imagem não vale a complexidade aqui.
#  Imagem final ~600MB; aceitável pra app que roda 24/7.

FROM node:22-slim

# Pacotes do sistema:
#  • mariadb-client → fornece `mysqldump` pro backup global (admin UI +
#    cron diário). MariaDB client é compatível com MySQL 8.0 (mesmo
#    dialeto de dump).
#  • ca-certificates → TLS pras chamadas saintes (Asaas, Cal.com,
#    OpenAI, Anthropic, Sentry).
#  • libs do Chromium → Playwright headless do motor próprio (PoC 1).
#    Essas libs precisam estar em /usr/lib pro dlopen do Chromium achar.
#    O binário do Chromium em si é baixado pelo postinstall do
#    Playwright (gate por JURIFY_AMBIENTE em
#    scripts/maybe-install-playwright.js — só baixa em staging).
RUN apt-get update && apt-get install -y --no-install-recommends \
    mariadb-client \
    ca-certificates \
    libnss3 \
    libnspr4 \
    libdbus-1-3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libxcb1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libatspi2.0-0 \
    libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Habilita pnpm via corepack — versão exata vem do `packageManager` no
# package.json (não precisa pinar aqui).
RUN corepack enable

# Layer caching: copia manifests primeiro pra dependency layer não
# invalidar quando código de aplicação muda.
COPY package.json pnpm-lock.yaml ./

# Instala deps com --ignore-scripts pra controlar quando o postinstall
# do Playwright roda. Sem isso, postinstall tentaria baixar Chromium
# durante a fase de cache de deps — caso JURIFY_AMBIENTE esteja
# definido, o download invalidaria a layer toda mesmo só pra mudança
# trivial de código.
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copia código e roda postinstall manualmente (já com tudo no lugar).
# JURIFY_AMBIENTE vem dos build args do Railway quando configurado;
# se não vier, postinstall sai silencioso (gate na própria função).
COPY . .

# Postinstall do Playwright — cliente de motor próprio. Falha não-fatal
# (script é robusto a erro de rede, sai 0 mesmo se download falhar).
RUN node scripts/maybe-install-playwright.js || true

# Build: Vite (client estático em dist/public/) + esbuild (server em
# dist/index.js).
RUN pnpm build

ENV NODE_ENV=production

# Railway define PORT em runtime; defaultamos pra 3000 pra rodar local.
EXPOSE 3000

CMD ["node", "dist/index.js"]
