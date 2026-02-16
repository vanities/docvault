# Stage 1: Build frontend
FROM oven/bun:1 AS build

WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source and build frontend
COPY tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY vite.config.ts ./
COPY index.html ./
COPY public/ ./public/
COPY src/ ./src/
COPY server/ ./server/

# Run only vite build (tsc is for dev-time checking, Bun runs TS directly)
RUN bunx vite build

# Stage 2: Production runtime
FROM oven/bun:1-slim

WORKDIR /app

# Install production dependencies only (--ignore-scripts skips husky prepare)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

# Copy server source (Bun runs TypeScript directly)
COPY server/ ./server/

# Copy built frontend from stage 1
COPY --from=build /app/dist ./dist

# Default data directory
RUN mkdir -p /data

ENV DOCVAULT_DATA_DIR=/data

EXPOSE 3005

CMD ["bun", "run", "server/index.ts"]
