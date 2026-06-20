# Operations

## Backup and restore

- Enable scheduled PostgreSQL backups in the Supabase project and verify their retention period.
- Before every migration, create a database backup and export one representative `.opengantt` project.
- Restore into a disposable project first, run the authorization matrix in `docs/CLOUD.md`, then verify a document snapshot and public-link revocation.
- Local anonymous projects are outside server backups. Users must export `.opengantt` files or back up their browser profile.

## Health and monitoring

The static container exposes `GET /health`. Monitor:

- HTTP availability and TLS expiry.
- Authentication error rate.
- PostgreSQL connection, storage, and backup status.
- Document read/write latency and failed RLS requests.
- Public snapshot request rate and 4xx/5xx responses.
- Frontend build size; the core gzip budget is 300 KB.
- `opengantt_collab_connections`, rejected authentications, successful stores, and store failures from the collaboration service `/metrics` endpoint.

Do not record project names, task text, comments, tokens, magic-link URLs, or file contents in logs. The collaboration service currently exposes connection count, rejected authentications, successful stores, and store failures. Add active-room count, persistence latency, room memory, and rejected-mutation metrics before those signals become operational requirements; use project IDs only.

## Incident handling

1. Disable public links or the affected deployment without deleting project data.
2. Preserve sanitized server logs and database audit evidence.
3. Rotate compromised keys. A leaked service-role key requires immediate rotation because it bypasses RLS.
4. Restore into staging and prove document counts and authorization before production recovery.
5. Publish impact and remediation without exposing customer project content.

## Migration discipline

- Migrations are append-only after release.
- Test upgrades against production-shaped data and old OpenGantt files.
- Prefer forward fixes; destructive down migrations risk user data.
- Collaboration snapshots must remain readable by at least the immediately previous server release during rolling deployment.
