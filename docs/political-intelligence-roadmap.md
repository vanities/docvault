# Political Intelligence Roadmap

This document connects the three related efforts discussed for DocVault / Check the Vote / predictive headlines.

## 1. Check the Vote Pi service

Source of truth for public political records:

- congressional vote history and daily vote sync
- job/cursor/event visibility in `/admin/sync`
- future politician trade disclosures
- future API-key protected `/api/v1/*` endpoints consumed by DocVault

DocVault should not own this long-running public backfill. It should call the Pi service over LAN once the SSD-backed service is live.

## 2. DocVault Politics tab

DocVault owns private/local intelligence:

- commentator transcripts and articles
- user notes and tags
- locally-created scraper outputs that should not be committed or pushed publicly
- Check the Vote API status/feed summaries once available

The initial `Politics` tab uses the existing research store with `domain: "politics"`, so political transcripts and PDFs are partitioned from finance and health research while reusing the proven PDF/text/YouTube ingest paths.

Future DocVault API client env/settings:

```text
CHECKTHEVOTE_BASE_URL=http://pi.local:3000
CHECKTHEVOTE_API_KEY=[REDACTED]
```

The first committed Check the Vote API endpoints now use `Authorization: Bearer $CHECKTHEVOTE_API_KEY`:

```text
GET /api/v1/health
GET /api/v1/sync
GET /api/v1/votes/recent?limit=25
```

Potential next Check the Vote reads:

```text
GET /api/v1/health
GET /api/v1/sync
GET /api/v1/votes/recent
GET /api/v1/politicians/:id/votes
GET /api/v1/trades/recent
```

## 3. Local/private scraper job layer

Do not commit scraper implementations that target brittle or legally sensitive websites.

Preferred shape:

```text
DATA_DIR/political-jobs/inbox/*.json
DATA_DIR/political-jobs/scripts/*.local.{js,ts,sh}
DATA_DIR/political-jobs/runs/*.json
DATA_DIR/political-jobs/logs/*.ndjson
```

A committed generic scheduler can safely provide:

- job manifest validation (`server/political-jobs.ts` now validates the safe committed manifest shape)
- interval/cron metadata
- status persistence
- stdout/stderr capture
- UI-visible run history
- input/output folders

Private local manifests/scripts provide the actual site-specific scraping behavior.

Example manifest shape:

```json
{
  "id": "benjamin-youtube-daily",
  "label": "Benjamin YouTube daily transcript pull",
  "schedule": "daily",
  "script": "scripts/benjamin-youtube.local.ts",
  "enabled": true,
  "tags": ["politics", "transcript", "youtube"]
}
```

## 4. Predictive headlines V1

Wait until Check the Vote and DocVault Politics have enough structured inputs. Then build a small experiment:

1. collect source bundle for day D:
   - recent votes
   - recent trades/disclosures
   - finance indicators already in DocVault
   - political/commentary research snippets
   - selected news headlines
2. generate predictions for day D+1
3. store predictions immutably
4. next day, fetch actual headlines
5. score similarity and misses
6. append prompt-evaluation notes, not automatic prompt mutation at first

Initial storage can be plain JSON under `DATA_DIR/predictions/`:

```text
predictions/YYYY-MM-DD.predictions.json
predictions/YYYY-MM-DD.evaluation.json
```

Keep V1 boring: one scheduled run, visible logs/status, and manual prompt iteration based on scored misses.
