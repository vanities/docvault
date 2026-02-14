# DocVault

Personal document vault for organizing tax records, business filings, military service documents, medical records, and other important files. Built as a local-first web app that sits on top of your existing Dropbox folder structure.

## What It Does

- **Multi-entity organization** -- separate spaces for personal taxes, each LLC, military records, VA benefits, property docs, etc.
- **AI-powered document parsing** -- uses Claude Vision to extract structured data from W-2s, 1099s, receipts, and other tax forms (~$0.003/page)
- **Tax year views** -- income, expenses, and document tabs per year with running totals
- **Auto file naming** -- standardized `{Source}_{Type}_{Date}.ext` naming on upload
- **Symlink-based storage** -- files live in Dropbox, DocVault reads/writes through symlinks

## Tech Stack

- **Frontend:** React + TypeScript + Tailwind CSS (Vite)
- **Backend:** Bun native server (`Bun.serve()`)
- **Storage:** Local filesystem via symlinks to Dropbox
- **AI:** Anthropic Claude Vision API for document parsing

## Getting Started

```bash
# Install dependencies
bun install

# Start frontend + backend with hot-reload
bun start
```

Frontend runs on `http://localhost:5173`, backend on `http://localhost:3005`.

### Storage Setup

Create symlinks in the `data/` directory pointing to your actual document folders:

```bash
mkdir -p data
ln -s ~/Dropbox/important/taxes data/personal
ln -s ~/Dropbox/important/AM2\ LLC data/am2-llc
# ... etc
```

Each symlink name must match an entity ID in `server/config.json`.

### Document Parsing

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
│   ├── index.ts        # Bun.serve() API server
│   └── config.json     # Entity configuration
├── src/
│   ├── components/
│   │   ├── Layout/     # Sidebar, header
│   │   ├── TaxYear/    # Tax year view (income/expenses/docs tabs)
│   │   ├── BusinessDocs/  # Formation docs, contracts, EIN
│   │   ├── AllFiles/   # Flat file listing for doc entities
│   │   ├── Settings/   # API key + entity management
│   │   ├── Documents/  # File list, viewer, upload zone
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
├── scripts/
│   └── rename_files.sh # Bulk rename existing files
└── NAMING_STANDARD.md
```

## API

All endpoints are entity-scoped:

| Method | Endpoint                       | Description                           |
| ------ | ------------------------------ | ------------------------------------- |
| `GET`  | `/api/entities`                | List all entities                     |
| `GET`  | `/api/years/:entity`           | Tax years for entity                  |
| `GET`  | `/api/files/:entity/:year`     | Files in entity/year                  |
| `GET`  | `/api/files-all/:entity`       | All files recursively                 |
| `POST` | `/api/upload`                  | Upload file                           |
| `POST` | `/api/parse/:entity/:path`     | Parse document with Claude Vision     |
| `POST` | `/api/parse-all/:entity/:year` | Batch parse all docs in year          |
| `GET`  | `/api/tax-summary/:year`       | Consolidated tax data across entities |
| `POST` | `/api/move`                    | Move file between entities/years      |

## License

Private / personal use.
