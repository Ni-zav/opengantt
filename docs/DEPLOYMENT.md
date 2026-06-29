# Deployment

## Static deployment

`npm run build` creates `dist/`. Any static HTTPS host can serve it. With no collaboration URL configured, the app is fully local and stores projects only in the browser.

## Container deployment

Build and run the web app:

```sh
docker compose up --build -d
```

The web app listens on port 8080 and exposes `/health`. Put it behind an HTTPS reverse proxy. The container adds content-type, referrer, permissions, clickjacking, and content-security headers.

## Future self-hosted collaboration

The Hocuspocus server remains available for a later self-hosted setup. Set `VITE_COLLAB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ALLOWED_ORIGINS`, then run:

```sh
docker compose --profile collaboration up --build -d
```

The service-role key is available only to the collaboration container. Expose port 1234 through an HTTPS/WSS reverse proxy. Port 1235 serves `/health` and `/metrics`; Compose binds it to host loopback only.

## Upgrade

1. Back up project exports and any future database.
2. Run `npm test` and `npm run build`.
3. Build the new immutable web image.
4. Deploy and verify `/health`, local project opening, import, export, and one edit autosave.
5. Keep the prior image available for rollback.
