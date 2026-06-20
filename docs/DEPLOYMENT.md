# Deployment

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
