# Daily News — Forecaster Roadmap

The Daily News edition has a forward **"Forecast & Opportunities"** desk that
reasons about what's likely in the next day-to-week and what the reader could do
about it. It synthesizes from data already in the digest. This doc tracks the
remaining phases that turn it from a _sharper synthesizer_ into a true
_forward predictor_.

## ✅ Phase 1 — Forecast synthesis section (shipped)

Prompt-only change in `server/daily-news.ts` (`buildSystem()`): a
`## Forecast & Opportunities` section, all five domains, each item =
forward call + timeframe → concrete option → sizing → bull case + key risk →
confidence. Risky-instrument traps (far-OTM / short-dated options) are named and
the lower-risk expression preferred. The weekly "Looking Ahead" folds into it.
A narrow exception to the no-speculation rule lets this one section reason
forward — but only from facts/dates/odds already in the digest. No UI/email/store
changes (any `##` section renders automatically).

## ⬜ Phase 2 — Catalyst calendar inputs (the real predictor unlock)

Daily News runs with `web_search` **off** by design, so it only knows what
scrapers already filed — which is why a knowable event (e.g. an IPO with an
S-1 on file weeks ahead) can slip by. The fix is forward _inputs_, not better
prose.

- [ ] **Catalyst calendar feeding the digest.** New `gather…()` desk (follow the
      `gatherMarkets` pattern in `server/daily-news.ts`) that surfaces forward-dated
      events: earnings dates, IPO calendar, Fed / economic-release calendar, crypto
      token-unlock schedules, and the reader's own DocVault reminders/deadlines.
- [ ] **Bounded `web_search` "lookahead" pass.** Borrow the Deep Research engine
      (`server/deep-research.ts`, which already has `web_search` on) to scan for
      upcoming catalysts on the watchlist / current holdings, capped tightly
      (small search budget), and file the results as digest input for the
      Forecast desk to reason over.
- [ ] Relevance-filter catalysts to the reader's watchlist tickers and holdings so
      the desk stays personal, not a generic market calendar.

## ⬜ Phase 3 — Forecast ledger + calibration

- [ ] Persist every forecast / opportunity item to a store (mirror the
      `deep-research-store.ts` / daily-news-store pattern).
- [ ] Score them after the fact and surface a hit-rate / calibration view —
      same idea as the politics copy-trade leaderboard — so the desk earns or
      loses trust with evidence over time.

## Architecture notes (for whoever picks this up)

- `gatherDigest()` (`server/daily-news.ts`) runs all desk-gatherers in parallel
  into a `Digest { sections }`. Add a new desk by writing a `gather…()` and adding
  it to the `Promise.all` + the `desks` array.
- Prediction markets are already wired: `server/prediction-markets.ts`
  (Kalshi + Polymarket, one market per watchlist topic), pulled via `gatherMarkets`.
- Provider routing is 3-way (api / claude / codex); `web_search` is off for the
  edition synthesis — keep it off there and isolate any web lookahead to its own
  bounded pass.
- The Newsstand UI (`src/components/DailyNews/DailyNewsView.tsx`) and the Resend
  email both render any `##` section, so new forecast content needs no render work.
