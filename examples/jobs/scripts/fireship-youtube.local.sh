#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${DOCVAULT_DATA_DIR:-/data}"
JOB_ID="${DOCVAULT_JOB_ID:-fireship-youtube-daily}"
# Fireship (Jeff Delaney) — fast-paced dev news, "X in 100 seconds" explainers,
# and AI/tooling commentary. Uploads only: the channel has no live streams, so
# there's no /streams tab worth a yt-dlp round trip each run.
SOURCE_URLS=(
  "https://www.youtube.com/@Fireship/videos"
)
DOMAIN="tech"
TAGS_JSON='["fireship","youtube","tech"]'
BASE_URL="${DOCVAULT_URL:-http://127.0.0.1:${DOCVAULT_PORT:-3005}}"
LIMIT="${DOCVAULT_JOB_LIMIT:-8}"
PLAYLIST_END="${DOCVAULT_PLAYLIST_END:-5}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="$DATA_DIR/jobs/output/tech-research/$JOB_ID/$STAMP"
LATEST_DIR="$DATA_DIR/jobs/output/tech-research/$JOB_ID/latest"
STATE_DIR="$DATA_DIR/jobs/state/$JOB_ID"
PROCESSED_URLS="$STATE_DIR/processed-source-urls.txt"
mkdir -p "$OUT_DIR" "$(dirname "$LATEST_DIR")" "$STATE_DIR"
touch "$PROCESSED_URLS"

command -v yt-dlp >/dev/null 2>&1 || { printf '[%s] ERROR: yt-dlp not found\n' "$JOB_ID" >&2; exit 127; }
CHANNEL_FILES=()
idx=0
for url in "${SOURCE_URLS[@]}"; do
  cf="$OUT_DIR/youtube-channel-$idx.json"
  printf '[%s] Fetching Fireship YouTube metadata from %s\n' "$JOB_ID" "$url"
  yt-dlp --ignore-errors --no-warnings --flat-playlist --playlist-end "$PLAYLIST_END" --dump-single-json "$url" > "$cf" || printf '{}' > "$cf"
  CHANNEL_FILES+=("$cf")
  idx=$((idx + 1))
done
CHANNELS_CSV="$(IFS=,; printf '%s' "${CHANNEL_FILES[*]}")"
printf '%s\n' "${SOURCE_URLS[@]}" > "$OUT_DIR/source-url.txt"

bun -e '
const fs = require("fs");
const [channelPathsRaw, storePath, processedPath, queuePath, limitRaw] = process.argv.slice(1);
const limit = Number(limitRaw || 5);
const norm = (s) => String(s || "").toLowerCase().replace(/\b(19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const seenUrls = new Set();
const seenTitles = new Set();
try { const store = JSON.parse(fs.readFileSync(storePath, "utf8")); for (const e of Object.values(store.entries || {})) { if (e?.sourceUrl) seenUrls.add(String(e.sourceUrl)); if (e?.title) seenTitles.add(norm(e.title)); } } catch {}
try { for (const line of fs.readFileSync(processedPath, "utf8").split(/\r?\n/)) if (line.trim()) seenUrls.add(line.trim()); } catch {}
const entries = [];
for (const cp of String(channelPathsRaw).split(",").filter(Boolean)) {
  try { const ch = JSON.parse(fs.readFileSync(cp, "utf8")); for (const e of ch.entries || []) entries.push(e); } catch {}
}
const rows = [];
for (const e of entries) {
  const id = e?.id || (String(e?.url || "").match(/[?&]v=([^&]+)/) || [])[1];
  if (!id) continue;
  const url = String(e?.url || "").startsWith("http") ? String(e.url) : `https://www.youtube.com/watch?v=${id}`;
  const title = e?.title || id;
  const titleKey = norm(title);
  if (seenUrls.has(url) || (titleKey && seenTitles.has(titleKey))) continue;
  rows.push([url, title]);
  seenUrls.add(url);
  if (titleKey) seenTitles.add(titleKey);
  if (rows.length >= limit) break;
}
fs.writeFileSync(queuePath, rows.map((r) => r.map((v) => String(v).replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n") + (rows.length ? "\n" : ""));
console.log(rows.length);
' "$CHANNELS_CSV" "$DATA_DIR/.docvault-research.json" "$PROCESSED_URLS" "$OUT_DIR/new-videos.tsv" "$LIMIT" > "$OUT_DIR/new-count.txt"

SUCCESS_COUNT=0
FAIL_COUNT=0
SKIPPED_COUNT=0
while IFS=$'\t' read -r VIDEO_URL TITLE; do
  [ -n "${VIDEO_URL:-}" ] || continue
  PAYLOAD="$OUT_DIR/payload-$SUCCESS_COUNT-$FAIL_COUNT-$SKIPPED_COUNT.json"
  RESPONSE="$OUT_DIR/response-$SUCCESS_COUNT-$FAIL_COUNT-$SKIPPED_COUNT.json"
  VIDEO_URL="$VIDEO_URL" DOMAIN="$DOMAIN" TAGS_JSON="$TAGS_JSON" bun -e 'process.stdout.write(JSON.stringify({ url: process.env.VIDEO_URL, domain: process.env.DOMAIN, tags: JSON.parse(process.env.TAGS_JSON || "[]") }))' > "$PAYLOAD"
  printf '[%s] Ingesting unseen YouTube video: %s\n' "$JOB_ID" "$VIDEO_URL"
  # Deliberately no -f: we need the error body, which carries yt-dlp's reason.
  HTTP_CODE="$(curl -sS -o "$RESPONSE" -w '%{http_code}' -X POST "$BASE_URL/api/research/youtube" -H 'Content-Type: application/json' --data-binary "@$PAYLOAD" || printf '000')"
  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    printf '%s\n' "$VIDEO_URL" >> "$PROCESSED_URLS"
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  elif grep -qiE "members.only|available to this channel|private video|video unavailable|age.restricted|removed by the uploader" "$RESPONSE" 2>/dev/null; then
    # Permanently inaccessible, not a blip. The candidate window is only the
    # newest few videos — left unseen, a members-only or removed upload would
    # occupy a slot and re-fail every single day. Record it as seen instead.
    printf '%s\n' "$VIDEO_URL" >> "$PROCESSED_URLS"
    printf '%s\t%s\n' "$VIDEO_URL" "$TITLE" >> "$OUT_DIR/skipped-inaccessible.tsv"
    SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
  else
    # Transient (network, 5xx, transcode hiccup) — leave unseen so it retries.
    printf '%s\t%s\n' "$VIDEO_URL" "$TITLE" >> "$OUT_DIR/failed-videos.tsv"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done < "$OUT_DIR/new-videos.tsv"

sort -u "$PROCESSED_URLS" -o "$PROCESSED_URLS"
rm -f "$LATEST_DIR"
ln -s "$OUT_DIR" "$LATEST_DIR"
printf '[%s] Wrote %s; candidates=%s ingested=%s skipped=%s failed=%s\n' "$JOB_ID" "$OUT_DIR" "$(cat "$OUT_DIR/new-count.txt")" "$SUCCESS_COUNT" "$SKIPPED_COUNT" "$FAIL_COUNT"
