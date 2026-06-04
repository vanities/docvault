# Political + Finance Data Platform — Next Steps

> **Update (June 2026):** DocVault now ingests political data **natively and
> forward-only** — recent congressional bills (Congress.gov), presidential
> executive actions (Federal Register), House PTR trades, and Trump's OGE-278-T
> trades — via the built-in `politicsRefresh` scheduler task (`server/politics/`),
> writing a rolling cache to `.docvault-politics.json`. The external **Check the
> Vote** Pi bridge and its `CHECKTHEVOTE_*` env vars have been **removed**. Senate
> eFD is the one source not yet ported (brittle CSRF handshake; deferred). The
> sections below predate this change and are kept for historical context.

This document is the pushed, repo-safe version of the working cross-context plan. It keeps the durable project direction in version control without relying on a local scratch file.

## Goal

Build a local-first political intelligence layer that can support financial decision-making by combining:

1. what politicians vote on,
2. what politicians buy and sell,
3. what selected commentators and news sources are saying,
4. prediction-market probabilities, and
5. eventually, a small headline-prediction experiment that scores itself against actual next-day headlines.

The immediate foundation is Check the Vote running as a LAN-only political data service with durable ingest, visible sync status, logs/warnings, backups, and protected APIs consumed by DocVault.

## Systems

| System               | Role                                                                                                   | Current status                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Check the Vote       | Political data service for votes, bills, politicians, trade filings, ingest status, and protected APIs | Pi LAN staging is live at `http://192.168.1.12:3000`; historical trades, bills/votes, enrichment, and trade linking are verified. SSD deployment is next when drive arrives. |
| DocVault             | Local finance/health/document workspace and future Politics tab                                        | Check the Vote backend bridge/aggregator, generic local Jobs manifest API/UI, and roadmap are pushed. Politics tab UI still needs wiring.                                    |
| Artist Kit           | Markdown/influences/output archive                                                                     | Likely identified; keep future access read-only and provenance-preserving.                                                                                                   |
| Predictive Headlines | Future experiment                                                                                      | Should ingest news, DocVault/Check the Vote signals, and Kalshi/Polymarket probabilities.                                                                                    |

## Completed foundation

### Check the Vote

- Protected v1 API foundation.
- Ingest event logging and `/admin/sync` dashboard visibility.
- `/admin/cursors` view for historical/resumable workers.
- Pi deployment/systemd/backup templates.
- Politician trade disclosure schema.
- Protected recent votes/trades/filings APIs:
  - `GET /api/v1/health`
  - `GET /api/v1/sync`
  - `GET /api/v1/votes/recent`
  - `GET /api/v1/trades/recent`
  - `GET /api/v1/trade-filings/recent`
- Official House financial disclosure filing index ingest.
- Official House PTR PDF parser using `pdftotext -layout`.
- `trades:house-ptr` worker that parses official House PTR PDFs into `trade_disclosures`.
- Admin-visible warnings for scanned/blank PDFs requiring OCR.
- Full current 2026 House PTR local verification:
  - 222 / 222 PTR filings handled.
  - 1,999 official House PTR transaction rows parsed.
  - 23 scanned/blank-PDF warnings.
  - 0 remaining readable zero-transaction warnings after parser fixes.
- Pi staging snapshot as of 2026-05-30:
  - `trade_disclosures`: 51,408 rows; 39,826 linked to politicians (77.47%).
  - `bills`: 3,527; `bill_cosponsors`: 3,275.
  - `votes`: 79; `vote_records`: 19,494; votes linked to bills: 25.
  - Live `/trades`, `/bills`, `/votes`, and `/politicians` pages render on LAN staging with 0 browser console errors after latest verification.
- Senate PTR ingestion/support is implemented and has populated `trade_disclosures` with `chamber = senate`.
- Vote ingest cursors advance numerically rather than lexicographically.
- Targeted vote-reference bill backfill exists: `bun run scripts/run-ingest.ts bills-vote-refs`.

### DocVault

- Politics tab v1 exists with Check the Vote connection status, sync events/warnings, recent votes, recent trades, filings-attention bucket, and politics research inbox.
- Check the Vote server bridge exists.
- Check the Vote backend aggregator route exists: `GET /api/check-the-vote/politics` fetches health, sync, recent votes, recent trades, and recent filings through the server-side API key.
- Check the Vote connector tests cover missing config fail-closed behavior and bearer-auth upstream requests.
- Generic local Jobs manifest validation and API-backed manifest creator/listing exist.
- Generic custom job manifests are stored under `DATA_DIR/jobs/manifests` via `GET/POST /api/jobs`.
- Settings has a Jobs UI that lists committed built-in jobs and local custom job manifests.
- Site-specific scraper scripts are still intentionally not committed.
- Political intelligence roadmap exists and includes Kalshi/Polymarket as future prediction-market inputs.
- Validation after the roadmap update:
  - `vp check` passed with pre-existing warnings only.
  - `vp test` passed: 830 passed, 2 skipped.

## Execution principles

- Keep work in small, verified commits.
- For code changes, prefer TDD: failing test → implementation → passing test.
- Every ingest path must produce visible logs/events; no silent row-level failures.
- Historical and daily sync health must be visible separately.
- Missing secrets must fail closed; never allow `Bearer undefined`-style auth.
- Do not commit local/site-specific scraper scripts to public/shared repos.
- Prefer official APIs and public structured sources before scraping.
- For local connector/scraper mechanisms, keep private definitions local and make execution auditable.

## Phase 1 — Check the Vote remaining work

### OCR follow-up for scanned PTR PDFs

Current behavior: scanned/non-text PDFs are detected and logged as `ptr_pdf_text_blank`. They do not block the worker.

- [ ] Decide OCR strategy:
  - local `ocrmypdf` + `tesseract`,
  - external/local document OCR pipeline, or
  - warning-only for v1.
- [ ] If implementing OCR, add a separate worker path so normal text PDFs remain fast.
- [ ] Add OCR-needed admin count if useful.

Acceptance criteria:

- [ ] Scanned PDFs are either intentionally deferred with visible warnings or parsed through OCR.
- [ ] No scanned PDF silently looks successful without explanation.

### Senate trade disclosure support

- [x] Research official Senate eFD/PTR access pattern.
- [x] Add a source contract test before broad ingest.
- [x] Add Senate filing discovery/backfill path.
- [x] Add Senate PTR transaction ingest.
- [x] Surface source-specific warnings in ingest/admin log surfaces.

Acceptance criteria:

- [x] Senate filing discovery is source-tested.
- [x] Senate trade transactions land in `trade_disclosures` with `chamber = senate`.
- [x] Failures/warnings appear in admin/log surfaces.

### Additional protected APIs

Existing APIs are enough for the first DocVault bridge. Next candidates:

- [ ] `GET /api/v1/politicians/:id/activity` or slug equivalent.
- [x] `GET /api/v1/politicians/:id/trades` / identifier equivalent exists.
- [ ] `GET /api/v1/politicians/:id/votes`.
- [ ] `GET /api/v1/daily/political-summary` combining recent votes, bills, trades, and sync metadata.
- [ ] Query filters for date range, chamber, ticker, category, and politician/person.

Acceptance criteria:

- [x] DocVault backend can fetch first Politics-tab primitives with one API key via `GET /api/check-the-vote/politics`.
- [x] Missing API key fails closed.
- [ ] Politics tab UI still needs to render sync metadata/stale/error states.

## Phase 2 — Pi + SSD deployment

### Prepare SSD layout

- [ ] Mount SSD persistently.
- [ ] Ensure repo, database volume, logs, raw files, and backups live on SSD rather than SD card.
- [ ] Confirm reboot preserves mount.
- [ ] Confirm service user can read/write app paths.

### Clone/configure Check the Vote on Pi

- [x] Stand up temporary Pi LAN staging at `/srv/checkthevote-stage/repo`; clone onto SSD remains pending.
- [ ] Clone Check the Vote onto SSD.
- [x] Install runtime dependencies for Pi staging.
- [x] Configure Pi staging env:
  - `DATABASE_URL`
  - `CRON_SECRET`
  - `CHECKTHEVOTE_API_KEY`
  - `PDFTOTEXT_BIN`
  - optional official API keys
- [ ] Install `poppler-utils` for `pdftotext`.
- [x] Run Pi staging smoke tests.
- [x] Confirm app/API health works on LAN staging.

### Install services and backups

Templates already exist. Remaining work is Pi-side installation and verification.

- [ ] Install app service.
- [ ] Install worker service.
- [ ] Install backup service/timer.
- [ ] Confirm journald/systemd status is useful.
- [ ] Run backup smoke test.
- [ ] Test restore procedure once.

### Run historical ingest on Pi

- [x] Seed/use historical cursors with intended ranges.
- [x] Start worker/ingest in bounded chunks.
- [ ] Verify `/admin/cursors` and `/admin/sync` while it runs.
- [ ] Confirm historical ingest can resume after service restart.
- [ ] Let long historical backfill continue in background.

### Keep LAN-only first

- [ ] Bind/access service on LAN only.
- [ ] Do not expose publicly yet.
- [ ] Consider Cloudflare Tunnel only after auth, logging, backups, and failure visibility are proven.

## Phase 3 — DocVault Politics tab

### Connector/runtime verification

- [ ] Confirm production NAS/local secret storage for `CHECKTHEVOTE_BASE_URL` and `CHECKTHEVOTE_API_KEY`.
- [x] Verify DocVault can call Check the Vote on LAN.
- [x] Show Check the Vote connection/error states and sync warning/error counts; richer stale-age copy can still be improved later.
- [ ] Ensure API key is never exposed client-side if a backend boundary is available.

### Politics tab v1 sections

- [ ] Sync health.
- [ ] Recent votes.
- [ ] Recent politician trades.
- [ ] Filings needing attention, including scanned/OCR-needed warnings.
- [ ] Commentary inbox placeholder for local/private transcripts.

Acceptance criteria:

- [ ] Politics tab loads without external internet if Check the Vote is reachable on LAN.
- [ ] Stale/error states are obvious.
- [ ] No sensitive API key is exposed in client-side code.

## Phase 4 — Local/private connector system

Policy boundary: do not commit site-specific scraping scripts or private connector definitions. Commit only the generic runner, templates, validation, logs, and UI.

Preferred source order:

1. official API,
2. RSS/feed/sitemap,
3. downloadable transcript/export,
4. browser/manual import,
5. scraping only where allowed and local/private.

### Generic connector shape

- [x] Add API-backed generic manifest creator/list endpoint: `GET/POST /api/jobs`.
- [x] Store local custom job manifests under `DATA_DIR/jobs/manifests`.
- [x] Runtime-ensure local custom job folders under `DATA_DIR/jobs/{manifests,scripts,runs,logs}`.
- [x] Add manifest validation.
- [x] Add Settings Jobs UI that lists built-in jobs and local custom jobs.
- [x] Factor built-in scheduler jobs into the same listing surface while keeping committed typed handlers.
- [ ] Add checked-in template documentation for private local manifests.
- [ ] Add scheduler/executor that reads enabled manifests and runs local scripts on interval.
- [ ] Add dry-run mode.
- [ ] Add UI-visible run history, stdout/stderr, next-run, and last-error.

### First private connectors

Candidate sources:

- [x] Nick Fuentes — Rumble custom NAS job `nick-rumble-daily` exists/runs under `/mnt/user/appdata/docvault/data/jobs` and stores cleaned Rumble captions in DocVault research.
- [x] Benjamin Cowen — YouTube plus the benjamincowen reports page custom NAS jobs exist/run: `benjamin-cowen-youtube-daily` stores caption transcripts and `benjamin-cowen-reports-daily` uploads actual report PDFs.
- [x] George Gammon — YouTube-only custom NAS job `george-gammon-youtube-daily` exists/runs and stores caption transcripts.
- [ ] Other macro/political commentators as needed.

Acceptance criteria:

- [x] At least one daily connector runs locally; all four first-source jobs are enabled on the NAS DocVault data volume.
- [x] Transcript/PDF artifacts land in DocVault research; summary/claim extraction remains the next separate layer.
- [x] Logs show last run/status/error details through `/data/jobs/status.json` and `/data/jobs/runs/...`.

## Phase 5 — Combine politics and finance signals

- [ ] Define normalized signal model for votes, bills, trades, commentary claims, headlines, watchlist/tickers, source quality, and confidence.
- [ ] Link politician trades by ticker.
- [ ] Link bills/votes by topic and affected industry.
- [ ] Link commentary claims by ticker/topic.
- [ ] Preserve provenance for every signal.

Acceptance criteria:

- [ ] For a ticker/topic, DocVault can show relevant votes/bills, politician trades, commentary transcripts, dates, and sources.

## Phase 6 — Artist Kit read-only understanding

- [ ] Confirm the intended Artist Kit repo/vault.
- [ ] Decide read-only indexing approach.
- [ ] Do not merge repos.
- [ ] Add a DocVault reference/index layer that can understand Artist Kit Markdown/backups.
- [ ] Keep provenance: every indexed claim links back to original file/path.

Acceptance criteria:

- [ ] DocVault can search/reference Artist Kit content without owning or mutating it.

## Phase 7 — Predictive headlines experiment

Prediction markets are first-class forecast inputs. Kalshi and Polymarket probabilities should act as market-implied priors that the headline generator either agrees with or explicitly explains divergence from.

### Research prior art

- [ ] Search for existing “predict tomorrow's headlines” projects/products.
- [ ] Search for news + prediction-market forecasting projects.
- [ ] Decide whether this is a separate repo or DocVault module.
- [ ] Define a small v1 scoring loop.

### Prediction-market ingestion

Target sources:

- [ ] Polymarket public read-only APIs:
  - Gamma API for discovery/search/events/markets.
  - CLOB API for live prices, order books, and history.
  - Data API for trades/open interest when useful.
- [ ] Kalshi market data:
  - prefer official/public API access if available,
  - store market ticker/event metadata, current probability, volume/liquidity, close time, and resolution state.

Suggested normalized model:

```text
prediction_market_events
prediction_market_markets
prediction_market_prices
prediction_market_snapshots
```

Minimum fields:

- source: `polymarket` or `kalshi`,
- event/market external ID,
- question/title,
- category/topic,
- outcomes,
- current Yes/No probability or equivalent price,
- volume/open interest/liquidity if available,
- close/resolution date,
- last fetched time,
- raw source payload for auditability.

### V1 prediction loop

- [ ] Pull daily news/politics/finance inputs.
- [ ] Pull selected Kalshi/Polymarket market snapshots.
- [ ] Generate predicted next-day headlines.
- [ ] Store predictions with timestamp, source context, and market-implied probabilities.
- [ ] Next day, fetch actual headlines.
- [ ] Score predictions reproducibly.
- [ ] Compare model predictions against market-implied probabilities.
- [ ] Adjust prompt/rubric manually based on misses.

Acceptance criteria:

- [ ] Predictions are timestamped before the target day.
- [ ] Actuals are fetched from fixed sources.
- [ ] Score is reproducible.
- [ ] Each prediction records which Kalshi/Polymarket markets influenced it.
- [ ] The system can report whether it beat, matched, or lagged market-implied expectations.

## Immediate next steps

1. Confirm SSD availability and intended mount path.
2. Install Docker on the Pi if Docker remains the preferred Postgres/runtime strategy.
3. Deploy Check the Vote to the Pi/SSD using Docker/Postgres volumes on SSD once attached.
4. Verify LAN-only `/api/v1/health`, `/admin/sync`, and `/admin/cursors`.
5. Start bounded historical ingest on the Pi.
6. Only after Check the Vote is reachable on LAN, finish DocVault runtime connector verification.
7. Continue DocVault Politics tab UI and private connector scheduler/executor.

## Definition of done for the politics foundation

- [ ] Check the Vote runs on the Pi from SSD.
- [ ] Historical ingest can run/resume in background.
- [ ] Daily/current ingest runs automatically.
- [ ] `/admin/sync` and `/admin/cursors` show useful status and errors.
- [ ] Politician votes and trades are available through protected APIs.
- [ ] DocVault can consume Check the Vote with an API key.
- [ ] DocVault has a Politics tab with sync health, recent votes, recent trades, and warnings.
- [ ] Local/private commentary connectors can run without committing scraping scripts.
- [ ] All major jobs have visible logs/errors.
