# Native app preview

The SwiftUI iPhone/iPad app lives in [`ios/`](../../ios/README.md) and uses the
existing DocVault API. It supports iOS 26 and later. The [feature parity audit](feature-parity.md)
and [remaining work](remaining-work.md) record implemented workflows, completed
checks and pending device/provider verification.

The native design uses domain colors, adaptive metric cards, rounded surfaces,
allocation and score rings, and dated charts. The following selected simulator
captures use invented records only. They show portions of scrollable screens;
phone captures use light mode and tablet captures use dark mode. They predate
the seven latest implementation batches and do not prove those changes build
or render. Real NAS data is the primary read-only UI validation target; demo
records are used for mutation/failure tests and public screenshots.

| Preview | Capture |
| --- | --- |
| Document browser | [iPhone](iphone-documents.png) |
| Financial metric cards | [iPhone](iphone-financial-overview.png) |
| Financial components and currency scope | [iPad](ipad-financial-overview.png) |
| Quant snapshot | [iPhone](iphone-quant-overview.png) |
| Activity history with missing/zero observations | [iPhone](iphone-health-activity.png) |
| Health overview and recorded score rings | [iPad](ipad-health-overview.png) |
| News weather history | [iPad](ipad-research-news-weather.png) |
| Calendar month | [iPhone](iphone-calendar.png) |

The complete generated screenshot archive remains local and gitignored. Public
captures must be reviewed for invented data before adding a specific `.gitignore`
exception. Live-vault screenshots, URLs, credentials and private records must
never be included in this public repository.

These previews establish selected synthetic layouts only. They do not verify
physical-device permissions, biometric unlock, live extraction or transcription,
provider acceptance, email delivery, distribution, or App Store review. See the
linked audit for the exact scope of each test run and the outstanding checks.
