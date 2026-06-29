# OpenGantt

OpenGantt is an AGPL-3.0 local-first Gantt chart web app. It works anonymously in the browser and keeps projects on the device by default.

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
- Dormant Yjs collaboration code for a future self-hosted setup
- XLSX workbook import/export in a lazy worker, including tasks, dependencies, calendars, and comments
- Installable offline PWA shell

Cloud accounts, public links, and hosted auth are paused. The next sharing path should be basic self-hosted collaboration, reusing the existing Hocuspocus server pieces when needed.

## File format

An `.opengantt` file is formatted UTF-8 JSON with `format: "opengantt"` and `version: 2`. Version 1 files are migrated during import. The file stores normalized project data rather than browser or collaboration-engine state, making it inspectable, diffable, and portable.

## Deployment

Run the static build directly or use `docker compose up --build -d`. For future self-hosted collaboration notes, see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
