# Dev server for local docker-compose use.
# glibc base, not alpine/musl: native modules without musl prebuilds
# (e.g. RuVector — see M10a evidence) fail closed on alpine.
FROM node:24-slim

# Native Node modules such as better-sqlite3 may need to compile from source.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
# M17d browser tool: Chromium + its system libraries for Playwright.
RUN npx playwright install --with-deps chromium
COPY . .
RUN npm run build

# NestJS API port
EXPOSE 3000

# Run the compiled app as PID 1 so SIGTERM/SIGINT reach Nest and its shutdown
# hooks run (graceful shutdown + the M16m offline announcement). The Nest dev
# watcher (`nest start --watch`) runs the app in a child process and swallows
# the signal, so graceful shutdown does not run in that mode. For hot reload,
# set CORE_COMMAND="npm run start:dev" (docker-compose interpolates it).
CMD ["node", "dist/main"]
