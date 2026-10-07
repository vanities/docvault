# DocVault for iOS

Native SwiftUI app for iPhone and iPad, using the existing self-hosted DocVault
server. Follows the XcodeGen project setup used by Mango and Earmark. No additional
server, database, or paid service is required.

The Documents tab browses entities and folders, searches within folders, previews
and shares records with Quick Look, and edits notes and tags. Search looks across
all entities using the existing server search endpoint. Add documents from Files,
open a document in DocVault from another app, or scan pages into a PDF on a device
with a camera. Choose an entity, relative destination folder, and filename before
uploading. Files import supports multiple selections with per-file results and
retries that skip completed uploads. Existing filenames receive the server's
numbered suffix. Select documents to move, tag, parse, delete or export a ZIP.

Workspace has native screens for all 43 web navigation areas. Finance includes
portfolio history, account connections, asset and debt editing, and amortization.
Financial Summary includes a whole-vault dashboard for known USD net worth,
fixed brokerage accounts, separate bank currencies, historical balances, monthly
debt service, tax projections, quarterly business records and retirement.
Missing values and unparsed statements remain unavailable.
Sales and Mileage have dedicated entity/year dashboards, current-month and
all-time statistics, monthly and category charts, all-year histories and native editors. Sales preserves saved prices,
offers customer suggestions and manages products. Mileage supports direct or
odometer distances, fuel-only entries, paired MPG, vehicles, saved addresses,
editable estimates and server-backed address search/driving routes.
Tax includes a year review with scoped income/deduction charts, parsing coverage,
receipt and source-document drill-downs, invoice/deposit/retirement summaries,
CPA and filtered document ZIP exports, plus document parsing, estimates, federal
records, sales, mileage, and Solo 401(k) and Tennessee worksheets. Timesheets include clients, projects,
sub-clients, timed and duration entries, invoices, reports, and analytics.
Calendar supports recurring events, task completion, holidays, sky/weather
overlays, sunrise/sunset and shared display settings. Health includes person
overviews, dated activity/heart/sleep/workout/body charts, period comparisons,
reading and workout drill-downs, clinical labs/panels/vitals and source history,
and detected-illness notes/dismissal. Nutrition includes a person-scoped regimen,
time-of-day groups, status/category charts, dose-detail coverage, product filtering,
authenticated front/facts photos, full per-serving label facts and daily-value
charts, saved research and references. Focused editors preserve other label and
regimen fields; products can be added, imported, corrected, reparsed or deleted.
Imports, sickness, voice clips and Shortcut setup use the existing API.
Research inboxes for finance, health, politics, tech and local sources now have
saved-source statistics, monthly/publisher/format/claim charts, search and filters,
multiple-file import results, metadata editors and authenticated source files.
Source readers preserve selectable text and show cited summaries and claims,
including whether a recorded quote matches the current saved text. Tagged ticker
quotes include prices, yearly changes, weekly samples and research links.
Deep Research and Daily News have native history/status dashboards, job composers,
progress and failure states, rich report reading with tables, cited source ledgers,
and HTML exports. News also includes saved weather graphs, sun/calendar sections,
source warnings, protected narration with seeking and speed controls, theme-sample
requests and explicit email actions. Job generation, transcription and email still
depend on configured server providers. Chat, repository sources, jobs, schedules,
backups and server settings use native API-backed views and editors.

Brain has saved-memory statistics, a section word chart, formatted reading,
replacement/append editors, failed-save draft retention and discard protection.
Skills adds file-size statistics, search/sorting, formatted and plain readers,
mention sharing, native creation/editing/deletion and stale-record checks before
replacement. External Sources has saved-sync/file charts, repository management,
write-only GitHub access, folder counts, breadcrumbs, search across folders and
read-only Markdown pages with relative/wiki links and page history. Sync failures
retain their diagnostics and shortened source previews are clearly labelled.
Formatted repository pages keep links interactive; use Plain text for selectable
source text. These statistics describe saved content, not assistant effectiveness
or current provider health.

The native design uses domain colors, adaptive statistic cards, rounded surfaces
and consistent chart colors. Health includes recovery and sleep score rings;
Portfolio includes a positive-balance allocation ring alongside recorded balance
history. Missing readings remain unavailable, incompatible clinical units stay
on separate charts, and the number privacy setting hides personal metric and balance cards.
Documents, Workspace, Quant, research tickers, Politics, Predictions and timesheet analytics share this
design. Some remaining domain screens still use shared record lists and forms.

Quant includes native date-based charts with fixed/custom UTC windows, filled
bands, recession/inversion shading, dated events and window statistics, BTC indicator views, cycle heatmaps,
sector rotation, rolling ROI, research tickers, a combined signal overview and
a published macro release calendar with previous results. Predictions include
category/provider filters, ranking, movers and market details. The release
schedule is bundled from the shared public data in `web/src/data/`. Politics includes member,
consensus and simulated-performance explorers, trade filters and filing PDF/text
previews. Political research includes asset/topic signal cards, evidence charts,
linked claims, saved-source reading, matched bill summaries and official links.
Member portraits load through the authenticated API and use initials when an
image is unavailable. Some views still use shared native lists, and presentation differences
remain. Full web interface uses an ephemeral WebKit session. See the
[feature parity audit](../docs/ios/feature-parity.md) for precise coverage and
verification limits. Worksheet inputs last for the current app session;
saved contributions, payments, and assets use the server's records.

Administrative operations have native job and schedule charts, exact retry/clean-success
status, invalid manifests, retained run diagnostics, custom-job editing and manual/dry-run
results. Logs support saved days, severity/namespace/search filters and sharing. API
usage separates the complete persisted summary from recent calls, unknown prices and
daily priced costs. System access and cache timestamps retain their actual API scope.

## Build and run

Requires Xcode with an iOS 26 or later SDK and XcodeGen (`brew install xcodegen`).

```sh
cd ios
make generate
open DocVault.xcodeproj
```

Choose the DocVault scheme and an iPhone or iPad simulator. To build or test from
the terminal:

```sh
make build SIM="iPhone Air"
make test SIM="iPhone Air"
```

Keep the default simulator ad-hoc signing enabled; disabling signing prevents
the simulator app from saving its Keychain session.

For a physical device, copy `Config/Signing.xcconfig.example` to
`Config/Signing.xcconfig`, set your Apple Developer team, then select the device in
Xcode. The signing file is ignored. The default bundle identifier is
`com.vanities.docvault`; forks can change it in `project.yml` and regenerate. `make archive`
creates a local archive. Distribution and App Store submission are separate steps.

## Connect

Enter your server's base URL and the same username/password used in the browser.
Use the NAS address or HTTPS domain reachable from your phone. `localhost` on a
physical phone refers to the phone; on the simulator it can reach the Mac.
Reverse proxy base paths such as `https://vault.example.com/docvault` are supported
when the proxy strips the prefix. Use HTTPS for remote servers. LAN hostnames,
`.local` names, private IPs, and Tailscale IPs may use HTTP; allow Local Network
access when iOS asks. HTTP support uses Apple's
[local networking ATS setting](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking).
TLS certificate validation remains enabled.

Only the session token is saved, in a device-only Keychain item scoped to the exact
server URL. Passwords are not saved. A server restart or expired session requires
signing in again. The WebKit store is ephemeral and shares the authenticated session.
Sign-out removes local session access and attempts to revoke it on the server.

Enable Require device unlock in Settings to use Face ID, Touch ID, or a passcode
after backgrounding. The app covers the window before app-switcher snapshots,
including native preview sheets. Previews use protected temporary files, removed
when the document closes and on launch/sign-out. There is no offline document
library. Original imported files are never moved or deleted. Document uploads use
the server's 2 GB limit for documents, with uploads and downloads kept on disk.
Selected files are copied into protected temporary storage and those copies are
removed on dismissal, sign-out and launch. Domain-specific imports and backup
restore also stream from disk, with a 512 MB body limit (50 MB for reference voice
clips). Restore prepares a protected multipart file in bounded chunks and removes
it after the request. New calendar overlays, selected-file ZIP downloads and
corrected import body limits require the updated backend; this checkout has not
been deployed.

## Demo and verification

Provider settings now have dedicated configuration cards and focused editors
for AI/chat, email, voice, weather/calendar and market keys. Drafts survive failed
saves and require confirmation before discard; partial patches preserve unrelated
preferences. Task-specific API model edits preserve reasoning effort. Discovered
model lists identify live, cached and fallback sources; custom model inputs,
per-provider effort, server-default resets and news theme/image choices remain
available. Secrets start blank, and removal remains explicit. Sent Mail adds
outcome, purpose and daily-attempt charts, search and date filters, full recipient
and error details, attachment metadata and sharing. Provider acceptance is shown
separately from inbox delivery, which the current log cannot verify.

Tax Year now also has source implementations for filing reminders, shared
to-dos, reminder urgency/task statistics, entity details and metadata editing,
and Files/camera shortcuts for all fifteen tax folders. Reminder completion and
dismissal remain separate; optional estimated-tax payments require explicit
review and retain partial-failure feedback. Metadata saves preserve text lists
and unrelated structured values. Upload review retains the selected entity,
year and folder; raw demo uploads appear as unparsed sources without invented totals.
Document Import now adds classification/naming review for every document type
and expense category, standard names, optional automatic organization, original
preview and batch removal/restore. Tax Year adds automatic organization and
extraction alongside its folder shortcuts. Late AI suggestions preserve manual
edits. Parsed-data saves use confirmed collision paths, and retries skip saved
uploads. Saved-but-unparsed documents require a successful retry or an explicit
keep-unparsed choice; missing extraction never creates amounts.

Existing documents now have a native rename/organization review with entity,
year, document type, expense category and final-path previews. Saved extraction
can suggest standard filenames; parsing an unparsed source remains an explicit
provider action. Original extensions are retained. Include in totals uses a
partial metadata save, so notes and tags are preserved. Moves retain exclusion
flags and extracted values; classification retries skip confirmed moves. Dirty
naming and metadata drafts require explicit discard.

Weekly reports now have a native dashboard with category/day hour charts,
searchable entry details, complete server CSV/HTML exports and recipient/client
CC review. Schedule editing preserves unavailable/archived scope selections,
ordered literal keywords and protected drafts. Scope expansion requires explicit
review. Saved settings and send status are checked again before a write/send;
changed report contents or recipients require a refreshed review. This preflight
is not an atomic server-side send guard. Server/provider acceptance remains
separate from inbox delivery. Demo report sends are explicitly simulated.

Native invoicing now includes currency-separated billed/unpaid totals, monthly
charts, searchable history, issue-year/client/project/status filters and full
saved line reading. Creation reviews open work, prior billed exclusions, project
retainer adjustments, VAT and resolved templates. Actual-server PDF preview is
read-only; creation locks the reviewed entry IDs without sending email. Protected
status/comment editors preserve unknown imported payment dates. Email composition
loads substituted server defaults, including sender and client CC, permits explicit
blank CC and reviews repeat sends. Filing retains the collision path if parsing
fails; retry parses the saved PDF without uploading again. Demo invoices and
simulated sends use the same store, with reviewed invented lines/totals in PDFs.
Client preflight detects observed changes; it is not an atomic backend guard.

The latest combined checks compile 34 exact Foundation models plus the actual API
client, upload draft and multipart helper under macOS Swift 6. Eighty-seven
preserved bodies and eight market-fixture comparisons pass 625 standalone
assertions. The 1,106 importer comparisons, 90 report comparisons and 137 current
web-billing/actual-invoice/email-draft comparisons also pass. This invoice batch
passes 44 assertions over 22 in-process actual backend calls and 74 focused web
tests. No listener or provider request was used. All 136 repository Swift sources
pass syntax parsing. These are model/contract checks, not iOS framework tests.

There are 233 Swift test definitions, including the opt-in live audit, 72 synthetic
UI cases and nine opt-in live UI cases. Pre-commit validation on 2026-10-07 compiled
the app and both test targets for the iPhone Air simulator. Swift Testing reported
a successful run of 233 tests in 23 suites, with 39 opt-in integration/live tests
skipped. Two focused calendar UI regressions passed after updating the helper for
collapsed search fields. The full UI run was interrupted after those selector
failures; comprehensive latest UI, integration, live-vault and device checks
remain pending. Nine UI-dependent/integration cases remain outside the standalone
checks. The installed
real-NAS preview predates all seven latest source batches. Real NAS remains the
primary read-only UI target; synthetic records isolate write/failure tests and
public screenshots.

Tap Explore a demo vault on the connection screen, or launch with `--demo`.
Fixtures are invented; demo mode makes no server requests and does not overwrite
a saved real connection. Edits and document uploads last only for that demo
session. Provider actions and domain imports are simulated.

Banks and brokers have dedicated native dashboards, institution/account charts,
currency-separated bank balances, account and holding drill-downs, and recorded
balance comparisons. Holding price changes use the current quantity and preserve
unavailable history. Fixed account values are excluded from known position gains.
Native form fields keep visible labels when filled in.

Unit tests cover URL validation/encoding, API contracts, sessions, uploads,
metadata, demo isolation, the full navigation catalogue, typed and nested forms,
historical balance semantics, calculators, and concurrent list editing.
Integration tests exercise the real backend's billing locks, time-entry shapes,
report scoping, recurring tasks, health records, research, chat persistence,
fillable PDFs, file operations, schedules, job histories/partial outcomes, saved logs,
API usage with unknown prices, Brain replacement/append/clear, skill CRUD, protected repository indexes and truncated text, write-only tokens, preserved pages after failed sync, and encrypted backup/restore. UI tests
open every native area and exercise document preview, search, notes, uploads,
multiple-upload retries, bulk document actions, calendar overlays/layer settings,
income editing, standalone Sales/Mileage dashboards and edits, saved-price preservation, odometer calculations and optional-field clearing, route/address exploration, consolidated financial charts, fixed balances and currencies, selected-year business/contribution records, reminders, Tax Year charts, receipt/source/PDF exploration, deposit coverage, retirement summaries, CPA exports, source-based worksheets, contribution management, bank currency and account details, nested holding edits and refreshed values, Quant chart controls, political explorers and archived sources, research ticker notes, overview signal navigation, prediction market exploration, macro release/result drill-downs, dated Health charts and reading exploration,
clinical records/panels, persisted detected-period notes, domain-scoped Research
imports and readers, Deep Research jobs and report exports, Daily News weather,
source warnings and narration controls, custom-job editing/dry-run results, historical
logs, unpriced call details, system/cache status, memory drafts and failed-save recovery, skill creation/editing/deletion, repository folders/search/Markdown/wiki links, failed sync and token management, and authenticated settings on
iPhone and iPad simulators.
XCTest attachments include screenshots. Opening a screen is a smoke check, not
proof that every provider-backed workflow has been tested.

To run the optional integration test against the real backend handler and built
web app with temporary synthetic data (no development server or schedulers):

```sh
# Terminal 1, repository root
cd web
vp run build
vp exec bun tools/ios-ui-fixture.ts

# Terminal 2, repository root
cd ios
TEST_RUNNER_DOCVAULT_UI_TEST_SERVER=http://127.0.0.1:31305 make test
```

The fixture blocks outbound provider requests and never starts the scheduler.
Stop it with Ctrl-C to remove its temporary data. Never point this test at a real
DocVault server. Camera scanning, microphone behavior, biometric unlock, and
live provider connections require separate verification on a physical device or
with configured services.

## Live vault verification

Use a separate simulator already connected to your real server. Its saved session
and ordinary text size stay intact; these checks never enter demo mode, reset a
fixture, save records, run jobs or configure providers. Keep result bundles and
screenshots in the gitignored `data/` directory because they can contain private
names, records and balances.

```sh
# Set this to the same base URL shown in the simulator's Settings.
export TEST_RUNNER_DOCVAULT_LIVE_TEST_SERVER=https://vault.example.com
xcodebuild -project DocVault.xcodeproj -scheme DocVault \
  -destination 'platform=iOS Simulator,name=Your Live Simulator' \
  -only-testing:DocVaultTests/NativeLiveReadTests \
  -only-testing:DocVaultUITests/DocVaultLiveUITests \
  -resultBundlePath ../data/_audits/native-live.xcresult test
```

The read audit uses the native API client and the simulator's saved Keychain
session. It reports decoded sections, server-reported errors, unavailable
requests and record counts, without printing source payloads. Empty stores and
successful JSON decoding do not prove provider health or correctness of every
feature. The live UI checks confirm the selected connection, open the 43 native
destinations, and review Operations charts, saved run history, API usage and cache
status. Write/delete/failure regression tests and public screenshots continue to
use invented records.

The real server is the primary target for data contracts, populated dashboards
and read-only workflow review. Demo mode remains available for public screenshots
and deterministic write, delete and failure regressions. Run accessibility stress
checks in a separate QA simulator so the ordinary live preview keeps its normal
text size.
