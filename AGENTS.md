<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, but it invokes Vite through `vp dev` and `vp build`.

## Vite+ Workflow

`vp` is a global binary that handles the full development lifecycle. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

### Start

- create - Create a new project from a template
- migrate - Migrate an existing project to Vite+
- config - Configure hooks and agent integration
- staged - Run linters on staged files
- install (`i`) - Install dependencies
- env - Manage Node.js versions

### Develop

- dev - Run the development server
- check - Run format, lint, and TypeScript type checks
- lint - Lint code
- fmt - Format code
- test - Run tests

### Execute

- run - Run monorepo tasks
- exec - Execute a command from local `node_modules/.bin`
- dlx - Execute a package binary without installing it as a dependency
- cache - Manage the task cache

### Build

- build - Build for production
- pack - Build libraries
- preview - Preview production build

### Manage Dependencies

Vite+ automatically detects and wraps the underlying package manager such as pnpm, npm, or Yarn through the `packageManager` field in `package.json` or package manager-specific lockfiles.

- add - Add packages to dependencies
- remove (`rm`, `un`, `uninstall`) - Remove packages from dependencies
- update (`up`) - Update packages to latest versions
- dedupe - Deduplicate dependencies
- outdated - Check for outdated packages
- list (`ls`) - List installed packages
- why (`explain`) - Show why a package is installed
- info (`view`, `show`) - View package information from the registry
- link (`ln`) / unlink - Manage local package links
- pm - Forward a command to the package manager

### Maintain

- upgrade - Update `vp` itself to the latest version

These commands map to their corresponding tools. For example, `vp dev --port 3000` runs Vite's dev server and works the same as Vite. `vp test` runs JavaScript tests through the bundled Vitest. The version of all tools can be checked using `vp --version`. This is useful when researching documentation, features, and bugs.

## Common Pitfalls

- **Using the package manager directly:** Do not use pnpm, npm, or Yarn directly. Vite+ can handle all package manager operations.
- **Always use Vite commands to run tools:** Don't attempt to run `vp vitest` or `vp oxlint`. They do not exist. Use `vp test` and `vp lint` instead.
- **Running scripts:** Vite+ built-in commands (`vp dev`, `vp build`, `vp test`, etc.) always run the Vite+ built-in tool, not any `package.json` script of the same name. To run a custom script that shares a name with a built-in command, use `vp run <script>`. For example, if you have a custom `dev` script that runs multiple services concurrently, run it with `vp run dev`, not `vp dev` (which always starts Vite's dev server).
- **Do not install Vitest, Oxlint, Oxfmt, or tsdown directly:** Vite+ wraps these tools. They must not be installed directly. You cannot upgrade these tools by installing their latest versions. Always use Vite+ commands.
- **Use Vite+ wrappers for one-off binaries:** Use `vp dlx` instead of package-manager-specific `dlx`/`npx` commands.
- **Import JavaScript modules from `vite-plus`:** Instead of importing from `vite` or `vitest`, all modules should be imported from the project's `vite-plus` dependency. For example, `import { defineConfig } from 'vite-plus';` or `import { expect, test, vi } from 'vite-plus/test';`. You must not install `vitest` to import test utilities.
- **Type-Aware Linting:** There is no need to install `oxlint-tsgolint`, `vp lint --type-aware` works out of the box.

## Review Checklist for Agents

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to validate changes.
<!--VITE PLUS END-->

---

# DocVault

Document organization web app for managing tax documents, records, and files across multiple entities.

## Tech Stack

- **Frontend:** Vite + React + TypeScript + Tailwind CSS
- **Backend:** Bun native server (`Bun.serve()`, not Express)
- **Storage:** Local filesystem (data dir, volume-mounted in Docker)
- **Infrastructure:** Docker → GHCR, GitHub Actions CI

## Development

```bash
bun start          # Frontend (5173) + backend (3005) with hot-reload
bun run server     # Backend only
bun run dev        # Frontend only
```

**Do NOT start the dev server** — the user manages it manually.

**NAS data:** Always SSH to NAS (`ssh nas`) and read from `/mnt/user/appdata/docvault/data/` for real data. Local `data/` symlinks may be stale.

**CRITICAL — NAS file edits:** When modifying JSON files on the NAS, **NEVER pipe output back to the same file being read** (e.g., `cat file | jq ... | cat > file` — this truncates the file to 0 bytes before reading finishes). Always:

1. Read the file into a variable or temp file first
2. Write the modified content to a NEW temp file
3. Move/copy the temp file over the original
4. Or use `node -e` on the NAS to read, modify, and write in one process

Example safe pattern:

```bash
ssh nas 'node -e "const fs=require(\"fs\"); const d=JSON.parse(fs.readFileSync(\"/path/to/file.json\",\"utf8\")); /* modify d */ fs.writeFileSync(\"/path/to/file.json\",JSON.stringify(d,null,2));"'
```

## Architecture

All state lives in `DATA_DIR` (default `./data`, `/data` in Docker) as `.docvault-*.json` files:

| File                         | Purpose                                     |
| ---------------------------- | ------------------------------------------- |
| `.docvault-config.json`      | Entity definitions (names, types, metadata) |
| `.docvault-settings.json`    | API keys, exchange secrets, sync config     |
| `.docvault-parsed.json`      | Cached AI parse results                     |
| `.docvault-reminders.json`   | Deadline reminders                          |
| `.docvault-metadata.json`    | Document tags/notes                         |
| `.docvault-sync-status.json` | Dropbox sync status (written by NAS cron)   |

Entity types: `tax` (year-based views with income/expenses) or `docs` (flat file listing).

## Key Files

| File                               | Role                                       |
| ---------------------------------- | ------------------------------------------ |
| `server/index.ts`                  | All backend logic                          |
| `src/contexts/AppContext.tsx`      | Central state (entity, view, year, docs)   |
| `src/hooks/useFileSystemServer.ts` | Frontend API client                        |
| `src/config.ts`                    | Document types, expense categories         |
| `src/utils/filenaming.ts`          | Auto-naming (`{Source}_{Type}_{Date}.ext`) |

## API

All endpoints prefixed `/api/`. Entity-aware. Key routes:

- `GET /entities` — list entities
- `GET /files/:entity/:year` — files for entity/year
- `POST /upload?entity=X&path=Y&filename=Z` — upload
- `POST /parse/:entity/:path` — AI parse single file
- `POST /parse-all/:entity/:year` — batch parse
- `GET /tax-summary/:year` — consolidated tax data
- `POST /backup` / `POST /restore` — encrypted backup/restore

## Docker

- Multi-stage: Vite build → `oven/bun:1-slim` runtime
- Single volume mount: data dir → `/data`
- Image: `ghcr.io/vanities/docvault:latest`
- Auto-publishes on push to main (amd64 + arm64)
