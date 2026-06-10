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

## CRITICAL — Open Source / Privacy

**DocVault is an open-source, public repository.** It is used by the maintainer against a private NAS containing real tax, financial, medical, and identity records. Personal data MUST NEVER be committed.

Do not commit any of the following into the public repo, regardless of whether it "looks like test data":

- **Real names** (the user's, family members, clients, employers, business partners)
- **Real account numbers / IDs** (bank account last-4, credit card last-4, SimpleFIN IDs, SSN fragments, EINs, routing numbers, loan numbers)
- **Real dollar amounts** tied to the user's household (income, balances, mortgage amounts, specific transaction totals)
- **Real addresses, phone numbers, emails** — none, including the maintainer's
- **Real vendor/payer names** from invoices or 1099s
- **Real health/medical data** (Apple Health exports, diagnoses, dates of visits)

**Where this data may legitimately live:**

- `data/` directory — gitignored (`data/`, `data-backup`)
- Test files (`**/*.test.ts`, `**/*.test.tsx`, `**/*.spec.*`) — gitignored **by default**, with explicit per-file `!` exceptions in `.gitignore` for tests proven to contain only synthetic/generic data (~30 such tests are tracked and run in CI). Personal-data integration tests (e.g. `server/analytics/pipeline.integration.test.ts`) stay ignored and run only locally against synced NAS data
- `tax-plan/`, `scripts/`, `server/parsers/fixtures/` — gitignored
- `.docvault-*.json` files — gitignored as part of `data/`

**When writing code or tests that need realistic fixtures:** fabricate obviously-fake data (`Acme Bank`, `$1,234.56`, `John Doe`). A new test with only fabricated data should be tracked: add a `!path/to/file.test.ts` exception in `.gitignore` with a one-line justification comment (see the existing exception block there for the pattern). If a test must use real data to verify, leave it gitignored — the default `**/*.test.ts` ignore already handles it.

**Before every commit, run `git status` and `git diff --cached`** and visually scan for any of the categories above. If in doubt, move the content to a gitignored location.

**When adding a new file that might contain personal data,** either:

1. Place it under an already-gitignored path, OR
2. Extend `.gitignore` in the same commit.

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

**Validating changes:** use `bun run check` (typecheck via `tsc -b` + server boot-smoke + lint + format) — it is what CI runs. `vp check` does NOT typecheck `server/` (only formats/lints it), so a green `vp check` is not sufficient for backend work. New routes should parse request bodies through `readJsonBody<T>` from `server/http.ts` rather than bare `req.json()`.

**NAS data:** Always SSH to NAS (`ssh nas`) and read from `/mnt/user/appdata/docvault/data/` for real data. Local `data/` is a script-synced copy — refresh with `./scripts/sync-nas-data.sh` (add `--full` for all documents; required for the gitignored integration tests). Entity dirs must be real directories, not symlinks — the server's symlink-escape hardening refuses symlinked entity paths.

**CRITICAL — NAS file edits:** When modifying JSON files on the NAS, **NEVER pipe output back to the same file being read** (e.g., `cat file | jq ... | cat > file` — this truncates the file to 0 bytes before reading finishes). Always:

1. Read the file into a variable or temp file first
2. Write the modified content to a NEW temp file
3. Move/copy the temp file over the original
4. Or use `node -e` on the NAS to read, modify, and write in one process

Example safe pattern:

```bash
ssh nas 'node -e "const fs=require(\"fs\"); const d=JSON.parse(fs.readFileSync(\"/path/to/file.json\",\"utf8\")); /* modify d */ fs.writeFileSync(\"/path/to/file.json\",JSON.stringify(d,null,2));"'
```

## Important Conventions

**Sidebar navigation:** When adding a new view to the sidebar (`Sidebar.tsx` → `NavButton`), you MUST also:

1. Add the view name to the `NavView` union type in `src/contexts/AppContext.tsx`
2. Add the view name to the `validViews` Set in `src/contexts/AppContext.tsx`
3. Add the `case 'your-view':` to the view switch in `src/components/Layout/Layout.tsx`

Missing any of these causes the sidebar click to silently render the wrong view. This contract is enforced by `src/contexts/navigation-wiring.test.ts` (runs in CI) — if it fails, it names the missing entry.

**Package installs:** This project uses both pnpm and bun. After adding a dependency with `pnpm add <pkg>`, always run `bun install` to sync `bun.lock`, then commit both `package.json` and `bun.lock`. The Docker build uses `bun install --frozen-lockfile` so an out-of-sync `bun.lock` breaks CI. `pnpm-lock.yaml` is gitignored.

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
| `server/index.ts`                  | HTTP entry: routing core + scheduler boot  |
| `server/routes/*.ts`               | Route modules (one per domain)             |
| `server/data.ts`                   | Shared data layer: types, loaders, config  |
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
