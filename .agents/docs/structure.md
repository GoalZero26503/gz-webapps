# Structure

## Monorepo layout (charter §4.2)

```
gz-webapps/
├── apps/
│   ├── _template/          # canonical default-stack skeleton (copied by pnpm scaffold)
│   ├── _template-spa/      # React+Vite escape-hatch frontend (pending rewiring; see its README)
│   └── <app-name>/         # one directory per live app
├── packages/               # shared libs — empty until real duplication exists
├── scripts/
│   ├── scaffold.mjs        # pnpm scaffold — copies _template, substitutes placeholders
│   ├── random-slug.sh      # playful default app names
│   └── admin/              # gzweb IAM bootstrap (gatekeepers only)
├── .github/
│   ├── workflows/ci.yml    # path-filtered checks per changed app
│   ├── workflows/deploy.yml# per-app OIDC deploy on merge to main
│   └── CODEOWNERS          # root gatekeeper entry + per-app entries
├── docs/                   # human docs; charter.md is the design source of truth
└── pnpm-workspace.yaml
```

## App anatomy (default stack)

```
apps/<name>/
├── src/
│   ├── server.ts           # entrypoint: loadConfig() then listen on $PORT
│   ├── app.ts              # buildApp(): Fastify + plugins + routes
│   ├── config.ts           # env + SSM config, loaded once at startup
│   ├── auth/               # google.ts (OAuth), jwt.ts, rbac.ts, plugin.ts, types.ts
│   ├── db/                 # schema.ts (Drizzle), client.ts (DSQL IAM-token pool)
│   └── routes/             # pages.ts (HTML), auth.ts, feature routes (HTMX fragments)
├── views/                  # Eta templates; partials/ for HTMX fragments
├── client/                 # Lit components → esbuild → public/assets/app.js
├── public/                 # styles.css, brand assets; assets/ + vendor/ are generated
├── drizzle/                # generated SQL migrations (committed)
├── cdk/                    # WebappStack: DSQL + Lambda container + CloudFront
├── Dockerfile              # built from repo root with APP_DIR build arg
└── cdk.json                # app: tsx cdk/bin/app.ts
```

## Request path

```
browser → CloudFront (one origin, TLS, caching for /assets/* /vendor/*)
        → Lambda Function URL → Lambda Web Adapter → Fastify (container)
        → Drizzle → Aurora DSQL (IAM-token auth)
```

Fastify serves everything: HTML pages (Eta), HTML fragments (HTMX endpoints),
JSON under `/api/*`, and static files. There is no separate API origin and no
CORS. `/healthz` is the adapter's readiness check.

## Where things run

- **Locally**: plain Fastify process (`pnpm dev`), local Postgres via
  `DATABASE_URL`, secrets from `.env`. No Lambda, no adapter.
- **AWS**: the container image from `Dockerfile`, config from CDK-set env vars,
  secrets from SSM at startup.
