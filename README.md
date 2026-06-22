# OpenGantt

OpenGantt is an AGPL-3.0 local-first Gantt chart web app. It works anonymously in the browser and can optionally add Supabase cloud storage, role-based sharing, public viewer links, and realtime collaboration.

## Run locally

```sh
npm install
npm run dev
```

Verification:

```sh
npm test
npm run build
```

## Current capabilities

- Multiple local projects without an account
- Spreadsheet-style task editing and virtualized timeline rows
- Hierarchy, summaries, milestones, custom calendar exceptions, and worker-based scheduling
- FS/SS/FF/SF dependencies, lags, manual/automatic tasks, constraints, diagnostics, slack, and critical path
- Responsive light/dark UI
- Versioned OpenGantt JSON import/export
- RFC 4180 CSV mapping/import and formula-safe export
- Microsoft Project XML core import/export with conversion warnings
- Undo/redo, command search, Simple/Advanced modes, and separate mobile list/timeline views
- Task comment threads, replies, mentions, and resolution stored with the project
- Realtime Yjs collaboration, presence/selections, offline merge, and local-only collaborative undo
- XLSX workbook import/export in a lazy worker, including tasks, dependencies, calendars, and comments
- Installable offline PWA shell

Supabase-backed accounts, cloud projects, viewer/editor/owner policies, member management, ownership transfer, public viewer links, and realtime collaboration are implemented behind environment configuration. Apply the migration and configure collaboration as described in [`docs/CLOUD.md`](docs/CLOUD.md) and [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## File format

An `.opengantt` file is formatted UTF-8 JSON with `format: "opengantt"` and `version: 2`. Version 1 files are migrated during import. The file stores normalized project data rather than browser or collaboration-engine state, making it inspectable, diffable, and portable.

## Deployment

The production frontend is live at [opengantt.pages.dev](https://opengantt.pages.dev). Supabase cloud projects work there; realtime collaboration remains disabled until the prepared Cloudflare Container is deployed on a Workers Paid account.

Run the static build directly or use `docker compose up --build -d`. Cloudflare, container, cloud, upgrade, and authorization instructions are in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) and [`docs/CLOUD.md`](docs/CLOUD.md).
