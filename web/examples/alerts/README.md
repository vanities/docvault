# Alerts

Any [custom job](../jobs/README.md) can become an alert source. DocVault remembers each check,
emails you only when something goes wrong, and shows every source on the **Alerts** page with
its own on/off switches and, optionally, its own dashboard.

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
**Emails** switch (checks keep running, nothing is sent), and **Check now**.

## Give it a dashboard

Put a `dashboard.html` at `DATA_DIR/alerts/<sourceId>/dashboard.html`. DocVault shows it under
the source card in a sandboxed frame:

- It receives `{ type: "docvault:alert", version: 1, source, theme }` when it loads and after
  every refresh. `source` is the source exactly as `GET /api/alerts` returns it (checks, series,
  detail, job, and so on). `theme.colors` holds the app's color tokens, such as `surface-50` and
  `accent-400`.
- It can post `{ type: "docvault:alert:ready" }` to ask for data and
  `{ type: "docvault:alert:height", height }` to size its frame.
- It can run scripts, but it has no network access, can't reach DocVault's API or session, and
  can load scripts only from cdn.jsdelivr.net or cdnjs.cloudflare.com (fonts from Google Fonts).

[`dashboard.example.html`](dashboard.example.html) is a starting point: it draws every check and
series it receives. Copy it, then add whatever your source's `detail` makes possible.
