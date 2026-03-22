# Stage 1: Install dependencies (shared across build and runtime)
FROM oven/bun:1-slim AS deps

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

# Stage 2: Build frontend
FROM oven/bun:1 AS build

WORKDIR /app

# Copy production deps, then install dev deps on top
COPY package.json bun.lock ./
COPY --from=deps /app/node_modules ./node_modules
RUN bun install --frozen-lockfile

# Copy source and build frontend
COPY tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY vite.config.ts ./
COPY index.html ./
COPY public/ ./public/
COPY src/ ./src/

RUN ./node_modules/vite-plus/bin/vp build

# Stage 3: Production runtime
FROM oven/bun:1-slim

WORKDIR /app

# Copy production deps from stage 1
COPY package.json bun.lock ./
COPY --from=deps /app/node_modules ./node_modules

# Copy server source (Bun runs TypeScript directly)
COPY server/ ./server/

# Copy built frontend from stage 2
COPY --from=build /app/dist ./dist

# Default data directory
RUN mkdir -p /data

ENV DOCVAULT_DATA_DIR=/data

EXPOSE 3005

CMD ["bun", "run", "server/index.ts"]
