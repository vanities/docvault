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
RUN bun install --frozen-lockfile --ignore-scripts

# Copy source and build frontend
COPY tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY vite.config.ts ./
COPY index.html ./
COPY public/ ./public/
COPY src/ ./src/

RUN ./node_modules/vite-plus/bin/vp build

# Stage 3: Production runtime
FROM oven/bun:1-slim

# Install rclone (Dropbox sync), curl (used by the entrypoint script to
# fall back to a fresh yt-dlp binary download when self-update fails),
# and ca-certificates (TLS for both).
RUN apt-get update && apt-get install -y --no-install-recommends rclone curl ca-certificates && rm -rf /var/lib/apt/lists/*

# Install yt-dlp standalone binary, arch-specific. Used by the YouTube
# research-ingest endpoint to fetch captions + metadata. The entrypoint
# script attempts to self-update it on each container start so it keeps
# pace with YouTube's frequent backend changes.
ARG TARGETARCH
RUN case "$TARGETARCH" in \
      amd64)  YT_DLP_BIN=yt-dlp_linux ;; \
      arm64)  YT_DLP_BIN=yt-dlp_linux_aarch64 ;; \
      *)      echo "Unsupported arch: $TARGETARCH" && exit 1 ;; \
    esac && \
    curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/$YT_DLP_BIN" -o /usr/local/bin/yt-dlp && \
    chmod +x /usr/local/bin/yt-dlp && \
    /usr/local/bin/yt-dlp --version

WORKDIR /app

# Copy production deps from stage 1
COPY package.json bun.lock ./
COPY --from=deps /app/node_modules ./node_modules

# Copy server source (Bun runs TypeScript directly)
COPY server/ ./server/

# Copy scripts (sync-to-dropbox.sh, etc.)
COPY scripts/ ./scripts/

# Copy built frontend from stage 2
COPY --from=build /app/dist ./dist

# Default data directory
RUN mkdir -p /data

ENV DOCVAULT_DATA_DIR=/data
ENV RCLONE_CONFIG=/data/.rclone.conf

EXPOSE 3005

# Entrypoint script: best-effort yt-dlp self-update, then execs the Bun
# server. See scripts/docker-entrypoint.sh.
RUN chmod +x scripts/docker-entrypoint.sh

CMD ["scripts/docker-entrypoint.sh"]
