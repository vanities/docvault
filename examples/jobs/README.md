# Example custom jobs

Ready-made [custom jobs](../../server/custom-job-runner.ts) that pull research material into
DocVault on a schedule. They are **seeded disabled**: on first boot DocVault copies any it
hasn't seeded before into `DATA_DIR/jobs/` with `enabled: false`, so nothing runs until you
turn it on. Your edits and enable-state are never overwritten on later boots, and a job you
delete is not resurrected.

## Enable one

Settings → **Jobs** → under "Custom local jobs" find the job → **Enable** (or edit it and flip
the toggle). It then runs in-container on the same scheduler as the built-in jobs.

| Job                            | Schedule | What it does                                                                                                                                          |
| ------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `benjamin-cowen-reports-daily` | daily    | Scrapes new PDF reports from benjamincowen.com → Finance research                                                                                     |
| `benjamin-cowen-youtube-daily` | daily    | Ingests new Benjamin Cowen YouTube videos (captions) → Finance research                                                                               |
| `george-gammon-youtube-daily`  | daily    | Ingests new George Gammon YouTube videos → Finance research                                                                                           |
| `huberman-lab-youtube-daily`   | daily    | Ingests new Huberman Lab YouTube episodes (captions) → Health research                                                                                |
| `local-news`                   | every 6h | Polls your configured city/county/regional RSS feeds → Local research (ships unconfigured — fill in `FEEDS` + `LOCAL_TERMS` at the top of the script) |
| `lyn-alden-newsletter-daily`   | daily    | Scrapes Lyn Alden's free monthly newsletter archive → Finance research (forward-only; back-catalogue backfill opt-in via `DOCVAULT_JOB_BACKFILL=1`)   |
| `theo-youtube-daily`           | daily    | Ingests new Theo (t3.gg) YouTube uploads/streams → Tech research                                                                                      |
| `zerohedge-research`           | every 6h | Files matching ZeroHedge RSS articles → Finance / Politics / Health (headline watchlist, auto-routed by URL section)                                  |

## Make your own

Copy a manifest + script, change the source / watchlist, give it a unique kebab-case `id`, and
either drop it in `DATA_DIR/jobs/{manifests,scripts}/` or create it from Settings → Jobs.
Scripts must be named `*.local.{js,ts,sh}` under `scripts/`. They receive `DOCVAULT_DATA_DIR`,
`DOCVAULT_JOB_ID`, and `DOCVAULT_DRY_RUN` in their environment and reach the API at
`http://127.0.0.1:3005`.

## Notes

- **Disabled by default** and they pull from public third-party sources — review a script
  before enabling it.
- The ZeroHedge watchlist + section→domain routing live at the top of
  `zerohedge-research.local.js`; tune them and re-save. Preview without writing via
  `DOCVAULT_DRY_RUN=1`.
