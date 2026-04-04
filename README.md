# DocVault

Local-first document vault for organizing tax records, business filings, and important files across multiple entities. Self-hosted via Docker — your documents never leave your machine.

## Features

**Document Management**

- Multi-entity organization — separate spaces for personal taxes, LLCs, property, medical, military records, etc.
- AI document parsing — Claude Vision extracts structured data from W-2s, 1099s, K-1s, receipts, bank statements (~$0.003/page)
- Auto file naming — standardized `{Source}_{Type}_{Date}.ext` on upload
- Full-text search across all documents and parsed data

**Tax & Finance**

- Income, expense, and document summaries per entity per year
- Federal tax summary with Schedule C, K-1, capital gains aggregation
- Solo 401(k) contribution calculator (IRS Pub 560 worksheet)
- Estimated tax tracker with quarterly payment schedules
- TN-specific tax views (no state income tax)
- Sales tracker for business/farm revenue

**Financial Integrations**

- **Banks** — SimpleFIN Bridge for 16,000+ US institutions (read-only balances + transactions)
- **Brokers** — SnapTrade for brokerage accounts (Fidelity, Vanguard, Robinhood, etc.)
- **Crypto** — Ethereum wallet scanning via Etherscan, Kraken/Coinbase/Gemini exchange balances
- **Gold/Silver** — precious metals tracking with live spot prices
- **Property** — real estate portfolio with cost basis tracking
- **Mileage** — business mileage log with address autocomplete

**Portfolio & Snapshots**

- Unified portfolio view across brokers, crypto, and metals
- Automatic daily snapshots with historical chart
- Net worth history over time

**Infrastructure**

- Encrypted backup/restore — AES-256-GCM zip of all config and data
- Dropbox sync — auto-push documents to Dropbox via rclone
- Authentication — username/password with session cookies
- Docker-ready — single container, auto-published to GHCR (amd64 + arm64)

## Quick Start

```bash
bun install
bun start
```

Frontend: `http://localhost:5173` — Backend: `http://localhost:3005`

### Storage Setup

Create a `data/` directory with subdirectories per entity:

```bash
mkdir -p data/personal data/my-llc data/property
```

Or symlink existing folders:

```bash
ln -s ~/Documents/taxes data/personal
```

## Docker

```bash
docker run -p 3005:3005 \
  -v /path/to/documents:/data \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  ghcr.io/vanities/docvault:latest
```

### Docker Compose

```yaml
services:
  docvault:
    image: ghcr.io/vanities/docvault:latest
    ports:
      - '3005:3005'
    volumes:
      - /path/to/documents:/data
    environment:
      - ANTHROPIC_API_KEY= # Required for AI parsing
      - DOCVAULT_USERNAME=admin # Default: admin
      - DOCVAULT_PASSWORD= # Required
    restart: unless-stopped
```

## Environment Variables

| Variable            | Required       | Description                             |
| ------------------- | -------------- | --------------------------------------- |
| `ANTHROPIC_API_KEY` | For AI parsing | Claude Vision API key                   |
| `DOCVAULT_USERNAME` | No             | Login username (default: `admin`)       |
| `DOCVAULT_PASSWORD` | Yes            | Login password                          |
| `DATA_DIR`          | No             | Data directory path (default: `./data`) |
| `PORT`              | No             | Backend port (default: `3005`)          |

All other integrations (SimpleFIN, SnapTrade, Etherscan, Kraken, Coinbase, Gemini) are configured through the Settings UI and stored in `data/.docvault-settings.json`.

## Data Files

All state lives in `DATA_DIR` as `.docvault-*.json` files:

| File                       | Purpose                         |
| -------------------------- | ------------------------------- |
| `.docvault-config.json`    | Entity definitions              |
| `.docvault-settings.json`  | API keys and integration config |
| `.docvault-parsed.json`    | Cached AI parse results         |
| `.docvault-metadata.json`  | Document tags and notes         |
| `.docvault-reminders.json` | Filing deadline reminders       |

## Tech Stack

| Layer    | Technology                               |
| -------- | ---------------------------------------- |
| Frontend | React + TypeScript + Tailwind CSS (Vite) |
| Backend  | Bun native server (`Bun.serve()`)        |
| Storage  | Local filesystem                         |
| AI       | Anthropic Claude Vision API              |
| CI/CD    | GitHub Actions → GHCR                    |

## API

All endpoints under `/api/`, entity-scoped:

| Method | Endpoint                       | Description           |
| ------ | ------------------------------ | --------------------- |
| `GET`  | `/api/entities`                | List entities         |
| `GET`  | `/api/files/:entity/:year`     | Files for entity/year |
| `POST` | `/api/upload`                  | Upload file           |
| `POST` | `/api/parse/:entity/:path`     | AI parse document     |
| `POST` | `/api/parse-all/:entity/:year` | Batch parse year      |
| `GET`  | `/api/tax-summary/:year`       | Consolidated tax data |
| `GET`  | `/api/financial-snapshot`      | Portfolio snapshot    |
| `POST` | `/api/backup`                  | Encrypted backup      |
| `POST` | `/api/restore`                 | Restore from backup   |

## License

MIT
