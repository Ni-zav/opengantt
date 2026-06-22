# Deployment

## Live Cloudflare deployment

The production frontend is deployed at `https://opengantt.pages.dev`. The root `wrangler.jsonc` deploys `dist/`, and `public/_headers` preserves the same browser security policy as the Nginx image. The Supabase Auth site URL and redirect allow-list include this origin.

Deploy the frontend with collaboration disabled until its Worker exists:

```powershell
$env:VITE_COLLAB_URL=''
npm run cloudflare:pages
```

`cloudflare/wrangler.jsonc` defines one `basic` Cloudflare Container running the existing Hocuspocus service behind the `opengantt-collaboration` Worker. Cloudflare Containers require the Workers Paid plan; the authenticated account was still on Free when this was prepared, so the container has not been deployed. Docker Desktop and CLI 29.5.3 are installed, but this workspace currently receives `WSL/E_ACCESSDENIED` before the backend starts. After enabling the paid plan and starting Docker successfully from the interactive Windows session:

1. Run `npm run cloudflare:deploy` and note the resulting `https://opengantt-collaboration.<subdomain>.workers.dev` URL.
2. Run `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config cloudflare/wrangler.jsonc` and enter the service-role key without storing it in source control.
3. Set `VITE_COLLAB_URL` to the same URL with `wss://`, rebuild, and run `npm run cloudflare:pages`.
4. Verify the Worker `/health`, one editor/editor synchronization, public viewer synchronization, and viewer write rejection.

The Worker forwards only WebSocket upgrades and `/health` to the container. Its allowed browser origin is restricted to `https://opengantt.pages.dev`; Supabase remains the persistence and authorization source of truth.

## Static local-only deployment

`npm run build` creates `dist/`. Any static HTTPS host can serve it. Without Supabase environment values the app remains fully local and does not show sign-in controls.

## Container deployment

Set the public Supabase values, then build and run:

```sh
docker compose up --build -d
```

The web app listens on port 8080 and exposes `/health`. Put it behind an HTTPS reverse proxy. The container adds content-type, referrer, permissions, clickjacking, and content-security headers.

Supabase remains a separate managed or self-hosted dependency. Apply its migration using `docs/CLOUD.md`. Never provide the service-role key to the container build.

To run the collaboration service as well, set `VITE_COLLAB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ALLOWED_ORIGINS`, then run:

```sh
docker compose --profile cloud up --build -d
```

The service-role key is available only to the collaboration container. Expose port 1234 through an HTTPS/WSS reverse proxy. Port 1235 serves `/health` and `/metrics`; Compose binds it to host loopback only. Keep it on a private monitoring network if that binding is changed.

## Upgrade

1. Back up PostgreSQL.
2. Apply migrations in a staging project.
3. Run authorization checks from `docs/CLOUD.md`.
4. Build the new immutable web image.
5. Deploy and verify `/health`, login, local project opening, one cloud read/write, and a public viewer link.
6. Keep the prior image available for rollback. Database migrations must supply a forward fix rather than destructive rollback.
