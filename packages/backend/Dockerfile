FROM node:20-alpine
WORKDIR /app
RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml* ./
COPY packages/core/package.json ./packages/core/
COPY packages/backend/package.json ./packages/backend/
RUN pnpm install --frozen-lockfile
COPY packages/core ./packages/core
COPY packages/backend ./packages/backend
COPY tsconfig.base.json ./
RUN pnpm --filter core build
RUN pnpm --filter backend build
WORKDIR /app/packages/backend
CMD ["node", "dist/index.js"]
