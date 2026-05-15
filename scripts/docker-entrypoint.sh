#!/bin/sh
# DocVault container entrypoint.
#
# Best-effort: pull the latest yt-dlp on every container start so the
# YouTube research-ingest endpoint keeps pace with YouTube's backend
# changes (which break older yt-dlp versions reliably). If the update
# fails (no network, GitHub down, rate limit), keep going — the bundled
# version probably still works.
#
# Then exec the Bun server as the foreground process so signals
# propagate correctly.

update_ytdlp() {
  if ! command -v yt-dlp >/dev/null 2>&1; then
    echo "[entrypoint] yt-dlp not installed; skipping update"
    return 0
  fi

  # First try yt-dlp's built-in self-update. Works for the standalone
  # binary when the user has write access to its install location
  # (root inside the container does).
  if yt-dlp -U 2>&1 | sed 's/^/[entrypoint] yt-dlp -U: /' | head -3; then
    if yt-dlp --version >/dev/null 2>&1; then
      return 0
    fi
  fi

  # Fallback: re-download the latest binary for our arch. Some YouTube
  # backend changes need a full binary swap rather than the diff-patch
  # that `yt-dlp -U` applies.
  case "$(uname -m)" in
    x86_64)  YT_DLP_BIN=yt-dlp_linux ;;
    aarch64) YT_DLP_BIN=yt-dlp_linux_aarch64 ;;
    *) echo "[entrypoint] unsupported arch $(uname -m); leaving yt-dlp as-is"
       return 0 ;;
  esac

  if curl -fsSL --max-time 30 "https://github.com/yt-dlp/yt-dlp/releases/latest/download/$YT_DLP_BIN" -o /tmp/yt-dlp.new; then
    chmod +x /tmp/yt-dlp.new
    mv /tmp/yt-dlp.new /usr/local/bin/yt-dlp
    echo "[entrypoint] yt-dlp updated by direct download"
  else
    echo "[entrypoint] yt-dlp self-update + redownload both failed; using existing version"
  fi
}

update_ytdlp 2>&1 || echo "[entrypoint] update path errored; continuing"
echo "[entrypoint] yt-dlp version: $(yt-dlp --version 2>/dev/null || echo unknown)"

exec bun run server/index.ts
