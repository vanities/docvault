---
name: financial-snapshot
description: Fetch the consolidated financial snapshot for a given tax year from a DocVault instance (tax docs, sales, mileage, retirement, brokerage, crypto, bank accounts, real estate). Use when the user wants a year overview, tax estimates, deduction review, or a snapshot feeding downstream strategy skills.
argument-hint: [year]
---

Fetch the consolidated financial snapshot for a given tax year from a DocVault instance and present it.

## Setup

The skill expects DocVault to be reachable at `${DOCVAULT_URL}` (default `http://localhost:3005`). Set the env var if your instance lives elsewhere — for example a NAS:

```bash
export DOCVAULT_URL=http://docvault.local:3005   # or your NAS hostname/IP
```

## Instructions

1. Determine the year from `$ARGUMENTS`. If empty, default to the current calendar year (use `date +%Y`). For the tax-filing season (Jan–Apr), the prior year is usually the right default — ask the user if ambiguous.

2. Fetch the markdown snapshot:

   ```bash
   YEAR="${1:-$(date +%Y)}"
   curl -s "${DOCVAULT_URL:-http://localhost:3005}/api/financial-snapshot/${YEAR}?format=md"
   ```

3. If the curl fails (connection refused, timeout), tell the user the DocVault container may not be running. For self-hosted Docker setups this typically means checking `docker ps | grep docvault` (or `ssh <host> 'docker ps | grep docvault'` for a remote NAS deployment).

4. Present the full markdown output to the user — do NOT summarize or truncate

5. After presenting, offer follow-ups: tax estimates, missing deductions, quarterly payment sizing, Schedule C category review, retirement-account optimization, or net-worth interpretation

## Drilling deeper — raw endpoints

The markdown snapshot is comprehensive but rolled up. For drill-down questions, hit the underlying endpoints directly.

| Question                                                | Endpoint                                                       |
| ------------------------------------------------------- | -------------------------------------------------------------- |
| Full JSON snapshot for a year (feeds downstream skills) | `GET /api/financial-snapshot/<year>?format=json`               |
| Token-efficient flat format for LLM consumption         | `GET /api/financial-snapshot/<year>?format=toon`               |
| List all entities                                       | `GET /api/entities`                                            |
| Files for an entity + year (parsed + raw)               | `GET /api/files/<entityId>/<year>`                             |
| Parsed data for one document                            | `GET /api/parsed/<entityId>/<path>`                            |
| Mileage ledger                                          | `GET /api/mileage`                                             |
| Sales ledger                                            | `GET /api/sales`                                               |
| Precious metals inventory                               | `GET /api/gold`                                                |
| Real-estate properties                                  | `GET /api/property`                                            |
| Additional income (recurring sources)                   | `GET /api/income`                                              |
| Live quant signals (BTC, macro, sector rotation)        | `GET /api/quant/...` — see `/strategy` skill for the full list |

Prefer piping through `node` or `jq` rather than dumping the whole JSON into context. The TOON format is ~60% fewer tokens if you need to feed a large year into a subagent or another skill.

## Format options

| Format         | Default content-type | Use when                                    |
| -------------- | -------------------- | ------------------------------------------- |
| `?format=md`   | `text/markdown`      | Presenting to the user (readable tables)    |
| `?format=toon` | `text/plain`         | Feeding to another LLM step (lowest tokens) |
| `?format=json` | `application/json`   | Programmatic post-processing                |

## Notes

- Endpoint base: `${DOCVAULT_URL:-http://localhost:3005}/api/financial-snapshot/<year>`.
- Data sources consolidated (per `server/routes/financial-snapshot.ts`):
  - Parsed tax documents (W-2, 1099s, K-1s, receipts, invoices, mortgage statements)
  - Sales & mileage ledgers, business assets, retirement contributions (Solo 401(k), IRA, etc.)
  - Brokerage holdings, crypto balances, precious metals, real-estate equity
  - SimpleFIN bank account balances + account annotations (rates/types)
  - Crypto cost-basis gains from Koinly exports
  - Bank-statement deposit reconciliation (quarterly + Form 2210 periods)
  - Tax summary (wages, Schedule C, cap gains, SE tax, estimated AGI)
  - Upcoming reminders/deadlines

## Privacy reminder

The payload contains real financial records, account numbers (partial), and tax data. Do NOT paste output into external tools, chat interfaces, or commit it to a repository. Keep the snapshot in-session.
