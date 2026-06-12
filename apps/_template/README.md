# {{APP_DISPLAY_NAME}}

> Scaffolded from `apps/_template` — the unified GZ/BL internal webapp template.
> Stack rationale: [docs/charter.md](../../docs/charter.md).

**Stack:** Fastify (SSR via Eta) + HTMX + Lit, Drizzle + Aurora DSQL, deployed as a
Lambda container (Web Adapter) behind CloudFront. Google OAuth → JWT session cookie.

<!-- Scaffold note: replace this section with what the app does and why the
     scaffolding conversation chose this stack for it. -->

## Layout

```
├── src/
│   ├── server.ts        # entrypoint: load config, listen
│   ├── app.ts           # Fastify instance: plugins + routes
│   ├── config.ts        # env + SSM-backed config, loaded once at startup
│   ├── auth/            # Google OAuth flow, JWT session, RBAC
│   ├── db/              # Drizzle schema + DSQL/Postgres client
│   └── routes/          # pages (full HTML), HTMX fragment endpoints
├── views/               # Eta templates (layout, pages, partials/)
├── client/              # Lit components, bundled to public/assets/app.js
├── public/              # static assets (styles.css, brand, generated bundles)
├── cdk/                 # this app's infrastructure (WebappStack)
├── drizzle/             # generated SQL migrations (db:generate)
└── Dockerfile           # Lambda Web Adapter container, built from repo root
```

## Local development

```bash
# one-time: local Postgres + env
docker run -d --name pg -e POSTGRES_HOST_AUTH_METHOD=trust -p 5432:5432 postgres:16
cp .env.example .env            # fill in Google client id/secret
pnpm db:push                    # create tables

pnpm dev                        # http://localhost:3000
```

Locally the app runs as a plain Fastify process — the Lambda Web Adapter layer
only exists in the deployed container.

## Conventions

- **Pages** are server-rendered Eta views (`views/*.eta`) returned by routes in
  `src/routes/pages.ts`. Protect them with `requireAuth` / `requirePermission`.
- **Interactivity** is HTMX-first: endpoints take form bodies and return HTML
  *partials* (`views/partials/`), not JSON. See `src/routes/users.ts`.
- **Client state** that HTMX can't express cleanly goes in a Lit component under
  `client/components/`, registered in `client/index.ts`.
- **Data** goes through Drizzle (`src/db/schema.ts`). After schema changes run
  `pnpm db:generate` and commit the migration.
- **Secrets** live in SSM under `/gzweb/{{APP_NAME}}/{stage}/*` — never in code or env files.

## Deploying

You don't deploy from your machine. Merge to `main` and CI deploys via the
app's OIDC-scoped role (see `.github/workflows/deploy.yml` and
[docs/environments.md](../../docs/environments.md)). `pnpm diff` / `pnpm synth`
are available locally for previewing infrastructure changes.
