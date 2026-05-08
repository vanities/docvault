---
name: update-showcase
description: Refresh DocVault's README screenshots from the demo instance, surface views the README doesn't document yet, and optionally sync the GitHub repo description and topics. Trigger when the user says "update showcase", "refresh screenshots", "regenerate README images", "sync GitHub metadata", or "update the repo description and tags".
allowed-tools: Bash(uv run:*) Bash(gh repo view:*) Bash(gh repo edit:*) Bash(lsof:*) Read Edit Write Grep Glob
---

# Update Showcase

Goal: keep `README.md` and GitHub repo metadata aligned with the current app. The skill does the mechanical work (booting the demo stack, capturing deterministic screenshots, diffing against the README); Claude does the editorial work (proposing where new screenshots belong, rewriting feature bullets, drafting a fresh description).

## Step 1 — Capture

Run the Python capture script. It boots the demo backend on `:3006` and the demo Vite frontend on `:5174`, walks every entry in `views.json`, writes PNGs into `docs/screenshots/`, and writes `capture-report.json` next to this skill.

```bash
uv run "${CLAUDE_SKILL_DIR}/scripts/capture.py"
```

Prerequisites handled by the script:

- Installs the Playwright Chromium binary if missing (idempotent).
- Starts/stops the two bun processes cleanly via `atexit` / `try/finally`.
- Fails fast if `:3006` or `:5174` is already bound — do NOT kill those silently, tell the user and ask.

## Step 1.5 — Personal-data sanity check (MANDATORY before any commit)

DocVault is a public repo that maintainers run against real records. Before staging anything from this skill's output, run:

```bash
uv run "${CLAUDE_SKILL_DIR}/scripts/check_personal_data.py"
```

The script scans every uncommitted text file (including new ones in `demo-data/` and modified `README.md`) for SSN shapes, credit-card / routing-number shapes, large dollar amounts, plausible real emails, and — if a gitignored `personal-patterns.txt` exists next to the script — user-specific literals (names, account tails, etc.). It exits 1 on any hit.

If it reports hits: show them to the user, do not run `git add`, and walk through each manually. Most will be false positives (e.g. "$1,234.56" fabricated fixtures); the goal is a human eyeballing every one.

Screenshots are binary and not scanned by content. Before committing `docs/screenshots/*.png`, you must have already visually inspected the handful you care about during Step 2 — that is the only defense against pixel-level leaks.

## Step 2 — Editorial pass

Read `${CLAUDE_SKILL_DIR}/capture-report.json` and `README.md`, then reconcile them.

The report has three lists:

- `captured` — PNGs written this run (with `slug` and `section`).
- `not_in_readme` — captured files the README does not reference yet.
- `in_readme_not_captured` — README references that no longer have a corresponding view in `views.json` (likely dead).
- `errors` — per-view capture failures (missing selector, timeout, etc.).

For each `not_in_readme` entry:

1. Decide which README section it belongs in (use the `section` hint: `Documents & Taxes`, `Net Worth & Portfolio`, `Quant Dashboards & Strategy`, `Health`, `Privacy`, `Other`).
2. Draft a one-line feature bullet and a caption that matches the existing tone (concise, no marketing fluff — look at nearby bullets for voice).
3. Decide placement: standalone `![caption](./docs/screenshots/x.png)` vs. adding a `<td>` to an existing 2-col table.

For each `in_readme_not_captured` entry: confirm the view was actually removed from the app (cross-check `NavView` in `src/contexts/AppContext.tsx`). If yes, propose removing the README reference. If the view still exists, add it to `views.json` instead.

Show the full set of proposed README diffs in one message. Wait for the user to say go before running `Edit`.

Cross-check `views.json` against `validViews` in `src/contexts/AppContext.tsx` — if the app has a `NavView` that isn't in `views.json`, flag it as a skill-side gap and propose the entry to add.

## Step 3 — GitHub metadata (if asked)

If the user wants to sync repo description and topics, load `${CLAUDE_SKILL_DIR}/reference.md` — it has the canonical description template and topic list.

Fetch current values first so the diff is visible:

```bash
gh repo view --json description,homepageUrl,repositoryTopics
```

Propose a single `gh repo edit` invocation covering description, homepage, and topic changes. Show current vs. proposed side-by-side. Only run after the user confirms.

## Adding a new view

Append to `views.json`:

```json
{ "slug": "new-view", "file": "new-view.png", "section": "Documents & Taxes" }
```

Pre-actions (click a tab, pick a person, wait for a selector) go under `pre_actions`. Supported action types are documented in `views.json` and implemented in `scripts/capture.py`. Re-run the skill.

## Notes

- The script sets `DOCVAULT_DATA_DIR=./demo-data` and `DOCVAULT_PASSWORD=demo` so the demo backend boots self-contained; it does not touch the user's real `./data/`.
- Viewport defaults to 1440×900 at `device_scale_factor: 2` for crisp output. Per-view `viewport` or `full_page: true` overrides live in `views.json`.
- Demo fixtures must stay generic — no real names or amounts. The CLAUDE.md "open source / privacy" rules apply: fabricate (`Acme Bank`, `$1,234.56`, `John Doe`) when writing new fixtures.
