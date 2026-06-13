# GZOps — app-level agent guidance

This app lives in the gz-webapps monorepo. Repo-wide rules, the creator
coaching guide, and the deploy story are in the root `.claude/CLAUDE.md` and
`.agents/docs/` — read those first. This file covers only what is specific to
this app.

## App facts

- **Stack**: default SSR (Fastify + Eta + HTMX + Lit). gzops is a **BFF**, not a
  DSQL app: it reads the gzops-platform API server-side (`src/platform/`, SigV4)
  and owns only a little KV state in DynamoDB (`src/store/`). No Aurora DSQL /
  Drizzle here — that was removed from the template skeleton for this app.
- **Owner**: astout (@astout) · `@GoalZero26503/webapp-gatekeepers` reviews.
- **Stages**: dev, prod. Deployed only via CI on merge to `main`.

## Working in this app

- Stay inside `apps/gzops/`. Changes to other apps or `packages/`
  belong in separate PRs and require those owners' review.
- New page: Eta view in `views/`, route in `src/routes/pages.ts`, guarded by
  `requireAuth` or `requirePermission(...)`.
- New interaction: prefer an HTMX endpoint returning a partial from
  `views/partials/`. Reach for a Lit component only when the widget has real
  client-side state.
- Platform data (projects, deployments, environments, …) is **read** through
  `src/platform/client.ts` — never persisted here, never called from the
  browser. App-owned state (programs, users, requests, notifications, access
  log) lives in `src/store/`; add a table by extending `store/client.ts`
  `TABLE_KEYS` and the CDK `TABLES` map.
- Local dev runs `STORE_MODE=memory` + `PLATFORM_MODE=fake` (seeded fixtures,
  no AWS). `pnpm dev` then sign in is gated on a Google OAuth client (human
  step); the screens render against fake data without it.
- Never run `cdk deploy` or AWS write operations locally — deploys happen
  exclusively through CI. `pnpm diff` / `pnpm synth` are fine for previewing.
