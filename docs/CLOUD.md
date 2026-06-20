# Cloud setup

The local editor works without these steps. Cloud projects require a Supabase project.

1. Create a Supabase project.
2. Add the deployed OpenGantt origin and `http://localhost:5173` to the Authentication redirect URLs.
3. Link this repository and apply the migration:

   ```sh
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

4. Copy `.env.example` to `.env.local` and set the project URL and publishable/anonymous key. Never place a service-role key in a Vite environment variable.
5. Run `npm run dev`, request a magic link, and sign in.

The browser uses Supabase Auth and PostgREST directly. PostgreSQL RLS and security-definer RPCs enforce access; the UI role is not trusted.

## Required authorization checks

Run these against a disposable project before production deployment:

- Viewer can read a document but cannot insert or update it.
- Editor can update the document but cannot change sharing, members, ownership, or delete the project.
- Owner can manage members and public sharing, transfer ownership, and delete the project.
- Ownership transfer leaves exactly one owner and demotes the previous owner to editor.
- Public RPC returns a snapshot only while both the link and project visibility are enabled.
- Revoking a link immediately blocks anonymous reads.
- Signing out removes opened cloud snapshots from browser IndexedDB.

The initial migration is `supabase/migrations/202606200001_initial_cloud.sql`. Migration `202606200002_fix_project_insert_return.sql` permits an owner to read the project row during creation before its membership row is visible. Keep both migrations append-only.

## Verified deployment status

The repository is linked to a dedicated Supabase project in `ap-southeast-1`. On 2026-06-20, disposable live tests verified owner creation, viewer read-only access, editor writes, owner-only sharing controls, anonymous public reads, immediate link revocation, ownership transfer with exactly one owner, and deletion by the new owner. The live collaboration check also verified editor synchronization, viewer synchronization, server-side viewer write rejection, Yjs state persistence, and materialized project snapshots. Test records were removed afterward.

Production magic-link redirects still require the final deployed origin. Add that origin in Supabase Authentication settings before publishing. The collaboration service must also be deployed behind HTTPS/WSS; the linked database alone does not host Hocuspocus.
