# gz-webapps — internal webapp monorepo

@.agents/docs/structure.md
@.agents/docs/auth.md
@.agents/docs/api.md
@.agents/docs/deploy.md
@.agents/docs/conventions.md
@.agents/docs/aws-namespace.md

## Overview

This monorepo holds every internal Goal Zero / BioLite webapp, all built on one
stack: Fastify (SSR via Eta + HTMX + Lit) in a Lambda container behind
CloudFront, Aurora DSQL via Drizzle, AWS CDK. Full rationale: `docs/charter.md`.
Apps live in `apps/<app-name>/`; `apps/_template/` is the canonical skeleton.

## Who you are talking to

The person you're helping may be **non-technical** — a customer-service lead,
an ops manager, a lab tech building their first app (charter §4.7). Calibrate:

- Coach git mechanics in plain English with concrete commands: branch, commit,
  push, open a PR. Never assume they know what a merge conflict is.
- Direct pushes to `main` are blocked by branch protection. That is not an
  error to work around — work on a branch named `<gh-username>/<short-description>`
  and open a PR.
- When CI fails, read the log, explain the failure in plain English, and
  propose the fix. Never suggest bypassing CI, branch protection, or review.
- PR descriptions: what changed, why, how to test, any infrastructure impact.
  Tag `@GoalZero26503/webapp-gatekeepers` for review.
- AWS write operations (`cdk deploy`, `aws ... put/create/delete`) are **not
  for local machines** — deployment happens exclusively through CI on merge to
  `main`. If something seems to need a local deploy, explain why the right
  move is a PR. `pnpm diff` / `pnpm synth` (read-only previews) are fine.

## Available Commands

| Command | Description |
|---------|-------------|
| `/gz:webapp:new-app` | Scaffold a new app — conversational stack choice, then `pnpm scaffold` |
| `/gz:webapp:scaffold` | Add a page, fragment endpoint, Lit component, or table to an existing app |
| `/gz:webapp:status` | Show an app's config, placeholder status, and deployment info |

## Key Rules

1. Stay inside the app you're working on (`apps/<name>/`). Cross-app or
   `packages/` changes are separate PRs requiring those owners' review.
2. New pages are Eta views + a route in `src/routes/pages.ts`, guarded by
   `requireAuth`/`requirePermission`. Interactivity is HTMX-first: endpoints
   take form bodies and return HTML partials. Lit components only for
   genuinely stateful widgets (see `.agents/docs/api.md` for the decision rule).
3. Data goes through Drizzle (`src/db/schema.ts`); after schema changes run
   `pnpm db:generate` and commit the migration.
4. Secrets live in SSM at `/gzweb/{app}/{stage}/*`. Never hardcode or commit.
5. All AWS resources use the `gzweb-` prefix and namespace tags — IAM scoping
   depends on it (`.agents/docs/aws-namespace.md`).
6. Don't edit `apps/_template/` while building an app — template improvements
   are their own PR, reviewed as template changes.
7. Keep `.agents/docs/` and `docs/` current when you change how things work.
