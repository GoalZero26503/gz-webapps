# GZOps — app-level agent guidance

This app lives in the gz-webapps monorepo. Repo-wide rules, the creator
coaching guide, and the deploy story are in the root `.claude/CLAUDE.md` and
`.agents/docs/` — read those first. This file covers only what is specific to
this app.

## App facts

- **Stack**: default SSR (Fastify + Eta + HTMX + Lit). Why this stack was
  chosen for this app: <!-- scaffold fills this in from the conversation -->
- **Owner**: <!-- @github-handle -->
- **Stages**: dev, prod. Deployed only via CI on merge to `main`.

## Working in this app

- Stay inside `apps/gzops/`. Changes to other apps or `packages/`
  belong in separate PRs and require those owners' review.
- New page: Eta view in `views/`, route in `src/routes/pages.ts`, guarded by
  `requireAuth` or `requirePermission(...)`.
- New interaction: prefer an HTMX endpoint returning a partial from
  `views/partials/`. Reach for a Lit component only when the widget has real
  client-side state.
- Schema change: edit `src/db/schema.ts`, run `pnpm db:generate`, commit the
  migration under `drizzle/`.
- Never run `cdk deploy` or AWS write operations locally — deploys happen
  exclusively through CI. `pnpm diff` is fine for previewing.
