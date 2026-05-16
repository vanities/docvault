# Editorial reference — README & GitHub metadata

Loaded on demand during Step 2/3 of the `update-showcase` skill. Keeps canonical copy and topic list in one place so the README and the GitHub repo page don't drift.

## README voice

- Lead with the concrete capability, not the aspiration. "Parses financial PDFs with Claude" > "AI-powered document intelligence."
- One line per bullet. If a feature needs two lines, it's two features.
- Numbers stay fabricated: `$1,234.56`, `Acme Bank`, `John Doe`. Never paste real fixtures into the README — see AGENTS.md's open-source / privacy rules.
- Screenshot captions live next to the image in an underscore-italic line only when the image needs context beyond what the alt text provides.

## Section order (must match)

1. Title + tagline + hero screenshot (`tax-year.png`)
2. Demo mode quick start (Try It Locally)
3. Features
   1. Documents & Taxes
   2. Net Worth & Portfolio
   3. Quant Dashboards & Strategy
   4. Health (Apple Health)
   5. Backup, Sync, Observability
   6. Privacy
   7. Other
4. Quick Start (non-demo)
5. Docker + Compose
6. Environment Variables table
7. Data Files table
8. Tech Stack table
9. License

## Screenshot layout patterns

| Pattern                                       | When to use                                                 |
| --------------------------------------------- | ----------------------------------------------------------- |
| Single `![alt](./docs/screenshots/x.png)`     | Flagship views per section (portfolio, federal-tax, health) |
| 2-col `<table>` with 2 rows                   | Related peers (crypto/brokers, banks/gold)                  |
| 2-col `<table>` with colspan=2 for a wide one | When one of four is meaningfully wider (property)           |

When a new screenshot arrives, prefer extending an existing table in its section before introducing a new standalone image — keeps the page compact.

## GitHub repo metadata

### Canonical description (fits GitHub's 350-char limit)

```
Self-hosted personal finance and document workspace — multi-entity tax records, net worth across brokers/crypto/metals/real estate, Claude-parsed PDFs, Apple Health + DNA ingest, macro + crypto quant dashboards, and AI-generated strategy notes. One container, one volume, zero telemetry.
```

### Homepage

Leave unset unless the maintainer has a dedicated landing page. Do not link the GHCR image as a homepage.

### Topics (recommended set)

```
personal-finance, self-hosted, tax-records, document-management,
net-worth-tracker, portfolio-tracker, crypto-portfolio, apple-health,
genomics, quant, claude-api, anthropic, bun, vite, react, typescript,
docker, ghcr, privacy-first
```

Cap at ~20 topics (GitHub's limit). If the user wants to prune, drop the most generic first (`typescript`, `react`, `vite`).

### Proposed gh command shape

Keep it one invocation so the diff is atomic:

```bash
gh repo edit \
  --description "<description>" \
  --add-topic personal-finance --add-topic self-hosted --add-topic tax-records \
  --add-topic document-management --add-topic net-worth-tracker \
  --add-topic portfolio-tracker --add-topic crypto-portfolio \
  --add-topic apple-health --add-topic quant --add-topic claude-api \
  --add-topic anthropic --add-topic bun --add-topic vite --add-topic react \
  --add-topic typescript --add-topic docker --add-topic ghcr --add-topic privacy-first
```

Use `--remove-topic` for explicit deletions rather than clearing the whole set.

## When a view is removed from the app

1. Delete its entry from `views.json`.
2. Run the skill — `in_readme_not_captured` will flag the README reference.
3. Remove the image from `docs/screenshots/` only after the README is updated (so reviewers can see what was removed).
