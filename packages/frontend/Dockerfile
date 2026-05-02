FROM node:20-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml* ./
COPY packages/frontend/package.json ./packages/frontend/
RUN pnpm install --frozen-lockfile
COPY packages/frontend ./packages/frontend
COPY tsconfig.base.json ./
RUN pnpm --filter frontend build

FROM nginx:alpine
COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html
COPY packages/frontend/nginx.conf /etc/nginx/conf.d/default.conf
