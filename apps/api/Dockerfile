FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@9.15.9
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY prisma prisma
RUN pnpm install --frozen-lockfile
COPY apps/api apps/api
COPY packages/contracts packages/contracts
RUN pnpm run db:generate && pnpm --filter @knockout/api build
ENV HOST=0.0.0.0 PORT=3000
WORKDIR /app/apps/api
USER node
EXPOSE 3000
CMD ["node", "dist/apps/api/src/server.js"]