#!/usr/bin/env bash
# List health people on the instance as a lookup table: one `<id>\t<name>` per line.
#
# Usage:
#   person-ids.sh                    # active people only
#   person-ids.sh --include-archived # include archived
#
# Override the DocVault URL with DOCVAULT_URL (default http://localhost:3005).

set -euo pipefail

NAS_URL="${DOCVAULT_URL:-http://localhost:3005}"
INCLUDE_ARCHIVED=0
for arg in "$@"; do
  case "$arg" in
    --include-archived) INCLUDE_ARCHIVED=1 ;;
    -h|--help)
      sed -n '2,8p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done
export INCLUDE_ARCHIVED

curl -fsS "$NAS_URL/api/health/people" | node -e '
  let buf = "";
  process.stdin.on("data", c => buf += c).on("end", () => {
    const people = (JSON.parse(buf).people) || [];
    const showArchived = process.env.INCLUDE_ARCHIVED === "1";
    for (const p of people) {
      if (!showArchived && p.archivedAt) continue;
      const mark = p.archivedAt ? "\t(archived)" : "";
      process.stdout.write(`${p.id}\t${p.name}${mark}\n`);
    }
  });
'
