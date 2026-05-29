# Political Intelligence Roadmap

This document connects the three related efforts discussed for DocVault / Check the Vote / predictive headlines.

## 1. Check the Vote Pi service

Source of truth for public political records:

- congressional vote history and daily vote sync
- job/cursor/event visibility in `/admin/sync` and `/admin/cursors`
- official House trade disclosure filing discovery
- official House PTR PDF transaction parsing into `trade_disclosures`
- scanned/blank House PTR PDF warnings via `ptr_pdf_text_blank`
- API-key protected `/api/v1/*` endpoints consumed by DocVault

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

The committed Check the Vote API endpoints now use `Authorization: Bearer <CHECKTHEVOTE_API_KEY>`:

```text
GET /api/v1/health
GET /api/v1/sync
GET /api/v1/votes/recent?limit=25
GET /api/v1/trades/recent?limit=25
GET /api/v1/trade-filings/recent?limit=25
```

Potential next Check the Vote reads:

```text
GET /api/v1/politicians/:id/votes
GET /api/v1/politicians/:id/trades
GET /api/v1/politicians/:id/activity
GET /api/v1/daily/political-summary
```

## 3. Local/private scraper job layer

Selected first commentary sources:

- Nick Fuentes: Rumble
- Benjamin Cowen: YouTube plus the benjamincowen reports page
- George Gammon: YouTube only

Do not commit scraper implementations that target brittle or legally sensitive websites.

Preferred shape:

```text
DATA_DIR/jobs/manifests/*.json
DATA_DIR/jobs/scripts/*.local.{js,ts,sh}
DATA_DIR/jobs/runs/*.json
DATA_DIR/jobs/logs/*.ndjson
```

A committed generic scheduler can safely provide:

- job manifest validation (`server/jobs.ts` validates the safe committed manifest shape)
- API-backed manifest creation/listing (`GET/POST /api/jobs`) under `DATA_DIR/jobs/manifests`
- built-in job registry/listing for committed DocVault jobs (snapshot, Dropbox sync, encrypted backup, quant refresh)
- interval/cron metadata
- status persistence
- stdout/stderr capture
- UI-visible run history
- input/output folders

Current state: generic job manifest validation, API-backed manifest creation/listing, built-in job listing, and a Settings Jobs UI exist. The scheduler/executor that reads enabled custom manifests and runs local scripts on interval is still the next implementation step.

Example manifest shape:

```json
{
  "id": "benjamin-cowen-youtube-daily",
  "label": "Benjamin Cowen YouTube daily transcript pull",
  "kind": "local-script",
  "schedule": "daily",
  "script": "scripts/benjamin-cowen-youtube.local.ts",
  "enabled": true,
  "tags": ["politics", "transcript", "youtube"]
}
```

## 4. Predictive headlines V1

Wait until Check the Vote and DocVault Politics have enough structured inputs. Then build a small experiment. Prediction markets are first-class inputs: Kalshi and Polymarket prices should act as market-implied priors that the predictor records, compares against, and explains divergences from.

1. collect source bundle for day D:
   - recent votes
   - recent trades/disclosures
   - finance indicators already in DocVault
   - political/commentary research snippets
   - selected news headlines
   - selected Kalshi market snapshots
   - selected Polymarket market snapshots
2. generate predictions for day D+1
3. store predictions immutably with source context and market-implied probabilities
4. next day, fetch actual headlines
5. score similarity and misses
6. compare predictor performance against market-implied expectations
7. append prompt-evaluation notes, not automatic prompt mutation at first

Prediction-market ingestion should be read-only in V1:

```text
prediction_market_events
prediction_market_markets
prediction_market_snapshots
```

Minimum fields per snapshot:

- source: `kalshi` or `polymarket`
- market/event external ID
- question/title
- outcomes
- current implied probability or price
- volume/liquidity/open interest if available
- close/resolution date
- fetched timestamp
- raw payload for auditability

Initial storage can be plain JSON under `DATA_DIR/predictions/`:

```text
predictions/YYYY-MM-DD.predictions.json
predictions/YYYY-MM-DD.evaluation.json
```

Keep V1 boring: one scheduled run, visible logs/status, and manual prompt iteration based on scored misses.
