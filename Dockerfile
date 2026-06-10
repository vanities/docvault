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
COPY tsconfig.json tsconfig.app.json tsconfig.node.json tsconfig.server.json ./
COPY vite.config.ts ./
COPY index.html ./
COPY public/ ./public/
COPY src/ ./src/

RUN ./node_modules/vite-plus/bin/vp build

# Stage 3: Production runtime
FROM oven/bun:1-slim

# Install git (clone/pull External Sources repos), rclone (Dropbox sync), curl
# (used by the entrypoint script to fall back to a fresh yt-dlp binary download
# when self-update fails), poppler-utils (pdftotext + pdftoppm, for parsing and
# rasterizing House/Senate PTR and OGE-278-T disclosure PDFs), tesseract-ocr
# (OCR fallback for scanned/paper filings), ffmpeg (extract audio from uploaded
# research video/audio for background transcription), and ca-certificates (TLS).
RUN apt-get update && apt-get install -y --no-install-recommends git rclone curl poppler-utils tesseract-ocr ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*

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

# Install the codex CLI (provides `codex app-server`, driven by the Codex chat
# backend — server/llm/codex-app-server.ts). Arch-specific static musl binary
# from the codex release, mirroring the yt-dlp install above. The tarball
# extracts to a triple-named binary which we rename to `codex` on PATH.
ARG CODEX_VERSION=0.136.0
RUN case "$TARGETARCH" in \
      amd64)  CODEX_TRIPLE=x86_64-unknown-linux-musl ;; \
      arm64)  CODEX_TRIPLE=aarch64-unknown-linux-musl ;; \
      *)      echo "Unsupported arch: $TARGETARCH" && exit 1 ;; \
    esac && \
    curl -fsSL "https://github.com/openai/codex/releases/download/rust-v${CODEX_VERSION}/codex-${CODEX_TRIPLE}.tar.gz" -o /tmp/codex.tar.gz && \
    tar -xzf /tmp/codex.tar.gz -C /tmp && \
    mv "/tmp/codex-${CODEX_TRIPLE}" /usr/local/bin/codex && \
    rm /tmp/codex.tar.gz && \
    chmod +x /usr/local/bin/codex && \
    /usr/local/bin/codex --version

WORKDIR /app

# Copy production deps from stage 1
COPY package.json bun.lock ./
COPY --from=deps /app/node_modules ./node_modules

# Copy server source (Bun runs TypeScript directly)
COPY server/ ./server/

# Copy scripts (sync-to-dropbox.sh, etc.)
COPY scripts/ ./scripts/

# Copy bundled example custom jobs — seeded (disabled) into the data dir on
# boot by server/seed-example-jobs.ts. Without this the seeder finds nothing.
COPY examples/ ./examples/

# Copy built frontend from stage 2
COPY --from=build /app/dist ./dist

# Default data directory
RUN mkdir -p /data

ENV DOCVAULT_DATA_DIR=/data
ENV RCLONE_CONFIG=/data/.rclone.conf
# Codex auth (auth.json from `codex login`) + config live here, in the data
# volume so they persist across container restarts. The Codex chat backend
# reads CODEX_HOME via getCodexChatConfig().
ENV CODEX_HOME=/data/.codex

EXPOSE 3005

# Entrypoint script: best-effort yt-dlp self-update, then execs the Bun
# server. See scripts/docker-entrypoint.sh.
RUN chmod +x scripts/docker-entrypoint.sh

CMD ["scripts/docker-entrypoint.sh"]
