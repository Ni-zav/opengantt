# OpenGantt file format v2

`.opengantt` files are UTF-8 JSON with media type `application/vnd.opengantt+json`. They contain normalized project data, not IndexedDB records, authentication data, or collaboration-engine state.

## Envelope

```json
{
  "format": "opengantt",
  "version": 2,
  "exportedAt": "2026-06-20T12:00:00.000Z",
  "project": {}
}
```

Importers reject unknown major versions. OpenGantt migrates version 1 files by supplying v2 scheduling and calendar defaults. Unknown optional properties may be ignored.

## Project

Required fields:

- `id`: UUID-like stable project identifier. OpenGantt replaces it when importing as a new local project.
- `name`: project display name.
- `updatedAt`: ISO timestamp describing the snapshot.
- `defaultCalendarId`: ID of the fallback calendar.
- `calendars`: working-week definitions and date-specific exceptions.
- `tasks`: ordered task records.
- `dependencies`: task links.
- `commentThreads`: task-anchored plain-text discussion.

## Scheduling values

- Dates use `YYYY-MM-DD` and have no timezone conversion.
- Durations and dependency lags are integer working days.
- Dependency types are `FS`, `SS`, `FF`, or `SF`.
- Task types are `task`, `milestone`, or `summary`.
- Scheduling modes are `auto` or `manual`.
- Constraint types are `asap`, `start-no-earlier-than`, `finish-no-later-than`, `must-start-on`, or `must-finish-on`.
- Optional `outlineColor` and parent-only `taskColor` values are six-digit CSS hex colors such as `#147d64`.
- Any task with children is a recursive rollup; its dates, duration, progress, slack, finish date, critical status, and diagnostics are derived and are not authoritative file fields.

Calendar `workingDays` uses JavaScript weekday numbers: Sunday `0` through Saturday `6`. `exceptions` maps a date to `true` for working or `false` for non-working.

## Identity and references

Task, dependency, calendar, thread, and comment IDs must be unique in their respective collections. `parentId`, dependency endpoints, thread task IDs, and task calendar IDs must reference existing records. Import validation rejects dangling dependency and thread references rather than deleting data silently.

## Other formats

- CSV imports tasks through an explicit column mapper. CSV does not preserve dependencies, calendars, comments, or constraints.
- CSV export follows RFC 4180 and escapes formula-leading text.
- Microsoft Project XML maps core tasks, hierarchy, milestones, manual mode, progress, and predecessor links. Resources and assignments currently produce an import warning.
- XLSX workbooks contain `Metadata`, `Tasks`, `Dependencies`, `Calendars`, and `Comments` sheets. Import is capped at 10 MB compressed and 10,000 tasks, runs in a worker, maps source references to new project IDs, and reports missing references or calendars.
