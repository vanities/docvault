# DocVault

Local-first document vault for organizing tax records, business filings, and important files across multiple entities. Built with React + Bun, deployable via Docker.

## Features

- **Multi-entity organization** — separate spaces for personal taxes, LLCs, military records, medical, property, etc.
- **AI document parsing** — Claude Vision extracts structured data from W-2s, 1099s, receipts (~$0.003/page)
- **Tax year views** — income, expenses, and documents per year with running totals
- **Auto file naming** — standardized `{Source}_{Type}_{Date}.ext` on upload
- **Reminders** — track filing deadlines with recurring support
- **Encrypted backup/restore** — AES-256-GCM encrypted zip of all config and data
- **Docker-ready** — single container, auto-published to GHCR

## Quick Start

```bash
bun install
bun start
```

Frontend on `http://localhost:5173`, backend on `http://localhost:3005`. Vite proxies `/api` to the backend.

### Storage Setup

Create a `data/` directory with subdirectories for each entity:

```bash
mkdir -p data/personal data/my-llc
```

Or symlink to existing folders:

```bash
ln -s ~/Documents/taxes data/personal
ln -s ~/Documents/business data/my-llc
```

## Docker

```bash
docker run -p 3005:3005 -v /path/to/documents:/data ghcr.io/vanities/docvault:latest
```

All config and state lives in the data dir as `.docvault-*.json` files — just mount one volume.

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
      - ANTHROPIC_API_KEY= # Optional, or configure via Settings UI
    restart: unless-stopped
```

## Tech Stack

| Layer    | Technology                               |
| -------- | ---------------------------------------- |
| Frontend | React + TypeScript + Tailwind CSS (Vite) |
| Backend  | Bun native server (`Bun.serve()`)        |
| Storage  | Local filesystem                         |
| AI       | Anthropic Claude Vision API              |
| CI/CD    | GitHub Actions → GHCR (amd64 + arm64)    |

## Entity Types

Entities are fully configurable from the Settings UI. Two types:

- **Tax entities** — year-based views with income/expense tracking (W-2s, 1099s, receipts)
- **Document entities** — flat file listing (military records, medical, property, etc.)

## Document Parsing

1. Add your Anthropic API key in Settings
2. Click "Parse All" or parse individual documents
3. Extracted data powers income/expense summaries and tax year totals

## API

All endpoints under `/api/`, entity-scoped. Key routes:

| Method | Endpoint                       | Description           |
| ------ | ------------------------------ | --------------------- |
| `GET`  | `/api/entities`                | List entities         |
| `GET`  | `/api/files/:entity/:year`     | Files for entity/year |
| `POST` | `/api/upload`                  | Upload file           |
| `POST` | `/api/parse/:entity/:path`     | AI parse document     |
| `POST` | `/api/parse-all/:entity/:year` | Batch parse year      |
| `GET`  | `/api/tax-summary/:year`       | Consolidated tax data |
| `POST` | `/api/backup`                  | Encrypted backup      |
| `POST` | `/api/restore`                 | Restore from backup   |

## License

MIT
