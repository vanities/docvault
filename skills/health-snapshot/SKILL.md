---
name: health-snapshot
description: Fetch the consolidated health snapshot from a DocVault instance (Apple Health + clinical labs + DNA). Use when the user wants a full health view, or asks to drill into specific lab trends, daily segment data, or DNA details.
argument-hint: [person name or person-id] [archived|no-dna|no-clinical]
---

Fetch the consolidated health snapshot from a DocVault instance and present it.

## Setup

The skill expects DocVault to be reachable at `${DOCVAULT_URL}` (default `http://localhost:3005`). Override when running scripts directly:

```bash
export DOCVAULT_URL=http://docvault.local:3005
```

## Instructions

1. Parse $ARGUMENTS:
   - Person name or `person-xxxxxx` id → set `personId=<value>` on the query string
   - `archived` → `includeArchived=true`
   - `no-dna` → `includeDNA=false`
   - `no-clinical` → `includeClinical=false`
   - Otherwise default: all non-archived people, clinical + DNA included

2. Fetch the markdown snapshot:

   ```bash
   curl -s "${DOCVAULT_URL:-http://localhost:3005}/api/health-snapshot?format=md${EXTRA_QS}"
   ```

3. If the curl fails (connection refused, timeout), tell the user the DocVault container may not be running. Check `docker ps | grep docvault` (or `ssh <host> 'docker ps | grep docvault'` for a remote deployment).

4. Present the full markdown output to the user — do NOT summarize or truncate

5. After presenting, offer to help interpret trends (e.g. "your RHR trend is improving — want me to explain why?"), flag concerning labs, suggest questions to bring to a doctor, or recommend follow-ups based on illness periods and overdue immunizations

## Drilling deeper — bundled helper scripts

The snapshot only shows the **latest** value per lab and headline stats per segment. Use these scripts when the user asks for a trend, per-day data, or the full history of a single lab.

### List all people on the instance

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/person-ids.sh"
# → person-xxxxxx   <name>
```

Pass `--include-archived` to also list archived people.

### Trend a single clinical lab over time

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/lab-trend.sh" <personId> <labNameSubstring>
```

- `labNameSubstring` is case-insensitive. `"LDL"` matches `"LDL, DIRECT*"`; `"hemoglobin"` matches `"HEMOGLOBIN A1C*"`.
- Prints every reading with date, value, unit, flag, and the reference range.
- If no lab matches, the script prints the first ~30 available lab names for the person so you can pick the right substring.

### Raw endpoints — when scripts aren't enough

| Question                                                                                        | Endpoint                                                                                                                      |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Full daily activity / heart / sleep / workouts / body                                           | `GET /api/health/<personId>/snapshot/<segment>` where segment is `activity` / `heart` / `sleep` / `workouts` / `body` / `all` |
| Every lab test with full history, conditions, medications, allergies, immunizations, procedures | `GET /api/health/<personId>/clinical`                                                                                         |
| Check if DNA exists before fetching                                                             | `GET /api/health/<personId>/dna/status`                                                                                       |
| Full DNA traits + health + polygenic + APOE                                                     | `GET /api/health/<personId>/dna`                                                                                              |
| Re-parse from the original zip                                                                  | `POST /api/health/<personId>/parse-export` with `{"filename":"export.zip"}`                                                   |

Prefer piping through `node` or `jq` rather than dumping the whole JSON into context — per-segment payloads can be hundreds of KB.

## Notes

- Endpoint base: `${DOCVAULT_URL:-http://localhost:3005}/api/health-snapshot`.
- Formats:
  - `?format=md` — readable markdown tables (default for this command).
  - `?format=toon` — compact flat key=value lines (~60% fewer tokens; default on the endpoint itself).
  - `?format=json` — full structured response for downstream processing.
- Extra query params:
  - `?personId=person-xxxxxx` — single person
  - `?includeArchived=true` — include archived people
  - `?includeClinical=false` — skip FHIR lab/panel/condition data
  - `?includeDNA=false` — skip DNA (avoids decrypting `results.json.enc`)
  - `?includeDaily=true` — (json only) include full daily arrays
- The snapshot aggregates:
  - Apple Health headlines: activity, heart (RHR/HRV trends), sleep, workouts, body weight
  - Auto-detected illness periods and user-annotated illness notes
  - FHIR clinical records: latest lab per test (flagged high/low), conditions, medications, allergies, immunizations, procedures
  - DNA: traits, health traits, polygenic scores, APOE genotype (decrypted on demand using `DOCVAULT_MASTER_KEY`)
  - Health-tagged reminders from `.docvault-reminders.json` (keyword match on title/notes)

## Cross-reference the user's regimen before advising

If the `health-snapshot` response includes a **`nutrition`** section for the person, it contains their current supplement + nutrition regimen — what they're actively taking, what they're considering, past items, along with dose + time-of-day + notes. **Read this section before recommending supplement additions, changes, or dose tweaks.** Don't re-ask the user questions their catalog has already answered (current doses, brand preferences, what they've decided against).

The markdown format surfaces an **aggregate micronutrient totals table** across all active supplements — use that when flagging over/under-dosing (e.g. selenium stacking, vitamin E additive effects, Zn:Cu ratio).

### Standing rule: upload shared labels to DocVault

When the user shares a supplement, medication, or nutrition label in a conversation, upload it to their DocVault nutrition catalog via the API so the regimen stays accurate. Use the ingestion endpoint:

```bash
# Upload a label (saves image, runs Claude Vision parser, stores structured data)
curl -X POST --data-binary "@/path/to/label.png" \
  -H "Content-Type: application/octet-stream" \
  "${DOCVAULT_URL:-http://localhost:3005}/api/health/<personId>/nutrition/upload?filename=<name>.png&status=considering"

# PATCH after upload to set status/dose/notes (product/brand names if parser missed them)
curl -X PATCH -H "Content-Type: application/json" \
  -d '{"status":"active","dose":{"amount":2,"unit":"capsules","frequency":"daily","timeOfDay":"morning"},"notes":"..."}' \
  "${DOCVAULT_URL:-http://localhost:3005}/api/health/<personId>/nutrition/<id>"
```

The catalog becomes the durable record — no label image lives in this skill folder.

## Privacy reminder

The payload contains real clinical records and genetic data. Do NOT paste the output into external tools, chat interfaces, or commit it to a repository. Keep it in the session.
