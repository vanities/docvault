# DocVault

Personal document organization web app for managing tax documents, personal records, and important files across multiple entities (personal, LLCs, military, medical, etc.).

## Quick Start

```bash
# Install dependencies
bun install

# Start both frontend and backend (with hot-reload)
bun start

# Or run separately:
bun run server  # Backend on http://localhost:3005 (auto-restarts on changes)
bun run dev     # Frontend on http://localhost:5173
```

## Tech Stack

- **Frontend:** Vite + React + TypeScript + Tailwind CSS
- **Backend:** Bun native server (not Express)
- **Storage:** Local filesystem with symlinks to Dropbox

## Project Structure

```
docvault/
├── server/
│   ├── index.ts      # Bun.serve() API server
│   └── config.json   # Entity configuration (with descriptions)
├── tax-plan/          # Gitignored - personal tax planning workspace
├── src/
│   ├── components/
│   │   ├── Layout/        # Sidebar, Header, main layout wrapper
│   │   ├── TaxYear/       # Tax year view with Documents/Income/Expenses tabs
│   │   ├── BusinessDocs/  # Business documents view (formation, EIN, contracts)
│   │   ├── AllFiles/      # All files view (flat listing for non-tax entities)
│   │   ├── Settings/      # Settings view with API key and entity management
│   │   ├── Documents/     # Document list, card, viewer, upload zone
│   │   ├── Reminders/     # Reminder banner for deadlines (tax filings, annual reports)
│   │   └── Summary/       # Income and expense summaries
│   ├── contexts/
│   │   └── AppContext.tsx # Central state management
│   ├── hooks/
│   │   ├── useDocuments.ts        # Document state management
│   │   └── useFileSystemServer.ts # API client hook
│   ├── utils/
│   │   └── filenaming.ts  # Auto-naming utilities (see NAMING_STANDARD.md)
│   ├── types/             # TypeScript interfaces
│   └── config.ts          # Document types, expense categories
├── scripts/
│   └── rename_files.sh    # Bulk rename script for existing files
├── data/                  # Symlinks to actual storage locations
│   ├── personal -> Dropbox/important/taxes
│   ├── am2-llc -> Dropbox/important/AM2 LLC
│   ├── manna-llc -> Dropbox/important/Manna of the Valley LLC
│   ├── military -> Dropbox/important/DD-214
│   ├── va -> Dropbox/important/VA
│   ├── eye-health -> Dropbox/important/Eye
│   ├── id-docs -> Dropbox/important/ID
│   ├── land -> Dropbox/important/Land
│   ├── navy-evals -> Dropbox/important/Navy
│   ├── education -> Dropbox/important/MTSU Transcript
│   ├── personality -> Dropbox/important/personality
│   └── resume -> Dropbox/important/Resume
├── NAMING_STANDARD.md     # File naming conventions
└── package.json
```

## API Endpoints

All endpoints are entity-aware:

| Method | Endpoint                                 | Description                                      |
| ------ | ---------------------------------------- | ------------------------------------------------ |
| GET    | `/api/status`                            | Server status and entity list                    |
| GET    | `/api/entities`                          | List all entities                                |
| POST   | `/api/entities`                          | Add new entity                                   |
| DELETE | `/api/entities/:id`                      | Remove entity                                    |
| GET    | `/api/years/:entity`                     | List tax years for entity                        |
| GET    | `/api/files/:entity/:year`               | List files for entity/year                       |
| GET    | `/api/files-all/:entity`                 | List all files recursively                       |
| GET    | `/api/file/:entity/:path`                | Serve file content                               |
| DELETE | `/api/file/:entity/:path`                | Delete file                                      |
| POST   | `/api/upload?entity=X&path=Y&filename=Z` | Upload file                                      |
| POST   | `/api/mkdir`                             | Create directory                                 |
| POST   | `/api/parse/:entity/:path`               | Parse single file                                |
| POST   | `/api/parse-all/:entity/:year`           | Parse all files in year                          |
| POST   | `/api/move`                              | Move file                                        |
| GET    | `/api/tax-summary/:year`                 | Consolidated tax data for year                   |
| GET    | `/api/reminders?entity=X`                | List reminders (optional entity filter)          |
| POST   | `/api/reminders`                         | Create reminder                                  |
| PUT    | `/api/reminders/:id`                     | Update reminder (auto-creates next if recurring) |
| DELETE | `/api/reminders/:id`                     | Delete reminder                                  |

## Entities

Configured in `server/config.json`. Two types:

### Tax Entities (`type: "tax"`)

- **personal** - Personal tax documents (taxes folder)
- **am2-llc** - AM2 LLC business documents
- **manna-llc** - Manna of the Valley LLC documents

### Document Entities (`type: "docs"`)

- **military** - Military & DD-214 records
- **va** - VA Benefits documents
- **eye-health** - Eye Health records
- **id-docs** - ID & Identity documents
- **land** - Land & Property documents
- **navy-evals** - Navy Evals
- **education** - Education transcripts
- **personality** - Personality assessments
- **resume** - Resume & Career documents

## Document Types

- **Income:** W-2, 1099-NEC, 1099-MISC, 1099-R, 1099-DIV, 1099-INT, 1099-B
- **Expenses:** Receipts (meals, software, equipment, childcare, medical, travel)
- **Other:** Crypto (Koinly, Coinbase exports), Returns, Contracts, Invoices

## Key Files

- `server/index.ts` - All backend logic, uses Bun.serve()
- `src/contexts/AppContext.tsx` - Central state management (entity, view, year, documents)
- `src/components/Layout/Layout.tsx` - Main layout with sidebar navigation
- `src/hooks/useFileSystemServer.ts` - Frontend API client
- `src/components/Documents/UploadZone.tsx` - Upload with auto-naming
- `src/utils/filenaming.ts` - Generates standardized filenames
- `NAMING_STANDARD.md` - File naming conventions documentation

## Development Notes

- Server uses Bun's native `Bun.serve()` (not Express)
- Hot-reload enabled via `bun --watch`
- Files stored in Dropbox via symlinks in `data/` directory
- Parsed data stored in `data/.docvault-parsed.json`
- Works in Firefox (no File System Access API dependency)
- **Do NOT run `bun run dev`, `bun start`, or `bun run build`** - the user manages the dev server manually

## TODO

- [x] Implement document parsing with Claude Vision API
- [x] Entity management UI (add/remove businesses)
- [x] Parse All button for batch processing
- [x] QuickStats updates from parsed data
- [x] Move files between entities/years
- [x] Disable buttons during processing
- [x] "All" tab to view documents across all entities
- [x] Business document storage (formation docs, contracts, EIN letters, licenses)
- [x] Sidebar navigation (entity selection, views, settings)
- [x] File naming standard with auto-naming on upload
- [x] Dynamic entity types (tax vs docs)
- [x] All Files view for non-tax entities
- [x] Rebrand from TaxVault to DocVault

## Document Parsing

All document parsing uses Claude Vision API for accurate extraction of:

- W-2 forms (all box values, employer/employee info)
- 1099 forms (NEC, MISC, DIV, INT, B)
- Receipts (vendor, amount, date, items, category)

To use parsing:

1. Click the Settings icon (gear) in the header
2. Add your Anthropic API key from [console.anthropic.com](https://console.anthropic.com/)
3. Click "Parse All" or parse individual documents (~$0.003/page)

## File Naming

All documents follow the naming standard in `NAMING_STANDARD.md`:

- **Pattern:** `{Source}_{Type}_{Date}.{ext}` (date always LAST)
- **Examples:**
  - `Google_W2_2024.pdf`
  - `Art_City_1099-nec_2025.pdf`
  - `Teraflop_Invoice_2025-01.pdf`
  - `OpenAI_software_API_2024.pdf`

Upload zone has auto-naming - enter the company name and it generates the correct filename.

To rename existing files: `bash scripts/rename_files.sh --dry-run`
