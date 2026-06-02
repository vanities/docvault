#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${DOCVAULT_DATA_DIR:-/data}"
JOB_ID="${DOCVAULT_JOB_ID:-benjamin-cowen-reports-daily}"
SOURCE_URL="https://benjamincowen.com/reports"
DOMAIN="finance"
AUTHOR="Benjamin Cowen"
PUBLISHER="Benjamin Cowen"
TAGS_JSON='["benjamin-cowen","reports","pdf","macro","finance"]'
BASE_URL="${DOCVAULT_URL:-http://127.0.0.1:${DOCVAULT_PORT:-3005}}"
LIMIT="${DOCVAULT_JOB_LIMIT:-5}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="$DATA_DIR/jobs/output/finance-research/$JOB_ID/$STAMP"
LATEST_DIR="$DATA_DIR/jobs/output/finance-research/$JOB_ID/latest"
STATE_DIR="$DATA_DIR/jobs/state/$JOB_ID"
PROCESSED_URLS="$STATE_DIR/processed-source-urls.txt"
mkdir -p "$OUT_DIR" "$(dirname "$LATEST_DIR")" "$STATE_DIR"
touch "$PROCESSED_URLS"

printf '[%s] Fetching Benjamin Cowen reports index from %s\n' "$JOB_ID" "$SOURCE_URL"
curl -fsSL "$SOURCE_URL" -o "$OUT_DIR/reports.html"

bun -e '
const fs = require("fs");
const [htmlPath, linksPath] = process.argv.slice(1);
const html = fs.readFileSync(htmlPath, "utf8");
const decode = (s) => String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, String.fromCharCode(39)).replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const out = [];
const seen = new Set();
for (const m of html.matchAll(new RegExp("href=[\\\"\\x27]([^\\\"\\x27]*/reports/[^\\\"\\x27]+)[\\\"\\x27]", "gi"))) {
  let href = decode(m[1]);
  if (href.includes(".pdf")) continue;
  if (href.startsWith("/")) href = new URL(href, "https://benjamincowen.com").toString();
  if (!href.startsWith("http")) continue;
  try { const u = new URL(href); u.hash = ""; href = u.toString().replace(/\/$/, ""); } catch {}
  if (!seen.has(href)) { seen.add(href); out.push(href); }
}
fs.writeFileSync(linksPath, out.join("\n") + (out.length ? "\n" : ""));
' "$OUT_DIR/reports.html" "$OUT_DIR/report-links.txt"

bun -e '
const fs = require("fs");
const [linksPath, storePath, processedPath, queuePath, limitRaw] = process.argv.slice(1);
const limit = Number(limitRaw || 5);
const canonical = (u) => { try { const x = new URL(String(u)); x.hash = ""; return x.toString().replace(/\/$/, ""); } catch { return String(u || ""); } };
const seen = new Set();
try { const store = JSON.parse(fs.readFileSync(storePath, "utf8")); for (const e of Object.values(store.entries || {})) if (e?.sourceUrl) seen.add(canonical(e.sourceUrl)); } catch {}
try { for (const line of fs.readFileSync(processedPath, "utf8").split(/\r?\n/)) if (line.trim()) seen.add(canonical(line.trim())); } catch {}
const links = fs.readFileSync(linksPath, "utf8").split(/\r?\n/).map((s) => canonical(s.trim())).filter(Boolean);
const rows = links.slice(0, limit).filter((u) => !seen.has(u));
fs.writeFileSync(queuePath, rows.join("\n") + (rows.length ? "\n" : ""));
console.log(rows.length);
' "$OUT_DIR/report-links.txt" "$DATA_DIR/.docvault-research.json" "$PROCESSED_URLS" "$OUT_DIR/new-report-links.txt" "$LIMIT" > "$OUT_DIR/new-count.txt"

SUCCESS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
while IFS= read -r REPORT_URL; do
  [ -n "${REPORT_URL:-}" ] || continue
  SAFE_NAME="$(printf '%s' "$REPORT_URL" | tr -c 'A-Za-z0-9._-' '_' | cut -c1-120)"
  HTML="$OUT_DIR/report-$SAFE_NAME.html"
  INFO_JSON="$OUT_DIR/info-$SAFE_NAME.json"
  PDF="$OUT_DIR/report-$SAFE_NAME.pdf"
  UPLOAD_RESPONSE="$OUT_DIR/upload-response-$SAFE_NAME.json"
  PATCH_PAYLOAD="$OUT_DIR/patch-$SAFE_NAME.json"
  PATCH_RESPONSE="$OUT_DIR/patch-response-$SAFE_NAME.json"

  if ! curl -fsSL "$REPORT_URL" -o "$HTML"; then
    printf '[%s] ERROR report page fetch failed: %s\n' "$JOB_ID" "$REPORT_URL" >&2
    printf '%s\treport-fetch-failed\n' "$REPORT_URL" >> "$OUT_DIR/failed-report-links.tsv"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    continue
  fi

  REPORT_URL="$REPORT_URL" HTML="$HTML" INFO_JSON="$INFO_JSON" bun -e '
const fs = require("fs");
const decodeHtml = (s) => String(s || "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, String.fromCharCode(39)).replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const html = fs.readFileSync(process.env.HTML, "utf8");
const decoded = decodeHtml(html);
const candidates = new Set();
for (const src of [html, decoded, (() => { try { return decodeURIComponent(decoded); } catch { return decoded; } })()]) {
  for (const m of src.matchAll(new RegExp("https?:[^\\s\\\"<>]+\\.pdf(?:\\?[^\\s\\\"<>]*)?", "gi"))) candidates.add(m[0].replace(/\\u002F/g, "/"));
}
for (const u of [...candidates]) {
  try { const x = new URL(u); const nested = x.hostname.includes("docs.google.com") ? x.searchParams.get("url") : null; if (nested) candidates.add(nested); } catch {}
}
const pdfUrl = [...candidates].find((u) => { try { const x = new URL(u); return !x.hostname.includes("docs.google.com") && x.pathname.toLowerCase().endsWith(".pdf"); } catch { return false; } }) || "";
const title = decodeHtml((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || process.env.REPORT_URL).replace(/\s+/g, " ").replace(/\s*\|\s*Research Reports\s*\|\s*Benjamin Cowen\s*$/i, "").trim();
let filename = "report.pdf";
try { filename = decodeURIComponent(new URL(pdfUrl).pathname.split("/").pop() || filename); } catch {}
fs.writeFileSync(process.env.INFO_JSON, JSON.stringify({ pdfUrl, title, filename, reportUrl: process.env.REPORT_URL }, null, 2));
'

  PDF_URL="$(INFO_JSON="$INFO_JSON" bun -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync(process.env.INFO_JSON,"utf8")); process.stdout.write(j.pdfUrl || "");')"
  if [ -z "$PDF_URL" ]; then
    printf '[%s] SKIP no PDF URL found for %s\n' "$JOB_ID" "$REPORT_URL"
    printf '%s\tno-pdf-url\n' "$REPORT_URL" >> "$OUT_DIR/skipped-report-links.tsv"
    printf '%s\n' "$REPORT_URL" >> "$PROCESSED_URLS"
    SKIP_COUNT=$((SKIP_COUNT + 1))
    continue
  fi

  if ! curl -fsSL "$PDF_URL" -o "$PDF"; then
    printf '[%s] ERROR PDF download failed for %s from %s\n' "$JOB_ID" "$REPORT_URL" "$PDF_URL" >&2
    printf '%s\t%s\tpdf-download-failed\n' "$REPORT_URL" "$PDF_URL" >> "$OUT_DIR/failed-report-links.tsv"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    continue
  fi
  if ! head -c 5 "$PDF" | grep -q '%PDF-'; then
    printf '[%s] ERROR downloaded file is not a PDF for %s from %s\n' "$JOB_ID" "$REPORT_URL" "$PDF_URL" >&2
    printf '%s\t%s\tnot-pdf\n' "$REPORT_URL" "$PDF_URL" >> "$OUT_DIR/failed-report-links.tsv"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    continue
  fi

  ENCODED_FILENAME="$(INFO_JSON="$INFO_JSON" bun -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync(process.env.INFO_JSON,"utf8")); process.stdout.write(encodeURIComponent(j.filename || "report.pdf"));')"
  ENCODED_TITLE="$(INFO_JSON="$INFO_JSON" bun -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync(process.env.INFO_JSON,"utf8")); process.stdout.write(encodeURIComponent(j.title || j.filename || "Benjamin Cowen report"));')"

  printf '[%s] Uploading PDF report: %s -> %s\n' "$JOB_ID" "$REPORT_URL" "$PDF_URL"
  if ! curl -fsS -X POST "$BASE_URL/api/research/upload?domain=$DOMAIN&filename=$ENCODED_FILENAME&title=$ENCODED_TITLE" -H 'Content-Type: application/pdf' --data-binary "@$PDF" -o "$UPLOAD_RESPONSE"; then
    printf '[%s] ERROR PDF upload failed for %s\n' "$JOB_ID" "$REPORT_URL" >&2
    printf '%s\t%s\tupload-failed\n' "$REPORT_URL" "$PDF_URL" >> "$OUT_DIR/failed-report-links.tsv"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    continue
  fi

  ENTRY_ID="$(UPLOAD_RESPONSE="$UPLOAD_RESPONSE" bun -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync(process.env.UPLOAD_RESPONSE,"utf8")); process.stdout.write(j?.entry?.id || "");')"
  if [ -z "$ENTRY_ID" ]; then
    printf '[%s] ERROR upload response missing entry id for %s\n' "$JOB_ID" "$REPORT_URL" >&2
    printf '%s\t%s\tmissing-entry-id\n' "$REPORT_URL" "$PDF_URL" >> "$OUT_DIR/failed-report-links.tsv"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    continue
  fi

  INFO_JSON="$INFO_JSON" AUTHOR="$AUTHOR" PUBLISHER="$PUBLISHER" TAGS_JSON="$TAGS_JSON" bun -e '
const fs=require("fs"); const info=JSON.parse(fs.readFileSync(process.env.INFO_JSON,"utf8"));
process.stdout.write(JSON.stringify({ title: info.title, author: process.env.AUTHOR, publisher: process.env.PUBLISHER, sourceUrl: info.reportUrl, tags: JSON.parse(process.env.TAGS_JSON || "[]") }));
' > "$PATCH_PAYLOAD"
  if ! curl -fsS -X PATCH "$BASE_URL/api/research/$ENTRY_ID" -H 'Content-Type: application/json' --data-binary "@$PATCH_PAYLOAD" -o "$PATCH_RESPONSE"; then
    printf '[%s] ERROR metadata patch failed for entry %s (%s)\n' "$JOB_ID" "$ENTRY_ID" "$REPORT_URL" >&2
    printf '%s\t%s\tpatch-failed\n' "$REPORT_URL" "$PDF_URL" >> "$OUT_DIR/failed-report-links.tsv"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    continue
  fi

  printf '%s\n%s\n' "$REPORT_URL" "$PDF_URL" >> "$PROCESSED_URLS"
  SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
done < "$OUT_DIR/new-report-links.txt"

sort -u "$PROCESSED_URLS" -o "$PROCESSED_URLS"
rm -f "$LATEST_DIR"
ln -s "$OUT_DIR" "$LATEST_DIR"
printf '[%s] Wrote %s; discovered=%s candidates=%s uploaded_pdfs=%s skipped=%s failed=%s\n' "$JOB_ID" "$OUT_DIR" "$(wc -l < "$OUT_DIR/report-links.txt" | tr -d ' ')" "$(cat "$OUT_DIR/new-count.txt")" "$SUCCESS_COUNT" "$SKIP_COUNT" "$FAIL_COUNT"
