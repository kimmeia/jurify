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
#    O binário do Chromium em si é baixado SEMPRE no build step abaixo
#    (sem gate de ambiente — env vars de runtime não estão disponíveis
#    em build time, então gate condicional não funciona aqui).
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
# invalidar quando código de aplicação muda. `patches/` precisa vir
# junto porque pnpm aplica patches de `patchedDependencies` durante
# o install — sem o arquivo de patch, falha com ENOENT.
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches

# Instala deps com --ignore-scripts pra controlar quando o postinstall
# do Playwright roda. Sem isso, postinstall tentaria baixar Chromium
# durante a fase de cache de deps — caso JURIFY_AMBIENTE esteja
# definido, o download invalidaria a layer toda mesmo só pra mudança
# trivial de código.
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .

# Chromium do Playwright — motor próprio (PoC 1) precisa em runtime.
# Instalamos SEMPRE, sem gate. Por quê:
#  • Build time não recebe env vars de runtime (JURIFY_AMBIENTE só existe
#    quando o container já está rodando), então um gate condicional aqui
#    NÃO funciona — rejeitaria sempre, mesmo em staging.
#  • Em production o `exigirAmbienteTeste()` no router bloqueia execução
#    do Playwright, então o binário fica baixado mas nunca é invocado —
#    custo é só ~280MB extras na imagem.
#  • Quando motor próprio sair pra worker dedicado (Sprint 1+), o
#    Dockerfile da app principal volta a ser slim.
#
# `--with-deps` desnecessário porque as libs do sistema (libnss3, etc.)
# já foram instaladas via apt acima.
RUN pnpm exec playwright install chromium

# Build: Vite (client estático em dist/public/) + esbuild (server em
# dist/index.js).
RUN pnpm build

ENV NODE_ENV=production

# Railway define PORT em runtime; defaultamos pra 3000 pra rodar local.
EXPOSE 3000

CMD ["node", "dist/index.js"]
