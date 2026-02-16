# DocVault

Personal document vault for organizing tax records, business filings, military service documents, medical records, and other important files. Built as a local-first web app that sits on top of your existing Dropbox folder structure.

## What It Does

- **Multi-entity organization** -- separate spaces for personal taxes, each LLC, military records, VA benefits, property docs, etc.
- **AI-powered document parsing** -- uses Claude Vision to extract structured data from W-2s, 1099s, receipts, and other tax forms (~$0.003/page)
- **Tax year views** -- income, expenses, and document tabs per year with running totals
- **Auto file naming** -- standardized `{Source}_{Type}_{Date}.ext` naming on upload
- **Reminders & deadlines** -- track tax filing dates, annual report deadlines, recurring obligations
- **Dropbox sync** -- one-way push from NAS to Dropbox via rclone with status visible in the UI
- **Docker-ready** -- single container serves both the API and built frontend, auto-published to GHCR

## Tech Stack

- **Frontend:** React + TypeScript + Tailwind CSS (Vite)
- **Backend:** Bun native server (`Bun.serve()`)
- **Storage:** Local filesystem (direct or via symlinks to Dropbox)
- **AI:** Anthropic Claude Vision API for document parsing
- **Infrastructure:** Docker (multi-stage build), GitHub Actions, rclone for Dropbox sync

## Getting Started

### Local Development

```bash
# Install dependencies
bun install

# Start frontend + backend with hot-reload
bun start
```

Frontend runs on `http://localhost:5173`, backend on `http://localhost:3005`. The Vite dev server proxies `/api` requests to the backend automatically.

### Storage Setup (Local)

Create symlinks in the `data/` directory pointing to your actual document folders:

```bash
mkdir -p data
ln -s ~/Dropbox/important/taxes data/personal
ln -s ~/Dropbox/important/AM2\ LLC data/am2-llc
# ... etc
```

Each symlink name must match an entity ID in `server/config.json`.

## Docker Deployment

DocVault runs as a single Docker container that serves both the Bun API and the built Vite frontend.

### Quick Start (Docker)

```bash
docker pull ghcr.io/vanities/docvault:latest
docker run -p 3005:3005 -v /path/to/documents:/data docvault
```

Open `http://localhost:3005`.

### Docker Compose

```yaml
services:
  docvault:
    image: ghcr.io/vanities/docvault:latest
    ports:
      - '3005:3005'
    volumes:
      - /path/to/documents:/data # Document files
      - /path/to/config.json:/app/server/config.json # Entity config
      - /path/to/settings.json:/app/server/settings.json # API key
    environment:
      - DOCVAULT_DATA_DIR=/data
      - ANTHROPIC_API_KEY= # Optional, or configure via Settings UI
    restart: unless-stopped
```

### Unraid Setup

1. Pull image: `docker pull ghcr.io/vanities/docvault:latest` (authenticate with `docker login ghcr.io` + GitHub PAT with `read:packages` scope)
2. Create data directory with entity subdirectories matching `config.json`
3. Mount volumes:
   - `/mnt/user/appdata/docvault/data` → `/data`
   - `/mnt/user/appdata/docvault/config.json` → `/app/server/config.json`
   - `/mnt/user/appdata/docvault/settings.json` → `/app/server/settings.json`
4. An Unraid XML template is available at `/boot/config/plugins/dockerMan/templates-user/my-DocVault.xml`

### Building Locally

```bash
docker build -t docvault .
docker run -p 3005:3005 -v $(pwd)/data:/data docvault
```

The Dockerfile uses a multi-stage build: stage 1 builds the Vite frontend, stage 2 copies it into a slim Bun runtime image. The server serves static files from `dist/` and handles `/api/*` routes.

## Dropbox Sync

When running on a NAS/server, DocVault can sync documents back to Dropbox using rclone.

### How It Works

- A cron job on the host runs `sync-to-dropbox.sh` every 15 minutes
- Uses `rclone copy --update` (one-way push, won't delete Dropbox files)
- Writes `.docvault-sync-status.json` to the data directory
- The DocVault API serves this status at `GET /api/sync-status`
- The UI shows sync status in the sidebar (cloud icon with status dot) and in Settings (detailed view with last/next sync times)

### Entity → Dropbox Mapping

| DocVault Entity | Dropbox Path                        |
| --------------- | ----------------------------------- |
| personal        | `important/taxes`                   |
| am2-llc         | `important/AM2 LLC`                 |
| manna-llc       | `important/Manna of the Valley LLC` |
| military        | `important/DD-214`                  |
| va              | `important/VA`                      |
| eye-health      | `important/Eye`                     |
| id-docs         | `important/ID`                      |
| land            | `important/Land`                    |
| navy-evals      | `important/Navy`                    |
| education       | `important/MTSU Transcript`         |
| personality     | `important/personality`             |
| resume          | `important/Resume`                  |

### Setup (NAS)

1. Install rclone and authorize Dropbox:
   ```bash
   # On a machine with a browser:
   rclone authorize "dropbox"
   # Copy the config to the NAS:
   scp ~/.config/rclone/rclone.conf nas:/root/.config/rclone/rclone.conf
   ```
2. Copy `sync-to-dropbox.sh` to the NAS (e.g., `/mnt/user/appdata/docvault/`)
3. Add cron job:
   ```
   */15 * * * * /mnt/user/appdata/docvault/sync-to-dropbox.sh >> /mnt/user/appdata/docvault/sync.log 2>&1
   ```

## Document Parsing

1. Open Settings (gear icon)
2. Add your Anthropic API key from [console.anthropic.com](https://console.anthropic.com/)
3. Use "Parse All" to batch-process documents in a year, or parse individually

## Entity Types

**Tax entities** get year-based views with income/expense tracking:

| Entity                  | Description                                          |
| ----------------------- | ---------------------------------------------------- |
| Personal                | W-2s, 1099s, investment income, deductions           |
| AM2 LLC                 | Consulting business -- 1099-NEC, Schedule C expenses |
| Manna of the Valley LLC | Farm partnership -- Form 1065, K-1s                  |

**Document entities** get a flat file listing:

| Entity            | Description                              |
| ----------------- | ---------------------------------------- |
| Military & DD-214 | Service records, discharge documents     |
| VA Benefits       | Disability ratings, benefits letters     |
| Eye Health        | Eye health records and prescriptions     |
| ID & Identity     | Passport, driver's license, SSN card     |
| Land & Property   | Deeds, real estate documents             |
| Navy Evals        | Performance evaluations, fitness reports |
| Education         | Transcripts, diplomas, certifications    |
| Resume & Career   | Resumes, CVs                             |

Entities are configured in `server/config.json` and can be added/removed from the Settings page.

## File Naming Convention

All documents follow a standardized naming pattern (see [NAMING_STANDARD.md](NAMING_STANDARD.md)):

```
Google_W2_2024.pdf
Art_City_1099-nec_2025.pdf
Teraflop_Invoice_2025-01.pdf
OpenAI_software_2024-08-15.pdf
```

The upload zone auto-generates compliant filenames -- just enter the company name.

## Project Structure

```
docvault/
├── server/
│   ├── index.ts        # Bun.serve() API server + static file serving
│   └── config.json     # Entity configuration
├── src/
│   ├── components/
│   │   ├── Layout/     # Sidebar, header
│   │   ├── TaxYear/    # Tax year view (income/expenses/docs tabs)
│   │   ├── BusinessDocs/  # Formation docs, contracts, EIN
│   │   ├── AllFiles/   # Flat file listing for doc entities
│   │   ├── Settings/   # API key, entity management, sync status
│   │   ├── Documents/  # File list, viewer, upload zone
│   │   ├── Reminders/  # Deadline tracking with recurrence
│   │   ├── Todos/      # Todo list
│   │   └── Summary/    # Income/expense summaries
│   ├── contexts/
│   │   └── AppContext.tsx  # Central state management
│   ├── hooks/
│   │   ├── useDocuments.ts         # Document state
│   │   └── useFileSystemServer.ts  # API client
│   ├── utils/
│   │   └── filenaming.ts  # Auto-naming logic
│   └── types/
├── data/               # Symlinks to storage (gitignored)
├── Dockerfile          # Multi-stage build (Vite + Bun)
├── docker-compose.yml  # Unraid-friendly compose
├── .github/workflows/
│   └── docker.yml      # GHCR auto-publish (amd64 + arm64)
├── scripts/
│   └── rename_files.sh # Bulk rename existing files
└── NAMING_STANDARD.md
```

## API

All endpoints are entity-scoped:

| Method   | Endpoint                       | Description                           |
| -------- | ------------------------------ | ------------------------------------- |
| `GET`    | `/api/status`                  | Server status and entity list         |
| `GET`    | `/api/entities`                | List all entities                     |
| `POST`   | `/api/entities`                | Add new entity                        |
| `DELETE` | `/api/entities/:id`            | Remove entity                         |
| `GET`    | `/api/years/:entity`           | Tax years for entity                  |
| `GET`    | `/api/files/:entity/:year`     | Files in entity/year                  |
| `GET`    | `/api/files-all/:entity`       | All files recursively                 |
| `GET`    | `/api/file/:entity/:path`      | Serve file content                    |
| `DELETE` | `/api/file/:entity/:path`      | Delete file                           |
| `POST`   | `/api/upload`                  | Upload file                           |
| `POST`   | `/api/parse/:entity/:path`     | Parse document with Claude Vision     |
| `POST`   | `/api/parse-all/:entity/:year` | Batch parse all docs in year          |
| `GET`    | `/api/tax-summary/:year`       | Consolidated tax data across entities |
| `POST`   | `/api/move`                    | Move file between entities/years      |
| `GET`    | `/api/reminders`               | List reminders (optional `?entity=`)  |
| `POST`   | `/api/reminders`               | Create reminder                       |
| `PUT`    | `/api/reminders/:id`           | Update reminder                       |
| `DELETE` | `/api/reminders/:id`           | Delete reminder                       |
| `GET`    | `/api/sync-status`             | Dropbox sync status (from cron job)   |

## License

Private / personal use.
