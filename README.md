# DocVault

Personal finance and document management system. Organizes tax records, tracks net worth across brokers/crypto/metals, parses financial documents with AI, and keeps everything self-hosted — your data never leaves your machine.

## Features

**Document Management**

- Multi-entity organization — separate spaces for personal, LLCs, property, medical, military records, etc.
- AI document parsing — Claude Vision extracts structured data from W-2s, 1099s, K-1s, receipts, bank statements (~$0.003/page)
- Auto file naming — standardized `{Source}_{Type}_{Date}.ext` on upload
- Full-text search across all documents and parsed data
- Business document storage and organization
- Todo list for document/filing tasks

**Tax & Finance**

- Income, expense, and document summaries per entity per year
- Federal tax summary — Schedule C, K-1, capital gains, withholdings aggregated across all entities
- Solo 401(k) contribution calculator (IRS Pub 560 worksheet)
- Estimated quarterly tax tracker
- State tax views (TN no-income-tax)
- Sales tracker for business/farm revenue
- Invoice tracking

**Net Worth & Portfolio**

- Unified portfolio view across all accounts
- Automatic daily snapshots with historical net worth chart
- Broker accounts via SnapTrade (Fidelity, Vanguard, Robinhood, etc.)
- Crypto exchange balances (Kraken, Coinbase, Gemini)
- Ethereum wallet scanning via Etherscan (ETH + ERC-20 tokens across mainnet, Arbitrum, Optimism, Polygon, Avalanche)
- Gold/silver precious metals with live spot prices
- Real estate portfolio with cost basis and equity tracking
- Retirement account balances and contribution tracking
- Bank account balances + transaction history via SimpleFIN

**Financial Integrations**

- **SimpleFIN Bridge** — read-only bank balances and transactions for 16,000+ US institutions
- **SnapTrade** — brokerage account aggregation
- **Etherscan** — Ethereum and L2 wallet scanning
- **Kraken / Coinbase / Gemini** — exchange balance imports
- **Koinly** — crypto tax report parsing (8949, Schedule D)

**Backup & Sync**

- Encrypted backup/restore — AES-256-GCM encrypted zip of all config and parsed data, downloadable on demand
- Auto-backup — scheduled encrypted backups written to your data dir before every Dropbox sync
- Dropbox sync — rclone-based push of all entity folders to Dropbox on a configurable schedule (default: every 15 min)
- Custom sync paths — drop a `.docvault-dropbox-map.json` in your data dir to map entities to specific Dropbox folders

**Scheduled Tasks**

- Portfolio snapshots — automatically fetches live prices and saves a net worth snapshot on a configurable interval (default: daily)
- Dropbox sync — runs on its own schedule independent of snapshots
- Both schedulers start on boot and are configurable from the Settings UI

**Other**

- Mileage log with address autocomplete
- Filing deadline reminders with recurring support
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
  -e DOCVAULT_PASSWORD=yourpassword \
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

All state lives in `DATA_DIR` as `.docvault-*.json` files — mount one volume and everything is portable:

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
