# Operations

## Backup and restore

- Local projects live in browser storage. Users must export `.opengantt` files or back up their browser profile.
- Before every release, export one representative `.opengantt` project and verify it imports into the new build.
- If future self-hosted collaboration adds a database, back it up before migrations and restore into staging first.

## Health and monitoring

The static container exposes `GET /health`. Monitor:

- HTTP availability and TLS expiry.
- Frontend build size; the core gzip budget is 300 KB.
- Future collaboration metrics from the service `/metrics` endpoint.

Do not record project names, task text, comments, tokens, share URLs, or file contents in logs. Add active-room count, persistence latency, room memory, and rejected-mutation metrics before future collaboration becomes operational; use project IDs only.

## Incident handling

1. Disable the affected deployment without deleting project data.
2. Preserve sanitized server logs.
3. Rotate compromised keys.
4. Restore into staging if a future server-side store exists.
5. Publish impact and remediation without exposing customer project content.

## Migration discipline

- Migrations are append-only after release when future server storage exists.
- Test upgrades against old OpenGantt files.
- Prefer forward fixes; destructive down migrations risk user data.
- Collaboration snapshots must remain readable by at least the immediately previous server release during rolling deployment.
