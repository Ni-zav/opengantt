# OpenGantt Agent Guide

Keep this file accurate as the repository changes. Preserve existing guidance when adding new sections.

## Product boundaries

OpenGantt is an AGPL-3.0 local-first Gantt web app. The anonymous editor, advanced scheduling, comments, CSV/XLSX/MSPDI interchange, PWA shell, responsive modes, and keyboard productivity features work without configuration. Optional Supabase authentication, cloud projects, roles, public links, and realtime Yjs collaboration require the migration and environment described in `docs/CLOUD.md`. Yjs convergence, offline mapping, local-only undo, XLSX round trips, a golden MSPDI import, a 25-client Hocuspocus room, and read-only server enforcement are tested. The RLS role matrix, public-link revocation, ownership transfer, realtime editor/viewer synchronization, viewer write rejection, and persisted Yjs state were verified against the linked Supabase project on 2026-06-20. The non-realtime production frontend is live at `https://opengantt.pages.dev`; Supabase Auth redirects and Pages security headers are verified. Docker Desktop and its CLI are installed and `docker-users` is active, but WSL/backend startup is denied in this workspace. The Cloudflare Container remains undeployed because the account needs Workers Paid; the interactive browser audit also remains unavailable.

## Commands

- `npm install` — install dependencies.
- `npm run dev` — start the Vite development server.
- `npm test` — run scheduler, interchange, XLSX, Yjs, and collaboration checks once.
- `npm run build` — type-check and create the production bundle in `dist/`.

Run both `npm test` and `npm run build` after behavioral changes. Do not commit `node_modules/` or `dist/`.

Also run `npm run collab:build` after server or shared Yjs changes. `npm run collab:start` starts the already-built service.

## Architecture

- `src/App.tsx` owns the current UI and project editing flow. Keep it direct until a second real consumer justifies extraction.
- `src/model.ts` defines the canonical project and `.opengantt` v2 data shape, v1 migration, and trust-boundary validation.
- `src/scheduler.ts` contains deterministic calendar-aware DAG scheduling, constraints, diagnostics, summaries, slack, and critical-path calculations.
- `src/scheduler.worker.ts` keeps scheduling work off the UI thread; retain the synchronous scheduler as the tested core and worker-error fallback.
- `src/schedulePreview.ts` keeps edited rows controlled: plans up to 1,000 tasks receive exact synchronous previews, while larger plans retain mounted rows until the worker finishes.
- `src/taskReorder.ts` owns subtree-safe row moves. Dragging a parent moves every descendant; dropping inside a task reparents the dragged root.
- `src/storage.ts` is the browser IndexedDB boundary.
- `src/io.ts` owns imports and downloads. Validate before persistence and keep spreadsheet formula-injection protection.
- `src/interchange.ts` owns dependency-free RFC 4180 CSV mapping and core MSPDI conversion. Unsupported MSPDI data must produce warnings rather than invented values.
- `src/xlsxWorkbook.ts` owns ExcelJS conversion; `src/xlsx.worker.ts` keeps its large lazy-loaded bundle off the UI thread.
- `src/yProject.ts` is the canonical field-level Project/Yjs mapping. Materialization order must remain deterministic.
- `src/collaboration.ts` owns browser Yjs, y-indexeddb, awareness, and local-origin undo lifecycle.
- `server/index.ts` is the single-node Hocuspocus service with Supabase authorization, compact persistence, awareness sanitization, health, and metrics.
- `src/cloud.ts` is the dependency-free Supabase Auth/PostgREST boundary. Never expose a service-role key to it.
- `src/CloudPanel.tsx` owns optional sign-in, cloud-project, member, and sharing UI.
- `supabase/migrations/` is the authorization source of truth. Client-side role checks are UX only; retain RLS and RPC checks.
- `src/styles.css` contains the responsive workbench, light/dark tokens, reduced-motion fallbacks, desktop/tablet/mobile layouts, and panel transitions. Native CSS remains the UI system; use Phosphor as the single icon family.
- `public/sw.js` provides the small network-first offline shell. Increment its cache name when cache behavior changes.
- `Dockerfile`, `compose.yaml`, and `deploy/nginx.conf` serve the static production app with health and security headers.
- `Dockerfile.collab` runs the collaboration bundle as a non-root user. Keep browser/build packages in `devDependencies`; its Node runtime requires only `@hocuspocus/server` and `yjs`.
- The root `wrangler.jsonc` owns the Cloudflare Pages frontend deployment. `cloudflare/wrangler.jsonc` and `cloudflare/worker.js` own the single Cloudflare Container WebSocket gateway; do not expose the Supabase service-role key as a Worker variable or Vite value.
- `docs/FILE_FORMAT.md`, `docs/USER_GUIDE.md`, and `docs/OPERATIONS.md` define the supported interchange contract and operating procedures; update them with behavioral changes.

## Invariants

- Store schedule dates as ISO `YYYY-MM-DD` values and durations/lags as whole working days. Durations are non-negative; lags may be negative.
- Imported project IDs are replaced so imports never overwrite an existing local project.
- Reject XLSX imports above 10 MB, text imports above 25 MB, and projects or CSV files above 10,000 tasks before expensive processing.
- Task IDs remain stable inside a project and must be unique.
- Dependency and hierarchy cycles are preserved and every participating task is visibly marked invalid; never fix them by deleting user data.
- Finish-to-start dependencies begin on the next working day after predecessor completion, plus lag. Preserve the distinct FS, SS, FF, and SF semantics.
- Manual tasks and must-start/must-finish constraints stay fixed; report conflicts instead of silently moving them.
- Every task with children is a recursive rollup: its dates, duration, progress, and critical state are derived from descendants and read-only in the grid. Do not add dependencies to hierarchy parents or summary tasks.
- Indenting changes `parentId` only; never convert a task to a summary implicitly. Consecutive indents create siblings under the same parent.
- Hierarchy collapse is UI-only and must not mutate project data. Tasks with children use rounded derived-progress group bars and direct parent-to-child arrows on the timeline.
- Task rows begin immediately below the single 48px header; do not add a second header offset inside `rows-space`. Hierarchy connectors match the destination child's outline hue and depth desaturation.
- Keep the TypeScript `ROW_HEIGHT` and CSS `--row-height` synchronized at 48px. Task names wrap visually to two lines, but entered newlines are normalized to spaces in project data.
- Row drag/drop must preserve subtree membership, reject drops into the dragged subtree, and rewrite task order deterministically.
- Comment bodies are plain text, capped at 10,000 characters, and removed with their task. Keep rendering free of raw HTML.
- Keep off-screen task rows unmounted so 10,000-task projects do not create 10,000 DOM rows.
- Keep same-project task rows mounted during edits. Do not animate bar position or width between stale and current schedules; only a project switch may clear the current schedule.
- Anonymous data stays on the device unless the user explicitly exports it.
- Cloud projects are copied explicitly, cached for offline access, and removed from IndexedDB on logout.
- Anonymous undo history is capped locally; collaborative undo tracks only `LOCAL_ORIGIN` Yjs transactions and must never revert another collaborator.
- Cloud collaboration uses nested Y.Maps rather than one JSON register; do not replace it with whole-snapshot last-writer-wins synchronization.
- Viewers are read-only in both the client and Hocuspocus connection configuration. UI gating alone is not authorization.
- The 8 MiB collaboration payload ceiling must contain the tested 10,000-task Yjs state.
- The task grid follows spreadsheet focus behavior for vertical arrows, boundary-aware horizontal arrows, Home/End, and Ctrl+Home/Ctrl+End. Preserve native text editing inside cells.
- `LICENSE` contains the complete official AGPL-3.0 text; project code remains `AGPL-3.0-only`.

## Engineering style

Prefer browser APIs and small pure functions. Do not add state management, date, UI, or CSV dependencies unless measured behavior proves the native implementation insufficient. Accessibility, import validation, error handling that prevents data loss, and authorization boundaries are not optional simplifications. The scheduler test includes a 10,000-task chain guard; keep it linear and under its two-second ceiling.

Preserve the compact productivity-workbench hierarchy: the grid/timeline is the dominant surface, the top bar owns project/file commands, the project toolbar owns task commands, and Details remains an independently scrolling inspector or mobile bottom sheet. Icon-only controls require accessible labels and tooltips.

Keep collaboration monitoring private: Compose binds port 1235 to host loopback, while only the WebSocket port belongs behind the public WSS proxy. CI must retain clean-install, test, both build, audit, Compose validation, and both container-build gates.
