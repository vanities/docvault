# Alerts

Any [custom job](../jobs/README.md) can become an alert source. DocVault remembers each check,
emails you only when something goes wrong, and shows every source on the **Alerts** page with
its own on/off switches and its own dashboard.

## Alert add-ons

An add-on is three pieces that travel together:

1. **A check job**: a custom job that gathers data and reports its checks (below).
2. **The alert**: what DocVault keeps from those reports, emails about, and lists on the page.
3. **A dashboard**: `DATA_DIR/alerts/<sourceId>/dashboard.html`, the page shown when you open
   the alert.

These ship with DocVault. Their jobs are seeded **disabled** into Settings → Jobs and their
dashboards into `DATA_DIR/alerts/` on first boot; turn a job on and its alert appears.

| Add-on             | Schedule  | Checks                                                                                                 |
| ------------------ | --------- | ------------------------------------------------------------------------------------------------------ |
| `docvault-health`  | every 30m | Backup age and errors, failing or stalled scheduled jobs, failed outbound email, data-drive space      |
| `overdue-invoices` | every 6h  | Timesheet invoices 7+ and 30+ days past due, billable time from earlier months that was never invoiced |

Files: the job is `examples/jobs/{manifests,scripts}/<id>.*`; the dashboard is
`examples/alerts/<id>/dashboard.html`, built from `render.js` next to it.

## Report checks

After each run, POST the full set of checks to the API (jobs reach it at
`http://127.0.0.1:3005`):

```json
POST /api/alerts/report
{
  "sourceId": "example-uptime",
  "label": "Example uptime",
  "jobId": "example-uptime-job",
  "checks": [
    {
      "id": "site:status",
      "label": "Site answers",
      "scope": "example.com",
      "severity": "critical",
      "active": false,
      "value": "200 OK",
      "threshold": "not 200"
    }
  ],
  "advice": { "critical": "Restart the web server." },
  "series": { "site.latencyMs": 123 },
  "detail": { "kind": "example-uptime", "data": { "region": "demo" } }
}
```

- A check missing from a report counts as cleared, so always send all of them.
- Name checks `<item>:<check>` (for example `site:status`); dashboards group them by the prefix.
- Give checks neutral names ("Disk space", "Backup age"): the same label shows next to an OK
  state on the page and in the subject of a trip email.
- `series` is one chart point per report (DocVault stamps the time) and is kept for 14 days.
- `detail` is anything your dashboard needs (up to 256 KB); DocVault stores it as sent.
- `jobId` links the source to its job: that turns on the Checks switch, Check now, and the
  "stopped reporting" watchdog.
- When a run can't get its data, POST `{ "sourceId": "...", "error": "..." }` to
  `/api/alerts/report-failure` instead.

## When it emails

| Email    | Sent when                                                                   |
| -------- | --------------------------------------------------------------------------- |
| Tripped  | a check goes from OK to tripped                                             |
| Reminder | a check is still tripped 6 hours after the last email                       |
| Blind    | 3 failed runs in a row, or no report for 3 of the job's scheduled intervals |

Recoveries never email; they show on the page and ride along in the next bad-news email.
Alerts go only to the first address in Settings → Email, with no CC.

## Controls

Each source card has a **Checks** switch (turns its job on or off, same as Settings → Jobs), an
**Emails** switch (checks keep running, nothing is sent), **Check now**, and **Edit settings**
when its job declares settings.

## Settings

A job can let you adjust its numbers (a trip line, a target, a reference rate) from the Alerts
page. List them in every report:

```json
"settings": [
  {
    "key": "latencyWarnMs",
    "label": "Slow after",
    "unit": "ms",
    "default": 500,
    "min": 50,
    "max": 10000,
    "step": 50,
    "help": "Response time that counts as slow."
  }
]
```

- `key` is a plain identifier. `unit` shows with the value: `%` and `$` attach to the number,
  anything else follows it ("500 ms"). `min`, `max`, `step` and `help` are optional.
- Open the alert and click **Edit settings**. **Done** lists each change (old → new) before
  saving, and saving runs the job again right away so the new lines show.
- The job runner hands your values to every run in `DOCVAULT_ALERT_SETTINGS`, shaped
  `{ "<sourceId>": { "<key>": number } }`. Only values you changed are there, so merge them over
  the job's defaults:

  ```ts
  const owner = JSON.parse(process.env.DOCVAULT_ALERT_SETTINGS || '{}')[SOURCE_ID] ?? {};
  const setting = (key: string) =>
    Number.isFinite(owner[key]) ? owner[key] : SETTINGS.find((s) => s.key === key)!.default;
  ```

- Your values outlive reports. One for a key the job no longer declares, or outside a new
  `min`/`max`, is dropped and that setting goes back to its default.
- In a dashboard, `setting(source, key)` from the kit returns the value in effect, so a chart's
  line moves when you change it. Both shipped add-ons declare settings.

## Build a dashboard

A dashboard is one self-contained HTML file. The kit in [`kit/`](kit/) does the plumbing (theme,
cards, charts, tables, and the messages below), so an add-on only writes what to show:

1. Write `render.js` with `function render(source)` that returns HTML. The kit provides `card`,
   `headline`, `stats`/`stat`, `tag`, `chips`, `progress`, `hbars`, `table`, `lineChart`,
   `checksFor`, `worst`, `seriesOf`, `setting`, and formatters (`usd`, `pct`, `fmtNum`, `day`,
   `ago`).
   Pass every piece of report text through `esc()` before it goes into the page.
2. Build it: `bun run examples/alerts/kit/assemble.ts <render.js> <dashboard.html> "<Title>"`.
   For a dashboard that ships in this repo, run `vp fmt` on the result too: CI checks formatting,
   and assembling undoes it.
3. Preview it with a sample source:
   `bun run examples/alerts/kit/harness.ts <dashboard.html> <source.json> <preview.html>`, then
   open the preview in a browser. `bun run examples/alerts/kit/check.ts <dashboard.html>` catches
   syntax errors.

The two shipped add-ons are worked examples: see `docvault-health/render.js` and
`overdue-invoices/render.js`.

### What a dashboard can do

DocVault shows the file under the source card in a sandboxed frame:

- It receives `{ type: "docvault:alert", version: 1, source, theme }` when it loads and after
  every refresh. `source` is the source exactly as `GET /api/alerts` returns it (checks, series,
  detail, job, and so on). `theme.colors` holds the app's color tokens, such as `surface-50` and
  `accent-400`.
- It can post `{ type: "docvault:alert:ready" }` to ask for data and
  `{ type: "docvault:alert:height", height }` to size its frame.
- It can run scripts, but it has no network access, can't reach DocVault's API or session, and
  can load scripts only from cdn.jsdelivr.net or cdnjs.cloudflare.com (fonts from Google Fonts).
