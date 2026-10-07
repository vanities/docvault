# iOS feature parity audit

The initial app had native document workflows and a web workspace. That was not
native feature parity. This implementation adds native destinations for all 43
web navigation areas and 127 resource sections, backed by the existing server.
Counts describe coverage, not proof that every workflow works with live data.

## Implemented capabilities

| Area                        | Native workflows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Verification and remaining differences                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documents                   | Entity/folder browsing, global search, Quick Look, sharing, multiple-file Files import, Open In, camera PDF scanning, notes/tags, inclusion in totals, reviewed rename/organization by entity/year/type/category, saved-extraction filename suggestions, move between folders/entities, delete, parse, parsed data, fill/flatten/save PDFs, selection-based move/tag/parse/delete/ZIP, batch parsing and CPA package download                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Document UI tests, partial upload/retry and bulk action checks, and real-handler upload/download, tags, moves, ZIP export and PDF fill tests. Latest organization/tracking source passes standalone native and actual-handler contract checks; its iOS build and rendered UI review remain pending. Camera scanning needs a device. AI parsing needs configured providers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Portfolio                   | Net worth and allocation, balance history, exact 1D/7D/calendar-month changes, partial-data errors, snapshots, links to each asset category                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Historical balance and missing/zero baseline unit tests; simulator screenshots. Balance changes include account activity.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Banks and brokers           | Currency-separated bank summaries, institution balance charts, account detail/notes/categories, brokerage account allocation and fixed-value accounts, holding search/sort/detail, recorded balance history and snapshot comparisons, 1D/7D/1M holding price changes, activity, connection health/setup/removal, sync and manual account management                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Synthetic real-handler and simulator checks cover currency boundaries, zero/missing balances, note editing, fixed accounts, holding price changes and saved manual-holding quantities with refreshed values. Read-only NAS cache adapter checks also pass. Live connection setup, reconciliation and sync remain unverified.                                                                                                                                                                                                                                                                                                                                                            |
| Crypto, metals and property | Holdings/gains/yields, exchange/wallet/manual connection management, metals and properties editing, mortgage details and amortization                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Catalogue/form tests and offline route audit; loan calculator unit tests. Live prices, exchange access, chain indexing and yields remain unverified.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Income, debts and strategy  | Income sources, liabilities, debt service, extra-payment amortization, strategy notes and regeneration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Native income create/edit/delete UI test and calculator tests. AI generation needs providers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Quant                       | Date-based interactive charts with fixed/custom UTC windows, series/log controls, filled bands, recession/inversion shading, window statistics and dated events, BTC regression/bands/risk/crosses, macro series, yields/real rates/Fed policy, rolling ROI, drawdowns, sentiment/hash ribbons, cycle heatmap, sector rotation, dominance/altcoins, research tickers and source notes, snapshots/research, combined 28-signal overview with category/search controls and source errors, published macro releases with previous-result/chart drill-downs                                                                                                                                                                                                                                                                                                                                    | Synthetic cached responses through the real handler validate chart adapters. Unit checks cover alignment, missing values, percent units and separate axes. Simulator checks cover series/history controls, exact values, cycle cells, sector periods and research links. Simulator checks also cover the combined overview and release-calendar filters/result/chart drill-downs. The latest band/shading/window/statistics UI has not passed an iOS build or rendered review. Foundation checks cover gap-safe fills and exact window semantics. Upstream images and live providers remain unverified.                                                                                 |
| Tax and business            | Entity/year Tax Year overview, income and deduction charts, parsing coverage, receipt and source-document drill-downs, invoice/customer charts, parsed deposit coverage, retirement contributions, complete recorded fields, CPA and filtered ZIP exports; filing reminders, shared to-dos, entity text/list metadata and tax-folder uploads (latest source, unrun in iOS); financial summaries, analytics, business/all-file browsing, parsing, Tennessee FAE170 worksheet and assets, Solo 401(k) calculations/contributions, estimated payments, filed/projected federal returns                                                                                                                                                                                                                                                                                                        | Real-handler tax tests cover capital-gain accounting, excluded documents, same-path entity boundaries, verified zero versus unparsed deposits, protected sources and CPA/ZIP downloads. Phone/iPad flows cover year review, income/receipt/source/PDF navigation, search, invoice/deposit/retirement charts and CPA export. Formula, source-selection and form tests. Worksheets auto-populate from analytics and parsed documents, retain session overrides, link to saved assets/contributions, and share complete Tennessee schedules. Contribution scope is combined across businesses. Simulator workflow checks cover source defaults, overrides and required installment fields. |
| Sales and mileage           | Entity/year and all-year review, current-month and all-time statistics, revenue/distance charts by month and product/customer/vehicle, saved-record details, customer suggestions, product and vehicle management, direct/odometer trips, optional fuel readings, configured mileage estimates, saved addresses, address search, route calculation and editable trip drafts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Invented records through the real handler cover saved sale totals, price/quantity changes, clearing observations, zero versus missing amounts, entity/year boundaries and product/vehicle/address CRUD. Address and route responses are simulated; live provider results remain unverified. Mileage estimates apply the currently configured rate to the selected records, rather than assigning historical rates.                                                                                                                                                                                                                                                                      |
| Timesheets | Clients, projects/sub-clients, timed and duration-first entries; dedicated invoices with currency-separated totals, monthly charts, history filters, full lines, prior-billing/retainer/VAT create review, actual PDFs, status/comment edits, substituted email composition and retained-path filing; dedicated reporting with charts, full exports, scope/rules and recipient review; hours/billing analytics | Actual handlers cover billing locks, privacy scopes, PDFs, native create payloads, retainer/tax/template defaults, email drafts and releasing entries. Latest model/contract checks pass; iOS compilation, phone/tablet layout and real-NAS review remain pending. Provider/inbox delivery remains unverified. |
| Calendar                    | Month grid, agenda, recurring events/tasks, upcoming items, complete/reopen, holiday/moon/eclipse/season/meteor/DST/weather overlays, sunrise/sunset, zodiac/Mercury, shared layer settings and to-do list                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Real-handler recurring-task and almanac tests, native layer-control checks, timezone/DST and astronomy reference tests. Forecast provider outcomes remain unverified.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Health                      | People management with distinct archive and permanent-delete controls; parsed-export source browsing; person overview; activity, heart, sleep, workout and body trends with date axes, history/series selection, exact inspection and units; period comparisons, scores, daily/night/workout/type/source drill-downs; detected-illness notes/dismissal; clinical lab flags, trends, dated reference ranges, panels, composite vitals and condition/medication/immunization/allergy/procedure/document history; XML/ZIP imports, sync setup, DNA/ancestry, sickness, analysis, research and voice                                                                                                                                                                                                                                                                                           | Fabricated snapshots and clinical records through the real handler verify person boundaries, null/zero handling, mixed units, composite blood pressure and note persistence. Native simulator flows cover the specialized screens. Sync uses the existing Shortcut/companion rather than an embedded HealthKit reader. Device recording and live analysis/transcription need separate checks.                                                                                                                                                                                                                                                                                           |
| Nutrition                   | Person-scoped product library; time-of-day regimen groups; search/status/category filters; library charts and dose-details ring; authenticated front/facts photos; per-serving macros, nutrients, daily-value charts, blends, ingredients/allergens/warnings; research, references and PubMed/DOI links; focused label/regimen correction, dose clearing, product creation/deletion, image import/replacement and reparsing                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Synthetic real-handler tests verify person boundaries, protected image authentication, full-label preservation, changed-field checks, unrelated research updates, text-product defaults, photo replacement and retained records after parse failures. Phone/iPad UI flows cover filters, facts/photos/references, persisted regimen edits and create/delete. Values describe a recorded regimen and printed serving, not actual consumption. Live AI extraction and device photo workflows remain unverified.                                                                                                                                                                           |
| Predictions                 | Finance/politics and provider filters, search, volume/probability/movement ranking, biggest movers, probability bars, close/liquidity details, source links, provider errors and stale/cache states                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Unit checks distinguish 0–100 probabilities from percentage-point changes, preserve missing data and provider identity, and test ranking. Real-handler and iPhone/iPad flow checks use invented markets and a partial provider failure. Live provider outcomes remain unverified.                                                                                                                                                                                                                                                                                                                                                                                                       |
| Research and news           | Domain-isolated inboxes, monthly/publisher/format/stance charts, metadata and text readers, cited summary/claims with quote verification, tagged price cards, PDF/media batch imports, text/YouTube imports; Deep Research and Daily News history/status dashboards, questions/images and job progress, native rich reports/tables, source ledgers, HTML exports, weather/sun/calendar sections, narration seeking/speed and explicit email actions                                                                                                                                                                                                                                                                                                                                                                                                                                        | Synthetic real-handler tests cover domain isolation, import/edit/delete, authenticated source bytes, job completion/failure, image-only research, report exports, narration bytes and source warnings. Live research/collectors, extraction/transcription providers, theme-sample generation, narration generation and outbound delivery remain unverified.                                                                                                                                                                                                                                                                                                                             |
| Politics                    | Activity/feed, member disclosure and consensus explorers, simulated stock/option-underlying performance, trade filters, archived PDF/text sources, authenticated member portraits and initials fallbacks, linked-research asset/topic signals and evidence charts, source claims/text, matched bill summaries and official links                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Real-handler tests verify scoped disclosures, simulations, claim joins, saved source text, portrait authentication and missing images. Simulator flows verify research filters, bill/source drill-downs, portrait/fallback and consensus-to-member navigation. Upstream collection and portrait-provider outcomes remain unverified.                                                                                                                                                                                                                                                                                                                                                    |
| Chat                        | Native streaming messages/tool activity, PDF/image attachments, thread history/resume/rename/delete, entity context, voice-to-text draft, cancellation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Real-handler thread persistence and native navigation checks. Live Claude/Codex streaming and transcription remain unverified.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Sources and administration  | Brain and Skills content statistics/charts, formatted/plain readers, replacement/append and skill CRUD editors with draft protection; repository saved-sync/file charts, folder browsing, search, Markdown/wiki links, sync diagnostics, connections and write-only tokens; entities, focused AI/chat, voice/email/location/market settings with protected drafts and partial patches, credential configuration charts, native mail outcome/purpose/date charts and saved attempt details, schedules, Dropbox, encrypted backup/restore and server Codex sign-in. Dedicated operations dashboards add job/outcome/schedule charts, custom manifest/script editing, manual and dry-run results, retry and clean-success timestamps, invalid manifests, retained run diagnostics, historical log browsing/filtering/sharing, cache timestamps and API usage/token/model/purpose/cost charts. | Synthetic real-handler checks cover memory replacement/append/clear, skill CRUD, safe repository paths, shortened previews, write-only tokens, preserved source files after sync failure, schedule preservation, encrypted backup/restore, authenticated settings, custom scripts with partial collections, dry-run status preservation, script-preserving edits, missing scripts, stored history, usage summaries, unknown prices and historical logs. Live NAS scripts, authentication flows, providers and outbound delivery remain unverified.                                                                                                                                      |
| Privacy and connection      | URL validation/base-path support, shared authenticated API session, device-only Keychain, expired-session sign-out, optional device unlock, app-switcher cover, protected temporary previews, number blurring, separate synthetic demo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Session/URL/demo tests and simulator connection checks. Physical-device biometrics, camera, microphone and background/foreground behavior need hands-on verification.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Verification

Pre-commit validation on 2026-10-07 compiled the app and both test targets for
the iPhone Air simulator. Swift Testing reported a successful run of 233 tests
in 23 suites, with 39 opt-in integration/live tests skipped. Both focused calendar
UI regressions passed after the search helper was updated to reveal collapsed
search fields. The full UI run was interrupted after those selector failures;
the remaining latest UI workflows and live-vault/device/provider checks still
need verification. Web checks, the production build, and 1,797 web tests passed
(two web tests skipped). Earlier batch notes below predate this validation.

The synthetic fixture runs the actual Bun request handler against a temporary
vault. It blocks external network access, has no household documents, and does not start
scheduled jobs. Route and address checks simulate Geoapify transport responses
while exercising the real server handler; they do not verify live provider results. Integration tests accept only its documented loopback address.

- 232 non-live Swift test cases are now defined (233 including the opt-in live
  audit). The latest full iOS run passed 142 before eleven Provider/Mail,
  ten Tax Workspace, fifteen Document Import, twelve Quant Chart, fifteen Document Organization, fifteen Timesheet Report and twelve Invoicing cases were added; those 90 new cases still need
  the iOS runner. Existing cases exercise catalogue coverage, API and form contracts, calculations,
  privacy/session behavior and selected backend workflows. One additional opt-in
  live audit is skipped in synthetic batches and run separately against the NAS.
  The Health adapters also preserve a fabricated 4,000-day history and its missing
  observations. Health chart preparation runs away from the main thread and is
  retained for the loaded snapshot. Research tests also cover strict domain
  filtering, exact UTF-16 quote ranges, MIME validation, protected source bytes,
  empty-file errors, metadata changes, background-job acknowledgements, saved
  failures, weather, warnings and exports.
- Fifty-seven previously exercised simulator UI cases cover the document flows, native income management, Tax Year charts/source entities/deposit coverage/search/CPA exports, consolidated finances with currency and fixed-account boundaries, year-scoped contributions/business records and reminders,
  conversation history/renaming, PDF fill/save-back, connection/settings, and
  calendar weekday layout, overlays/layer toggles, multiple uploads with partial failure/retry, bulk move/tag/delete, workspace file selection/ZIP export, worksheet defaults, contributions and schedules, Quant history/series controls and exact observations, cycle/sector exploration, research ticker/source reading, political member/consensus/simulation flows, authenticated portraits and initials fallbacks, linked-research filtering and saved-source reading, matched bill summaries, trade filtering and filing previews, overview signal/chart navigation, prediction source health/category/detail flows, published macro dates/previous prints, Health period/person boundaries, sleep/workout/body reading details, clinical tabs/panels/composite vitals and persisted illness notes, currency-separated bank charts and account notes, fixed brokerage accounts, holding price history, nested holding edits and refreshed values, and opening all 43 native destinations with no web view.
  Nutrition flows include person/status filtering, authenticated label photos, per-serving facts,
  research references, persisted schedule edits, dose clearing and product creation/deletion.
  Sales/Mileage flows add monthly/category charts, scoped history, saved-price
  behavior, large quantities and sale creation/deletion, zero versus missing mileage,
  odometer changes, cleared observations, rates and route/address exploration.
  Four Research/News cases add domain-scoped source libraries, chart/filter
  controls, exact quoted evidence, native text/table reading, protected source
  files, metadata/import/delete flows, cited report generation and HTML export,
  plus news weather, calendar, source warnings, saved audio and generation.
  Four Brain/Skills/Repository cases add failed-save recovery, append and discard
  protection, native skill creation/editing/deletion, repository addition/removal,
  write-only tokens, folder search, interactive relative/wiki links and
  cached-source preservation after sync failure.
  Two operations cases add job outcomes/schedules, invalid manifests, retries,
  saved run diagnostics, custom job edits, actual dry-run results and missing-script
  acknowledgements, plus historical logs, severity filters, priced/unpriced API
  calls and system/cache status.
  A separate iPhone run at the largest accessibility text size exercises synthetic
  server sign-in, Nutrition metric cards, charts, dose details, filtering and
  person switching. Screenshot review caught icon overflow, crowded chart labels
  and a truncated dose count; the shared cards and Nutrition layouts now adapt
  to that size. This selected review does not establish accessibility coverage
  for every screen.
  iPhone and iPad runs are serial because their automation sessions share host
  keyboard/accessibility state.
- The earlier 124-section read audit produced 89 successful responses, 8 absent-import
  responses, 12 unconfigured-service responses and 15 blocked-provider responses.
  Missing configuration and blocked providers are not successful data tests.
- Web verification uses `vp check`, the backend-inclusive `vp run check`, and
  `vp test` (1,796 passing tests, 2 skipped). The noisy-job output fixture uses
  the running JavaScript executable so it does not depend on the host Python binary.

Workflow checks use iPhone Air and iPad Pro 13-inch simulators with iOS 26.5.
The navigation smoke check also passed on an iPad with iOS 27. Full and targeted
runs together verify the iPhone cases. The full iPad run passed all 102 tests
(74 Swift and 28 UI), with no failures or skips. Subsequent runs verify the
then-current 98 Swift tests, three additional Politics UI cases, three finance UI
cases, four Nutrition UI cases and affected workflows on both screen sizes; targeted chart checks also
pass. Finance checks include a saved quantity change followed by a real-handler
portfolio refresh. Worksheet fixture resets prevent previous device runs from
adding to the next test's contribution totals. Political flows include an
unavailable collection with no invented evidence chart. Selected
workflows are not tests of every possible action in every resource section.

The Nutrition regression batch on 2026-10-07 passed 98 checks on phone: all 92 Swift tests and six UI
flows covering Nutrition, authenticated connection/PDF/settings, and worksheets.
The Nutrition tablet batch passed 95 checks (92 Swift and three affected UI flows),
followed by a passing bank-chart/note UI check. The largest-text phone review
also passed separately. These are selected regression batches, not a rerun of
all UI cases together.

The regular-size Tax Year phone regression batch on 2026-10-07 passed 101 checks:
all 98 Swift tests, both Tax Year UI flows, and the shared worksheet flow.
Tax Year checks pass all 98 Swift tests on phone
and tablet and both new UI cases on each device in selected runs. They exercise
income/deduction charts, verified zero versus unavailable statement amounts,
source/receipt/PDF navigation, same-path entity candidates, retirement and invoice
summaries, source search dismissal, complete recorded fields, an empty year, and
CPA package download. Search dismissal uses the native iPhone Close control and
the iPad Done control. The earlier phone navigation smoke batch also opens all
43 destinations successfully. These selected runs do not rerun all 40 UI cases
together or establish every action variant. The full income/deduction, receipt,
source/PDF and cross-entity UI flow also passes on phone at the largest
accessibility text size. A protected Options sheet keeps scope selectors from
consuming the content area, and the Tax Year category menu stays in the toolbar.
Large charts use short numbered category labels linked to the full amount list,
with two numeric endpoint labels. Exact category names and amounts remain available.

The Financial Summary regression batches on 2026-10-07 each pass 106 checks on
phone and tablet: all 103 Swift tests and three financial UI flows. They exercise
fixed brokerage values, separate bank currencies, signed USD totals, debt
service/income records, tax projections, quarterly business records, missing
statement coverage, combined and prior-year contributions, filing-season
reminders, preserved entity/year navigation, and the Debt Service, Income &
Limits and Projected Return entry points. A separate phone regression also
passes the shared Tax Year income/deduction/source/PDF/entity flow after the
amount chart was shared between dashboards. Follow-up chart checks pass both
financial overview/business flows on phone and all 103 Swift tests with selected
financial flows on tablet. Screenshot review verifies unclipped amount-axis
labels in phone and tablet layouts. The overview/history/currency/fixed-account/
debt-service flow also passes on phone at the largest accessibility text size.
Its protected Options sheet leaves room for the content, history axis labels
stack month and day, and daily record dates wrap between words. These selected
checks do not establish accessibility coverage for every screen. These batches do not rerun all 43
UI cases together or exercise every provider-backed action.

The Sales/Mileage checks on 2026-10-07 pass all 113 Swift tests and four new UI
flows on phone across selected runs. The tablet batch passes all 117 checks
together, with no failures or skips. These cover entity/year/all-year boundaries,
current-month summaries, monthly and product/customer/vehicle charts, historical
sale-price preservation, quantity repricing, creation/deletion, zero versus absent
distance, odometer edits, fuel clearing, saved rates, saved addresses, address
search and editable route drafts. Simulated provider transport exercises the real
route/address handlers, including empty, failure and unconfigured states; this
does not verify live address or route services. The unsigned Release build also
passes after these changes. The Sales chart/history/year/entity flow and Mileage
chart/odometer/clearing/rate/year/entity flow also pass separately on phone at the
largest accessibility text size. Reviewed layouts stack metric cards, retain
readable chart endpoints and link numbered bars to exact values below the plot.
These selected checks do not establish accessibility coverage for every screen.

The Research/News checks on 2026-10-07 pass all 125 Swift tests on phone and
tablet, including real-handler source upload/download, exact byte preservation,
corrupt-PDF extraction errors, empty saved source recovery, strict domain
isolation, metadata changes, research job input limits and completion/failure,
news source warnings, saved weather/audio and HTML exports. Four new UI flows
pass on both devices across selected runs. The final phone and tablet batches each pass all 127
checks together (125 Swift and the source-library/news flows). Earlier selected runs pass report creation/export/delete
and scoped Health source creation/edit/delete on each device, plus the affected
phone ticker and political saved-source flows. Research filters use a protected
sheet; sheet controls are reached by scrolling when they exceed the viewport.
Phone screenshot review caught a truncated exact quote; quoted evidence now
wraps to its full height. At accessibility text sizes, the Research section
selector moves into the toolbar, chart captions retain exact numbered values,
weather labels stack month and day, narration uses named icon controls, and
report headings avoid doubling the already-large body size. The source-library
and report-generation/export/delete flows also pass on phone at the largest
accessibility text size, followed by a passing news reading/weather/warnings/
playback/confirmation/generation flow with the revised layout. These are selected
accessibility checks. Narration downloads retain the saved WAV or MP3 extension
and reset the protected player when a refreshed audio file changes.
The unsigned Release device-target build also passes with the native rich-text
dependency and bundled open source notices. Tests use deterministic generators
and four seconds of silent WAV data; they do not verify provider research,
spoken narration generation or mail delivery. No email was sent.

The Operations/Administration checks on 2026-10-07 pass all 134 Swift tests on
phone and tablet. Both new UI flows pass on phone across selected runs; the tablet
batch passes all 136 checks together, with no failures or skips. They exercise
job outcome/schedule charts, invalid manifests, retry/clean-success dates, retained
history and diagnostics, native custom-job edits that preserve an unchanged
script, real dry-run results and explicit acknowledgements for saved jobs with
missing scripts. Logs retain historical-day selection and severity filters. API
usage keeps complete summary totals separate from recent calls, preserves unknown
prices and zero latency, and charts fractional-cent priced costs. System/cache
cards show only data-directory/session status and saved cache timestamps.
The fixture executes print-only synthetic scripts through the actual server job
runner. A run with exit code zero and a failed collection item remains partial;
a dry run preserves saved status. No scheduled jobs, live provider calls, mail
or NAS changes occur. At the largest accessibility text size, Server Settings moves the section control
to the toolbar and opens its existing searchable, protected chooser for the longer
section list. Selection reaches Jobs and Logs in the accessibility runs. The full
large-text operations flows remain incomplete: the scroll harness was corrected
after viewport failures, and the latest run was stopped to restore the preview’s
normal text size. No operations accessibility pass is claimed.
The unsigned Release device-target build and Swift format
check also pass after this batch. Web checks pass with 1,796 tests and 2 skips.

The Brain/Skills/Repository batch on 2026-10-07 passes all 142 enabled Swift
checks on phone and tablet, with the opt-in live audit skipped. Four new phone UI flows pass
across selected runs. They cover memory preview/replacement/append, failed-save
draft recovery, discard protection, skill creation/editing/deletion, repository
addition/removal, write-only token saving/removal, folder browsing and cross-folder
search, relative/wiki link taps, plain-text reading and cached pages retained
after sync failure. A minimized link regression first failed on an actual tap;
disabling the rich-text selection overlay alone made it pass. Formatted readers
now preserve interactive links, with selectable Plain text and sharing available
separately. The affected phone Research and News reader workflows also pass.
Search submission restores the navigation toolbar while preserving the query;
the phone setup flow explicitly dismisses search and reveals offscreen controls.
The unsigned Release device-target build and Swift format check pass.

Three new tablet UI flows pass across selected runs: Brain/Skills editing,
repository reading/search/link navigation/sync failure, and the minimized link
regression. Twenty-five tablet captures were reviewed alongside the 30 phone
captures. Tablet repository addition and removal succeeded before its token setup
case failed while dismissing an empty search. The saved recording shows the
disabled Search key and the separate keyboard-hide control. The harness now uses
that control, but its rerun and five tablet setup captures remain pending.
Simulator services became unavailable under the session's current permissions;
the failed attempt is retained and no passing tablet token test is claimed.

The additional read-only NAS administration audit reads the actual Brain, all
saved skill instruction files and the current repository index, plus one saved
source page. The live Brain/Skills/Repository UI case passes
with the saved connection and normal text size, including unchanged editor
preview/cancel and native saved-content readers. An initial run timed out in
Health Research and during connection restoration. The simulator reconnected on
relaunch; a repeat native audit decoded all 127 sections with no unavailable
responses or server-reported errors, followed by the passing UI flow. Both runs
remain in the private audit directory. This records a successful retry, not a
network-reliability guarantee. A stricter chart-framing check was added to the
live UI harness to capture complete memory and instruction-size plots. That
additional screenshot run remains pending; the earlier passing reader flow is
not evidence of a complete live chart visual review.

The live NAS checks on 2026-10-07 use a separate simulator connected to the
maintainer's actual server at normal text size. The earlier two opt-in UI cases pass: all
43 native destinations open without a WebView, and Operations displays saved
job outcomes/history, API usage charts and system/cache status. Eighteen private
screenshots were reviewed locally, including populated portfolio, bank,
brokerage, Tax Year, Heart, research and news dashboards. The native API audit
decodes all 127 resource sections with no request failures or top-level
server-reported errors; 33 sections have populated declared collections. Its
bank, job and usage adapters also pass finite-value and count checks. The final
read-only batch passes 21 Swift checks: the opt-in live audit and 20 affected
catalogue/Operations checks. Empty collections and a missing saved return remain
unavailable data, not successful provider tests. These checks do not save or
delete records, run jobs, refresh providers or send mail. Live results and
screenshots stay under the gitignored `data/_audits/` directory; public gallery
images continue to use invented data.

XCTest still reports an invalid-frame warning while automatically scrolling to
the server-address input during sign-in. Those connection flows pass; the warning's
origin has not been isolated.

Simulator screenshots in this directory use invented demo or fixture records.
The test results are local XCTest bundles, not proof of a device release. The
earlier generic-device Release build passed with signing disabled before the
Provider/Mail, Tax Workspace, Document Import, Quant Chart, Document Organization, Timesheet Report and Invoicing changes; the latest implementation has not passed an app build.

The Provider/Mail implementation adds five focused settings screens, grouped
editors, credential configuration charts, draft/discard guards, partial nested
saves and explicit test-email review. Task model editors add discovered model
choices with live/cache/fallback provenance, per-provider reasoning effort,
custom model inputs and server-default resets. News appearance adds theme-cycle
and image-model choices. Model-reference edits preserve saved effort unless
explicitly cleared, and every preference save requires server confirmation.
Sent Mail adds filters, recorded-outcome,
purpose and daily-attempt charts, full recipient/error/context details and
attachment metadata. Its log distinguishes provider acceptance from inbox
receipt and retains up to 500 attempts; it does not contain message bodies or
attachment bytes. Eleven case bodies reuse the new test source in a standalone
Foundation runner, passing 71 assertions, including separate CC preservation,
model/effort clearing, discovered-list provenance, confirmed-save responses,
missing defaults, credential status changes, zero latency,
invalid timestamps and timezone boundaries. This is not a Swift Testing or
simulator pass. The subsequent Tax Workspace batch combines those eleven case
bodies with eight new ones: 19 Foundation case bodies pass 123 standalone
assertions. Twenty-eight actual Foundation model files, including the provider
and tax-workspace demos, typecheck under Swift 6; UI-dependent demos are outside
this check. That batch passed syntax parsing for all 121 Swift files. Full app compilation
and framework tests are blocked by compiler macro-helper sandbox restrictions
and unavailable simulator services. Fifteen additional synthetic UI cases (72 now
defined) and six additional read-only NAS UI cases (nine now defined) are
prepared but have not run. Nine new UI-dependent/integration cases also require the
iOS runner. No mail was sent and no NAS setting was changed.
The earlier Release build and installed real-NAS preview predate all seven latest batches.
The preview's saved connection matched the selected real NAS at the earlier
verification. A fresh SSH
connection was denied with `Operation not permitted`. Session access has not
changed, and the new live readers, Quant, document, report and invoice reviews remain unrun. A limited typecheck against the earlier compiled app module
also stops at the blocked SwiftUI State macro helper; it is not a UI typecheck
pass. These restrictions do not change the primary target to demo data.

The Tax Workspace implementation adds scoped filing reminders and shared vault
to-dos inside Tax Year, with reminder urgency and pending-task statistics. A
reminder can repeat monthly, quarterly or yearly, complete or dismiss one dated
occurrence, and optionally record a reviewed estimated-tax payment. Global
to-dos can be added, completed, reopened or deleted. Reminder dates use the
server's calendar rather than the device's timezone. Estimated-payment failures
remain explicit even when the reminder completion succeeded; payment retries
use a stable occurrence ID and preserve the latest payment list and config.
The server's whole-list estimated-payment write still has no atomic compare-and-swap
contract, so client preflight checks do not establish cross-client atomicity.

Entity details now have a dedicated reader and editor for identity, descriptions,
text metadata and text lists. Sensitive fields start fully masked; revealing them
is explicit. Saves send changed fields and explicit removals, preserve unrelated
structured metadata, and reject changed-field conflicts found during preflight.
Tax folder shortcuts retain the selected entity and year for Files/camera uploads,
with all fifteen canonical folders and a synthetic sample option in demo mode.
Upload review can change the entity; unavailable targets require a new choice.
Raw demo uploads now appear as unparsed documents in their selected tax year, without
inventing extracted totals. These new screens and upload integration have not
been compiled, installed or visually exercised. The subsequent Document Import implementation closes the classification,
naming and extraction source gap described below; its UI verification remains pending.

Document Import now has a native classification/naming review for all 30 document
types and 16 expense categories, standard source/type/date filenames, per-file
folder previews and optional automatic organization. Tax Year adds an automatic
organizer alongside explicit folder shortcuts; its imports use extraction by
default. General library uploads retain raw-upload mode and an optional extraction
switch. Naming analysis sends raw bytes through the existing server endpoint;
protected staged files stay on disk. PDF and common image formats support naming
analysis. Other formats retain manual classification and attempt the server's
parser after upload; unsupported/provider failures remain visible. Naming analysis
uses the existing 512 MB native import ceiling, while document upload retains 2 GB.

Late suggestions preserve every user-edited naming field. Original files can be
previewed before upload; pending files can be removed from the batch and restored.
Extracted records remain available for complete review. Saving parsed data uses
the confirmed server-returned path, including collision suffixes, and preserves
reviewed document type/category without inventing amounts for missing extraction.
Parsing-only retries retain the saved entity and path and skip confirmed uploads.
A saved-but-unparsed file requires a successful retry or an explicit keep-unparsed
choice. Parsed markers alone do not count as extracted fields. Successful fallback
extraction is cached for a failed save retry. Source implementations also guard
against a server-session change between upload and subsequent parsing.

The formatted current Foundation sources compile in a standalone runner: 31 case
bodies pass 192 assertions, including twelve new import case bodies. An additional
1,106 comparisons exercise the current web helpers against native names, folders,
classification, source extraction and taxonomy for 480 type/category combinations
and 48 filename/path cases. These are model/contract checks, not iOS execution.
The three new API/VaultModel tests, two new UI cases, shared-upload regressions,
physical-device imports and configured-provider outcomes remain unrun. Existing iOS
screenshots and the installed NAS preview predate this implementation; no new
import-screen captures have been produced.

The Quant Chart implementation now adds custom inclusive UTC date windows,
paired filled regression/support/Mayer/corridor bands, NBER recession and observed
inversion-period shading, overlay controls, shading legends, dated event lists and
per-series window statistics. BTC and yield-curve cards show the latest source
snapshot separately from window statistics. Hidden boundaries suppress their
fills; nulls and nonpositive values break log-scale lines and bands. Recorded zero
and negative values remain in statistics and complete CSV exports. No band value
or observation is extrapolated into an empty selected window. Preparation runs
away from the main thread and source reloads invalidate the prepared chart while
preserving its controls.

The combined standalone Foundation runner now executes 49 preserved test bodies
(twelve new Quant Chart, six existing market and 31 prior bodies) and eight
comparisons against the current fabricated market fixture: 304 assertions pass.
The existing 1,106 comparisons with web importer helpers also pass. Twenty-nine
exact Foundation model sources compile under Swift 6; all 121 Swift files pass
syntax parsing. These checks do not compile or render SwiftUI. Two new synthetic
chart UI cases and a read-only live Quant case are authored but unrun. The latest
native app, screenshots and device performance remain unverified. The installed
NAS preview predates this source batch. `vp run check` passes frontend/backend
typechecking, server bundling, lint and formatting. `vp test --run` passes 1,789
cases with two skips; seven environment-dependent cases fail (Chrome startup,
local MCP sockets and Git signing). No NAS writes, provider actions or mail were
performed in this batch.


Existing-document organization now has native review of entity, year, all 30
document types, 16 expense categories, standard naming fields and the exact
final path. Rename uses the server's rename endpoint, including root files and
literal punctuation; other locations use its cross-entity move endpoint.
Source suggestions use saved extraction or an explicit parse action. Late
suggestions retain manually edited fields, and extension changes are rejected.
Dirty naming and metadata drafts require explicit discard.

Include in totals now decodes the server's tracking flag and sends only the
requested metadata fields. Unset tracking keeps the server's default inclusion;
false remains false through rename/move and subsequent note/tag edits. Demo tax
summaries apply the same exclusion rule and derive receipt groups from saved
categories. Global search refreshes after mutations while retaining its query.
Source size and modification time are checked immediately before moving. This
is a preflight check, not an atomic compare-and-swap on the backend.

A confirmed move freezes its destination. If classification fails, retry only
saves classification there, or the user can explicitly keep the moved file.
Fresh parsed values, nested fields and exact zeros survive classification
changes; conflicting type/category changes or removed extraction require reload. Unparsed documents
stay unparsed. Ambiguous unparsed type changes require a standard filename or
extraction, so marker-only records never masquerade as parsed financial data.
The existing upload draft was moved unchanged into a separate Foundation/UTI
source file so the actual native network client can be checked independently.

The current standalone runner compiles 30 exact Foundation model sources plus
VaultAPI, UploadDraft and BackupMultipart under macOS Swift 6. Sixty-three test
bodies are preserved from current test source, including twelve new organization
and two new API cases. They and eight market-fixture comparisons pass 464
assertions; the 1,106 web naming/classification/folder comparisons also pass.
The actual backend handler, invoked in-process with Swift-generated request
bodies and isolated invented records, passes 33 assertions over 14 calls. This
checks tracking exclusion from tax/CPA exports, metadata preservation, rename,
cross-entity/year/category move, classification, re-inclusion and failed move
replay. No HTTP listener, NAS write or provider request was used. This is not a
native HTTP/UI end-to-end run.

All 125 repository Swift sources pass syntax parsing, changed Swift files pass
format lint, and project generation includes the new model, view, test and
UploadDraft source. Both `vp check` and backend-inclusive `vp run check` pass.
The unchanged web test suite retains the preceding batch's 1,789 passes, two
skips and seven environment failures; blocked browser/socket/Git-signing tests
were not retried under unchanged access. Two new synthetic document UI cases,
one UI-dependent VaultModel case and one read-only live document review are
authored but unrun. The latest app build, phone/tablet layouts and NAS visual
review remain pending. No new screenshots, installation or release are claimed.


Weekly Timesheet Report now has a dedicated native dashboard with saved scope
and schedule summaries, category/day hour charts, complete entry reading,
search/category filters and full CSV/HTML exports. Search and category filters
only change the reader; exports and sending retain the complete saved preview.
Recorded zero amounts and durations remain distinct from unavailable values;
duplicate rows retain distinct identities. Duration-only work contributes to its
recorded report date without being assigned an invented clock time. Group/day
charts omit totals with missing durations rather than show an incomplete sum.

The protected report editor supports cadence, day/hour, timezone, a 1–90 day
inclusive window, recipients, client/project scopes and ordered category rules.
Archived and unavailable saved IDs remain selected. Client and project filters
intersect; empty means all for that scope, and expanding a restriction requires
explicit review. Literal commas/newlines in keywords survive unrelated edits;
recorded sub-clients outrank keyword rules, whose first match wins. Invalid
schedule fields remain visible with an error. Failed saves retain drafts;
reload/discard is explicit. Server-owned send watermarks are omitted from writes.

A send review displays the saved recipient, sender and client CC, the actual
window, scope and row count. It warns when the ending date was already accepted.
Preflight rejects changed settings, recipients, report contents or newly sent
status, and sends the reviewed end date instead of recomputing today. Confirmed
results freeze the send controls; uncertain responses direct the user to the
sent-mail log before retrying. These checks are client-side preflight, not atomic
compare-and-swap with concurrent backend edits. Actual delivery remains unverified.
The demo shares its report config, preview and simulated send watermark with the
same timesheet store; it explicitly says that no email was sent.

A real-handler check reproduced acceptance of February 29, 2026. The shared
backend timesheet date validator now round-trips the complete UTC day, rejecting
calendar overflow and timestamp suffixes while retaining valid leap/century
dates. This changes request validation only; stored records are not rewritten
or newly rejected by the store shape guard. The correction requires a backend
release before it affects the NAS.

The Timesheet Report batch standalone runner compiled 32 exact Foundation model sources plus
VaultAPI, UploadDraft and BackupMultipart under macOS Swift 6. Seventy-six
current test bodies, including thirteen new report bodies, and eight market
fixture comparisons pass 546 assertions. Ninety additional comparisons cover
the current web configuration normalization, inclusive windows, 20 scope
combinations, categorized rows, category totals, complete CSV and verbatim
exports of actual handler HTML/CSV. The 1,106 importer-helper comparisons also
pass. Sixteen in-process backend calls with native-generated payloads and
invented records pass 33 assertions, including preserved/forged watermarks,
intersection scope, impossible dates and no-recipient failures. No listener,
provider request, mail or NAS write was used.

All 130 repository Swift sources pass syntax parsing; changed Swift files pass
format lint and project generation includes the new report models, service, view
and test. Both `vp check` and backend-inclusive `vp run check` pass. Focused
Timesheet Store, Report and Billing web tests pass all 69 cases. The preceding
full web run retains 1,789 passes, two skips and seven environmental failures;
it predates this backend date correction and is not claimed as a full current
pass. Denied browser/socket/Git-signing attempts were not repeated. One new
VaultModel case, one native API integration case, two synthetic UI cases and
one read-only live report review are authored but unrun. No new build, live NAS
read, phone/tablet rendering, screenshot or installed preview is claimed.

## Native invoicing source and contract checks — 2026-10-07

Invoicing now has a dedicated dashboard with billed/unpaid totals by recorded
currency, monthly issue-date charts, search, issue-year/client/project/status
filters and date/number/within-currency amount sorting. Voided invoices remain
readable and are excluded from balances/charts. Missing totals remain unavailable;
duplicate rows keep occurrence identities. Full lines retain multiline text,
imported summaries, payment dates, accepted-email metadata and automatic filing
paths. Work periods exclude zero-minute adjustments.

Creation reviews open billable work, earlier billing exclusions, per-project
retainers, VAT and explicit/client-default/first-active template resolution. It
supports optional work bounds, number and comments, protected actual-server PDF
preview, and confirmed creation with exact reviewed entry IDs. Observed changes
require re-review; confirmed creation freezes the draft, including when a later
PDF download fails. Creation does not send email. Protected status/comment edits
preserve missing imported payment dates. Voiding retains locks; deletion releases
only linked entries, with sent mail and filed documents retained.

Email composition loads the server-substituted recipient, sender, client CC,
subject, body and PDF filename. An explicit empty CC suppresses saved CC. Final
review shows sender/recipient/CC/attachment, warns about repeat sends and freezes
confirmed results. Missing exposed sender information is labelled as configured
on the server. Client preflight checks observed invoice, PDF-template, defaults
and mail changes; it is not atomic against later backend edits. Uncertain results
direct the user to Sent Mail. Provider acceptance/inbox delivery remain unverified.

Filing chooses a tax entity/year and reports PDF persistence separately from
extraction. Parse retries retain the server collision path without another upload;
keeping the PDF unparsed is explicit. Demo invoices, entry locks, edits and
simulated sends use the same store. Demo PDF previews contain reviewed invented
lines/totals without persistence; real PDFs are rendered by the Bun API.

Thirty-seven exact macOS Swift 6 sources (34 Foundation models and three actual
network/upload/multipart helpers) compile. Eleven new preserved invoice bodies
join 76 earlier bodies; 625 standalone assertions including eight market-fixture
comparisons pass. Additional comparisons pass: 1,106 importer helpers, 90 report
helpers/actual previews and 137 current web-billing/actual-invoice/email-draft
checks. The invoice comparisons cover 27 scope/window inputs, including invalid
client/project relationships, stored periods and actual assembled values.
Twenty-two in-process actual Bun calls pass 44 assertions with native-generated
payloads and invented records: preview/non-persistence, PDF bytes, creation,
retainer/tax/defaults, billing locks, frozen lines, drafts, imported payment dates,
status changes, empty-recipient rejection, deletion and prior-entry retention.
No HTTP listener, provider request, mail or NAS write was used.

All 136 repository Swift files pass syntax parsing and changed files pass format
lint. Project generation includes the dedicated invoice models/service/views/tests.
`vp check`, backend-inclusive `vp run check` and all 74 focused billing/store/PDF/
report tests pass. One new native API integration case, two synthetic UI cases and
one read-only live invoice review are authored but unrun. The installed preview
predates these source changes. No fresh iOS build, live NAS read, phone/tablet
layout, screenshot, installation or release is claimed.

## Completion boundary

The native app now covers the broad workspace, core editing workflows and specialized Finance, Quant, Politics and Health exploration, including Nutrition and Tax Year. Financial Summary now adds a dedicated whole-vault dashboard for signed USD components, currency-separated accounts, fixed brokerage values, recorded balance history, monthly debt service, tax projections, business quarters, source-verified deposits, retirement and filing reminders. Sales and Mileage add dedicated entity/year dashboards, current-month and all-time summaries, monthly and product/customer/vehicle charts, saved-record details and native editors. Mileage includes odometer/direct entry, optional fuel observations, configured rates, saved addresses, address search and editable route drafts. Research and News now add domain-isolated source libraries, source/claim charts, native text and cited report readers, job history/composers, protected file and HTML downloads, and weather/calendar/narration details. Operations now adds dedicated job/schedule/outcome dashboards, retained history/diagnostics, custom-job editors and manual/dry-run feedback. Logs have historical-day filtering and sharing; AI usage separates known prices, recent calls and complete summary totals. Brain and Skills now add saved-content statistics, charts, formatted/plain reading, replacement and append editors, draft protection, creation/deletion and source-aware overwrite checks. External Sources adds repository and write-only token management, saved-sync/file charts, folder browsing, cross-folder search, breadcrumbs, read-only Markdown/wiki navigation and retained sync failures. Provider settings, Sent Mail and the latest Tax Year filing/entity/upload workflows and document import, existing-document organization, tracking, weekly timesheet reporting and specialized invoicing now have native source implementations; their app build and rendered UI checks remain pending. Remaining native work includes action variants and compilation, visual review and live/provider verification of the latest batches. The authenticated Full web interface is still available. See the [remaining work list](remaining-work.md). Live provider
outcomes and physical-device behaviors have not been validated. This is broad
native coverage with explicit remaining parity gaps; it is not a claim that
every feature has been tested or that the app has been released. Document imports
use protected temporary copies and file-based uploads with the server’s 2 GB
limit; a 101 MB upload and download were exercised against the real handler.
Previews and exports download to disk. Domain-specific imports also stream from protected temporary files. Their body
limit is 512 MB, including the multipart envelope for encrypted restore; voice
reference clips retain the server’s 50 MB limit. A 101 MB receipt import/download
and file-based encrypted restore were exercised against the real handler.
Multipart preparation reads in bounded chunks and removes its protected copy
on success, error or cancellation. Physical-device Data Protection
is not modeled by the simulator and still needs device verification.

The shared tax calculation now floors NIIT at zero for investment losses, matching
[IRS Form 8960, line 12](https://www.irs.gov/pub/irs-pdf/f8960.pdf). Synthetic
regressions cover losses both below and above the AGI threshold, plus positive
investment income. This companion backend correction also remains local.

Calendar overlays and selected-file ZIP downloads require the new backend routes,
and large nested imports/restore require the corrected request-body policy
in this checkout. The mileage-settings route also now takes priority over the generic trip-ID route, allowing rate edits to reach the intended handler. Research PDF extraction now copies parser input so worker transfer cannot detach the bytes saved as the source file; regressions exercise valid and malformed PDFs. Empty saved source files now return a recovery error, and the native reader also rejects zero-byte downloads from older servers. These changes have not been deployed to the NAS.

The native release calendar and web Upcoming banner consume the same public
schedule in `web/src/data/macro-release-calendar.json`. It was checked on
2026-10-06 against the [Federal Reserve meeting calendar](https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm)
and [BLS 2026 release calendar](https://www.bls.gov/schedule/2026/home.htm).
The included coverage is BLS releases in 2026 and FOMC decisions in 2026–2027.
Dates are scheduled and subject to change; later dates are not estimated.
Countdowns use Eastern calendar days and retain today across the UTC date change.
