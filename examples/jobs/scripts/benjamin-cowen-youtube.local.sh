#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${DOCVAULT_DATA_DIR:-/data}"
JOB_ID="${DOCVAULT_JOB_ID:-benjamin-cowen-youtube-daily}"
SOURCE_URL="https://www.youtube.com/channel/UCRvqjQPSeaWn-uEx-w0XOIg/videos"
DOMAIN="finance"
TAGS_JSON='["benjamin-cowen","youtube","macro","finance"]'
BASE_URL="${DOCVAULT_URL:-http://127.0.0.1:${DOCVAULT_PORT:-3005}}"
LIMIT="${DOCVAULT_JOB_LIMIT:-5}"
PLAYLIST_END="${DOCVAULT_PLAYLIST_END:-5}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="$DATA_DIR/jobs/output/finance-research/$JOB_ID/$STAMP"
LATEST_DIR="$DATA_DIR/jobs/output/finance-research/$JOB_ID/latest"
STATE_DIR="$DATA_DIR/jobs/state/$JOB_ID"
PROCESSED_URLS="$STATE_DIR/processed-source-urls.txt"
mkdir -p "$OUT_DIR" "$(dirname "$LATEST_DIR")" "$STATE_DIR"
touch "$PROCESSED_URLS"

printf '[%s] Fetching Benjamin Cowen YouTube metadata from %s\n' "$JOB_ID" "$SOURCE_URL"
command -v yt-dlp >/dev/null 2>&1 || { printf '[%s] ERROR: yt-dlp not found\n' "$JOB_ID" >&2; exit 127; }
yt-dlp --ignore-errors --no-warnings --flat-playlist --playlist-end "$PLAYLIST_END" --dump-single-json "$SOURCE_URL" > "$OUT_DIR/youtube-channel.json"
printf '%s\n' "$SOURCE_URL" > "$OUT_DIR/source-url.txt"

bun -e '
const fs = require("fs");
const [channelPath, storePath, processedPath, queuePath, limitRaw] = process.argv.slice(1);
const limit = Number(limitRaw || 5);
const norm = (s) => String(s || "").toLowerCase().replace(/\b(19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const seenUrls = new Set();
const seenTitles = new Set();
try { const store = JSON.parse(fs.readFileSync(storePath, "utf8")); for (const e of Object.values(store.entries || {})) { if (e?.sourceUrl) seenUrls.add(String(e.sourceUrl)); if (e?.title) seenTitles.add(norm(e.title)); } } catch {}
try { for (const line of fs.readFileSync(processedPath, "utf8").split(/\r?\n/)) if (line.trim()) seenUrls.add(line.trim()); } catch {}
const channel = JSON.parse(fs.readFileSync(channelPath, "utf8"));
const rows = [];
for (const e of channel.entries || []) {
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
' "$OUT_DIR/youtube-channel.json" "$DATA_DIR/.docvault-research.json" "$PROCESSED_URLS" "$OUT_DIR/new-videos.tsv" "$LIMIT" > "$OUT_DIR/new-count.txt"

SUCCESS_COUNT=0
FAIL_COUNT=0
while IFS=$'\t' read -r VIDEO_URL TITLE; do
  [ -n "${VIDEO_URL:-}" ] || continue
  PAYLOAD="$OUT_DIR/payload-$SUCCESS_COUNT-$FAIL_COUNT.json"
  RESPONSE="$OUT_DIR/response-$SUCCESS_COUNT-$FAIL_COUNT.json"
  VIDEO_URL="$VIDEO_URL" DOMAIN="$DOMAIN" TAGS_JSON="$TAGS_JSON" bun -e 'process.stdout.write(JSON.stringify({ url: process.env.VIDEO_URL, domain: process.env.DOMAIN, tags: JSON.parse(process.env.TAGS_JSON || "[]") }))' > "$PAYLOAD"
  printf '[%s] Ingesting unseen YouTube video: %s\n' "$JOB_ID" "$VIDEO_URL"
  if curl -fsS -X POST "$BASE_URL/api/research/youtube" -H 'Content-Type: application/json' --data-binary "@$PAYLOAD" -o "$RESPONSE"; then
    printf '%s\n' "$VIDEO_URL" >> "$PROCESSED_URLS"
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  else
    printf '%s\t%s\n' "$VIDEO_URL" "$TITLE" >> "$OUT_DIR/failed-videos.tsv"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done < "$OUT_DIR/new-videos.tsv"

sort -u "$PROCESSED_URLS" -o "$PROCESSED_URLS"
rm -f "$LATEST_DIR"
ln -s "$OUT_DIR" "$LATEST_DIR"
printf '[%s] Wrote %s; candidates=%s ingested=%s failed=%s\n' "$JOB_ID" "$OUT_DIR" "$(cat "$OUT_DIR/new-count.txt")" "$SUCCESS_COUNT" "$FAIL_COUNT"
