#!/usr/bin/env bash
# fetch-all.sh — one-shot data pull for /health-analysis.
#
# Pulls the consolidated snapshot (markdown + JSON) plus all five
# per-segment endpoints (body, workouts, heart, sleep, activity) into
# /tmp on the local machine. Prints personId and file sizes to stderr.
#
# Usage:
#   bash scripts/fetch-all.sh
#
# Configuration:
#   DOCVAULT_URL  — base URL for the DocVault API
#                   (default http://localhost:3005)
#
# Output files (local /tmp):
#   snapshot.md           human-readable consolidated view
#   snapshot.json         full JSON with clinical + dna
#   seg-body.json
#   seg-workouts.json
#   seg-heart.json
#   seg-sleep.json
#   seg-activity.json
#   person-id.txt         single line, the personId (e.g. person-xxxxxx)

set -euo pipefail

NAS_URL="${DOCVAULT_URL:-http://localhost:3005}"

echo "[fetch-all] pulling snapshot (md + json)..." >&2
curl -fsS "${NAS_URL}/api/health-snapshot?format=md" > /tmp/snapshot.md
curl -fsS "${NAS_URL}/api/health-snapshot?format=json&includeClinical=true" > /tmp/snapshot.json

PERSON_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/snapshot.json','utf8')).people[0].id)")
echo "$PERSON_ID" > /tmp/person-id.txt
echo "[fetch-all] personId: $PERSON_ID" >&2

echo "[fetch-all] pulling all five segments in parallel..." >&2
curl -fsS "${NAS_URL}/api/health/${PERSON_ID}/snapshot/body"     > /tmp/seg-body.json     &
curl -fsS "${NAS_URL}/api/health/${PERSON_ID}/snapshot/workouts" > /tmp/seg-workouts.json &
curl -fsS "${NAS_URL}/api/health/${PERSON_ID}/snapshot/heart"    > /tmp/seg-heart.json    &
curl -fsS "${NAS_URL}/api/health/${PERSON_ID}/snapshot/sleep"    > /tmp/seg-sleep.json    &
curl -fsS "${NAS_URL}/api/health/${PERSON_ID}/snapshot/activity" > /tmp/seg-activity.json &
wait

echo "[fetch-all] sizes:" >&2
wc -c /tmp/snapshot.md /tmp/snapshot.json /tmp/seg-*.json >&2
echo "[fetch-all] done. personId in /tmp/person-id.txt" >&2
