#!/usr/bin/env bash
# Print the full time-series for one clinical lab test.
#
# Usage:
#   lab-trend.sh <personId> <labNameSubstring>
#
# labNameSubstring is case-insensitive — "LDL" matches "LDL, DIRECT*",
# "hemoglobin" matches "HEMOGLOBIN A1C*", etc.
#
# If no lab matches, the script prints the first ~30 available lab names
# for the person so you can pick the right substring.
#
# Override the DocVault URL with DOCVAULT_URL (default http://localhost:3005).

set -euo pipefail

NAS_URL="${DOCVAULT_URL:-http://localhost:3005}"

if [ $# -lt 2 ]; then
  echo "Usage: $0 <personId> <labNameSubstring>" >&2
  echo "Example: $0 person-xxxxxx LDL" >&2
  echo "" >&2
  echo "Tip: run person-ids.sh first to list person IDs." >&2
  exit 1
fi

PERSON_ID="$1"
export LAB_SUBSTR="$2"

curl -fsS "$NAS_URL/api/health/$PERSON_ID/clinical" | node -e '
  let buf = "";
  process.stdin.on("data", c => buf += c).on("end", () => {
    let r;
    try {
      r = JSON.parse(buf);
    } catch (e) {
      console.error("Failed to parse response:", e.message);
      console.error("First 200 chars:", buf.slice(0, 200));
      process.exit(2);
    }
    if (r.error) {
      console.error("API error:", r.error);
      process.exit(2);
    }
    const allLabs = (r.clinical && r.clinical.labsByTest) || [];
    const sub = (process.env.LAB_SUBSTR || "").toLowerCase();
    const labs = allLabs.filter(l => l.name && l.name.toLowerCase().includes(sub));
    if (labs.length === 0) {
      console.error(`No lab matching "${process.env.LAB_SUBSTR}"`);
      console.error("");
      console.error("Available labs (first 30):");
      for (const l of allLabs.slice(0, 30)) console.error("  " + l.name);
      if (allLabs.length > 30) console.error(`  ... and ${allLabs.length - 30} more`);
      process.exit(1);
    }
    for (const lab of labs) {
      const unit = lab.unit ? ` (${lab.unit})` : "";
      process.stdout.write(`\n=== ${lab.name}${unit} ===\n`);
      const lo = lab.refLow === null || lab.refLow === undefined ? "-" : lab.refLow;
      const hi = lab.refHigh === null || lab.refHigh === undefined ? "-" : lab.refHigh;
      process.stdout.write(`Ref range: ${lo} to ${hi}\n`);
      process.stdout.write("Date        Value        Flag\n");
      for (const p of lab.points) {
        const date = (p.date || "-").padEnd(12);
        const rawVal = p.value !== null && p.value !== undefined ? p.value : (p.valueString || "-");
        const val = String(rawVal).padEnd(13);
        const flag = p.derivedFlag || p.interpretation || "";
        process.stdout.write(`${date}${val}${flag}\n`);
      }
    }
  });
'
