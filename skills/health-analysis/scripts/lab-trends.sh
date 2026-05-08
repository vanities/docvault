#!/usr/bin/env bash
# lab-trends.sh — extract multi-year lab trends from raw FHIR observations.
#
# The snapshot API only exposes latest values for labs. This script reads
# the raw FHIR Observation JSON from the configured DocVault data
# directory and prints chronological series for the requested lab names.
#
# Usage:
#   bash scripts/lab-trends.sh                   # default lab panel
#   bash scripts/lab-trends.sh LDL TSH FERRITIN  # specific labs (substring match on Observation.code.text)
#
# Configuration:
#   DOCVAULT_DATA_DIR — root data directory containing health/<PERSON_ID>/clinical-records
#                       (default ./data)
#
# Reads personId from /tmp/person-id.txt (created by fetch-all.sh).
#
# Default panel covers the big movers for cardiovascular, metabolic,
# hematologic, thyroid, and liver/kidney function:
#   PLT, LDL, TRIGLYCERIDE, CHOLESTEROL, HDL, GLUCOSE, HEMOGLOBIN A1C,
#   25-OH VITAMIN D, TSH, CREATININE, ALT, AST

set -euo pipefail

DATA_DIR="${DOCVAULT_DATA_DIR:-./data}"

if [[ ! -f /tmp/person-id.txt ]]; then
  echo "[lab-trends] /tmp/person-id.txt not found — run fetch-all.sh first" >&2
  exit 1
fi
PERSON_ID=$(cat /tmp/person-id.txt)

CLINICAL_DIR="${DATA_DIR}/health/${PERSON_ID}/clinical-records"
if [[ ! -d "$CLINICAL_DIR" ]]; then
  echo "[lab-trends] clinical-records not found at $CLINICAL_DIR" >&2
  echo "[lab-trends] set DOCVAULT_DATA_DIR if your DocVault data lives elsewhere." >&2
  exit 1
fi

if [[ $# -eq 0 ]]; then
  TARGETS=(PLT LDL TRIGLYCERIDE CHOLESTEROL HDL GLUCOSE "HEMOGLOBIN A1C" "25-OH VITAMIN D" TSH CREATININE ALT AST)
else
  TARGETS=("$@")
fi

TARGETS_JSON=$(node -e "console.log(JSON.stringify(process.argv.slice(1)))" "${TARGETS[@]}")

CLINICAL_DIR="$CLINICAL_DIR" TARGETS_JSON="$TARGETS_JSON" node -e '
const fs = require("fs");
const path = process.env.CLINICAL_DIR;
const targets = JSON.parse(process.env.TARGETS_JSON);
const files = fs.readdirSync(path).filter(f => f.endsWith(".json"));
const readings = Object.fromEntries(targets.map(t => [t, []]));
for (const f of files) {
  try {
    const d = JSON.parse(fs.readFileSync(path + "/" + f, "utf8"));
    const entries = Array.isArray(d) ? d : [d];
    for (const e of entries) {
      if (e.resourceType === "Observation" && e.code && e.code.text) {
        const name = e.code.text;
        for (const t of targets) {
          if (name.includes(t)) {
            const dt = e.effectiveDateTime || e.issued || "";
            const v = (e.valueQuantity && e.valueQuantity.value) ?? e.valueString;
            const flag = e.interpretation && e.interpretation[0] && e.interpretation[0].coding && e.interpretation[0].coding[0] && e.interpretation[0].coding[0].code;
            if (v !== undefined && v !== null) readings[t].push({ date: dt, value: v, flag: flag || null });
          }
        }
      }
    }
  } catch (_) {}
}
for (const t of targets) {
  readings[t].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  console.log("\n" + t + " (" + readings[t].length + " readings):");
  readings[t].forEach(r => console.log("  " + String(r.date).slice(0, 10) + ": " + r.value + (r.flag ? " [" + r.flag + "]" : "")));
}
'
