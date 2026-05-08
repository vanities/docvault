#!/usr/bin/env bash
# save-analysis.sh — POST an analysis payload to DocVault's /api/health-analysis.
#
# Usage:
#   bash scripts/save-analysis.sh /path/to/payload.json
#
# Configuration:
#   DOCVAULT_URL — base URL for the DocVault API (default http://localhost:3005)
#
# The payload must be a single JSON object with fields:
#   title, body (markdown), personId, signals (object), tags (array), author

set -euo pipefail

NAS_URL="${DOCVAULT_URL:-http://localhost:3005}"
PAYLOAD="${1:?path to payload JSON required}"
if [[ ! -f "$PAYLOAD" ]]; then
  echo "[save-analysis] payload not found: $PAYLOAD" >&2
  exit 1
fi

RESPONSE=$(curl -fsS -X POST "${NAS_URL}/api/health-analysis" \
  -H "Content-Type: application/json" \
  -d @"$PAYLOAD")

# Echo entry id on success, or the full response on failure.
echo "$RESPONSE" | node -e "
const r = JSON.parse(require('fs').readFileSync(0, 'utf8'));
if (r.ok && r.entry && r.entry.id) {
  console.log(r.entry.id);
  process.exit(0);
} else {
  console.error('[save-analysis] POST failed:', JSON.stringify(r));
  process.exit(1);
}
"
