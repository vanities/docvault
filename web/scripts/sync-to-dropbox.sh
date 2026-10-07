#!/bin/bash
# DocVault -> Dropbox sync script
# Syncs document files to Dropbox (one-way push) and pushes encrypted config backup.
# Uses DOCVAULT_DATA_DIR env var (set in Docker), falls back to /data.
# Runs inside the container via the Bun scheduler every 15 minutes.
#
# Entity -> Dropbox path mapping:
#   By default, each entity syncs to dropbox:DocVault/{entitySlug}/
#   To customize paths, create DATA_DIR/.docvault-dropbox-map.json:
#     { "personal": "MyFiles/taxes", "my-llc": "MyFiles/LLC", ... }

DATA_DIR="${DOCVAULT_DATA_DIR:-/data}"
STATUS_FILE="$DATA_DIR/.docvault-sync-status.json"
CONFIG_FILE="$DATA_DIR/.docvault-config.json"
MAP_FILE="$DATA_DIR/.docvault-dropbox-map.json"
LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"

# Write status: syncing
START_TIME=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
printf '{"status":"syncing","startedAt":"%s"}\n' "$START_TIME" > "$STATUS_FILE"

echo "$LOG_PREFIX Starting DocVault -> Dropbox sync"

ERRORS=0
SYNCED=0

# Build list of entity slugs from .docvault-config.json
if [ ! -f "$CONFIG_FILE" ]; then
  echo "$LOG_PREFIX No config file found at $CONFIG_FILE — skipping sync"
  printf '{"status":"error","lastSync":"%s","entitiesSynced":0,"errors":1}\n' "$START_TIME" > "$STATUS_FILE"
  exit 1
fi

ENTITIES=$(node -e "
  const cfg = JSON.parse(require('fs').readFileSync('$CONFIG_FILE', 'utf8'));
  const entities = cfg.entities || [];
  entities.forEach(e => console.log(e.id || e.slug || e.name));
" 2>/dev/null)

if [ -z "$ENTITIES" ]; then
  echo "$LOG_PREFIX No entities found in config — skipping sync"
  printf '{"status":"ok","lastSync":"%s","entitiesSynced":0,"errors":0}\n' "$START_TIME" > "$STATUS_FILE"
  exit 0
fi

# Load custom path overrides if present
get_dropbox_path() {
  local entity="$1"
  if [ -f "$MAP_FILE" ]; then
    local custom
    custom=$(node -e "
      const m = JSON.parse(require('fs').readFileSync('$MAP_FILE', 'utf8'));
      process.stdout.write(m['$entity'] || '');
    " 2>/dev/null)
    if [ -n "$custom" ]; then
      echo "dropbox:$custom"
      return
    fi
  fi
  echo "dropbox:DocVault/$entity"
}

while IFS= read -r entity; do
  [ -z "$entity" ] && continue
  local_path="$DATA_DIR/$entity"
  dropbox_path=$(get_dropbox_path "$entity")

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
done <<< "$ENTITIES"

# Push encrypted config backup to Dropbox (created by DocVault scheduler)
BACKUP_FILE="$DATA_DIR/.docvault-config-backup.enc"
if [ -f "$BACKUP_FILE" ]; then
  echo "$LOG_PREFIX Pushing encrypted config backup to Dropbox"
  OUTPUT=$(rclone copy "$BACKUP_FILE" "dropbox:DocVault/.backup/" --update -v 2>&1)
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
