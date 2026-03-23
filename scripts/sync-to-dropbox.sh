#!/bin/bash
# DocVault -> Dropbox sync script
# Syncs document files to Dropbox (one-way push) and pushes encrypted config backup.
# Uses DOCVAULT_DATA_DIR env var (set in Docker), falls back to NAS path.
# Runs inside the container via the Bun scheduler every 15 minutes.

DATA_DIR="${DOCVAULT_DATA_DIR:-/mnt/user/appdata/docvault/data}"
STATUS_FILE="$DATA_DIR/.docvault-sync-status.json"
LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"

# Entity -> Dropbox folder mapping
declare -A ENTITY_MAP=(
  ["personal"]="important/taxes"
  ["consulting-llc"]="important/My LLC"
  ["farm-llc"]="important/Example Farm LLC"
  ["military"]="important/Military"
  ["va"]="important/Benefits"
  ["health-docs"]="important/Health"
  ["id-docs"]="important/ID"
  ["land"]="important/Land"
  ["military-docs"]="important/Navy Docs"
  ["education"]="important/Education"
  ["personality"]="important/personality"
  ["resume"]="important/Resume"
)

# Write status: syncing
START_TIME=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
printf '{"status":"syncing","startedAt":"%s"}\n' "$START_TIME" > "$STATUS_FILE"

echo "$LOG_PREFIX Starting DocVault -> Dropbox sync"

ERRORS=0
SYNCED=0

for entity in "${!ENTITY_MAP[@]}"; do
  local_path="$DATA_DIR/$entity"
  dropbox_path="dropbox:${ENTITY_MAP[$entity]}"

  if [ ! -d "$local_path" ]; then
    continue
  fi

  echo "$LOG_PREFIX Syncing $entity -> $dropbox_path"
  OUTPUT=$(rclone copy "$local_path" "$dropbox_path" \
    --exclude ".docvault-*" \
    --exclude ".DS_Store" \
    --update \
    --stats-one-line \
    -v 2>&1)

  EXIT_CODE=$?
  if [ $EXIT_CODE -ne 0 ]; then
    echo "$LOG_PREFIX ERROR syncing $entity: $OUTPUT"
    ERRORS=$((ERRORS + 1))
  else
    SYNCED=$((SYNCED + 1))
  fi
done

# Push encrypted config backup to Dropbox (created by DocVault scheduler)
BACKUP_FILE="$DATA_DIR/.docvault-config-backup.enc"
if [ -f "$BACKUP_FILE" ]; then
  echo "$LOG_PREFIX Pushing encrypted config backup to Dropbox"
  OUTPUT=$(rclone copy "$BACKUP_FILE" "dropbox:important/docvault-backup/" --update -v 2>&1)
  if [ $? -eq 0 ]; then
    echo "$LOG_PREFIX Encrypted backup pushed successfully"
  else
    echo "$LOG_PREFIX ERROR pushing encrypted backup: $OUTPUT"
    ERRORS=$((ERRORS + 1))
  fi
fi

# Write status: complete
END_TIME=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
if [ $ERRORS -eq 0 ]; then
  STATUS="ok"
else
  STATUS="error"
fi

# Calculate next sync (15 min from now) — try GNU date, then BSD date
NEXT_SYNC=$(date -u -d '+15 minutes' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v+15M '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo "")

printf '{"status":"%s","lastSync":"%s","entitiesSynced":%d,"errors":%d,"nextSync":"%s"}\n' \
  "$STATUS" "$END_TIME" "$SYNCED" "$ERRORS" "$NEXT_SYNC" > "$STATUS_FILE"

echo "$LOG_PREFIX Sync complete: $SYNCED entities synced, $ERRORS errors"
