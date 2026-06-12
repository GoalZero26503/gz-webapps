# 2605 — Unified Webapp Template

Design and starting point for a single, opinionated webapp template that all internal
Goal Zero and BioLite webapps will be built from going forward.

This directory holds the **design work**. Once the framework is settled and a working
template repo exists, it will move to `~/Documents/gz/__github/` (or the BioLite
equivalent) as a standalone repo that new apps clone or fork from.

## Why this exists

- We expect to deploy **10+ to dozens of internal webapps** over the next couple of years
  as Claude-assisted development accelerates what one person can ship.
- Without a standard, that proliferation produces N different stacks, N different auth
  implementations, N different deploy stories, and unmaintainable surface area for a
  small engineering org.
- A single template makes everything cheaper to build, cheaper to operate, and safer to
  deploy — and lets a small group of authorized deployers actually maintain oversight.

## Where we landed

Shared backbone for every app:

`CloudFront` → `Fastify in a container, deployed to Lambda via Lambda Web Adapter` → `Aurora DSQL`

Frontend stack: **default SSR with an SPA escape hatch.**

- **Default — SSR with Eta + HTMX + Lit.** Fastify serves HTML via Eta templates;
  HTMX handles the bulk of interactivity (click → swap a fragment, SSE-driven live
  updates, optimistic UI); Lit web components cover the genuinely-stateful bits
  (interactive charts, drag-drop within a panel, multi-step inline editors). For the
  realistic majority of internal apps, this delivers ~150 KB of JS vs the
  600 KB–2.5 MB a React/Next.js equivalent ships. Treat this as the answer unless
  the app's UX shape genuinely pushes you off it.
- **Escape hatch — React + Vite + Tailwind SPA.** Bundle hosted on S3 behind
  CloudFront. Reserved for the narrow set of apps where client-side state is the
  dominant UX shape: real-time collaborative editing with conflict resolution,
  offline-first apps, IDE-like surfaces, or anything where partial-HTML round-trips
  would feel sluggish.

The choice is conversational at scaffold time, not a checkbox form — see
[`docs/charter.md` §3.3](docs/charter.md). The default holds for nearly every app;
the LLM coaching the creator only suggests SPA when the description hits one of
the specific shapes above.

Other choices:

- **Aurora DSQL** as the default database — relational, Postgres-compatible, true
  scale-to-zero, designed for Lambda-style connection patterns.
- **Drizzle** as the ORM — schema-is-TypeScript, no codegen, no engine binary,
  serverless-friendly cold starts.
- **Google OAuth (PKCE) → app-issued JWT** for auth (same pattern as the existing
  GZ/BL webapps).
- **DynamoDB** is an escape hatch for genuinely key-value-shaped apps, not the default.
- All infra via **AWS CDK** in TypeScript. AWS-only, no third-party vendor lock-in.

### How apps get built and shipped

The template is designed for a workflow where **any internal employee — including
non-technical ones — can scaffold and contribute to an app via GitHub**, while
deployment authority stays narrowly scoped to a small group of gatekeepers
(currently Alex and Anthony). No AWS credentials are ever issued to app creators.

- **Monorepo.** All apps live in a single repository at `apps/<app-name>/`, with
  shared code under `packages/`. Scaffolding a new app is `mkdir apps/foo` (via a
  `pnpm scaffold` script the LLM invokes), not creating a new GitHub repo.
  Creators can see how other apps solve auth, charts, deploy, etc., which is the
  main win for LLM-assisted development across a small fleet.
- **Branch protection on `main`** plus per-path CODEOWNERS: every PR needs both
  the gatekeeper team and the relevant app's owner to approve. A creator
  sneaking a change into another app's directory shows up immediately because
  that app's CODEOWNERS would need to be requested for review.
- **PR-to-deploy lifecycle.** Creator branches → commits in `apps/<their-app>/`
  → opens PR. CI runs path-filtered (only the affected apps' jobs run) and posts
  a `cdk diff`. Gatekeeper + app owner review and merge. Merge to `main` triggers
  a per-app matrix deploy job that assumes an OIDC-federated AWS role scoped to
  that app and runs `cdk deploy`.
- **In-repo LLM coaches non-technical creators** through git/branch/commit/PR
  mechanics in plain English, explains CI failures, and never tries to bypass
  branch protection or deploy locally.

Full rationale, principles, and rejected alternatives are in
[`docs/charter.md`](docs/charter.md).

## Status

- Monorepo restructure landed: `apps/_template/` is a working default-stack
  skeleton (Fastify + Eta + HTMX + Lit, Drizzle + DSQL, LWA Dockerfile, CDK
  stack), with `pnpm scaffold`, path-filtered CI, and the OIDC deploy workflow
  in place. `apps/_template-spa/` holds the React escape-hatch frontend,
  pending rewiring to the unified backbone.
- Typecheck, build, and a local browser smoke test pass; **not yet deployed**.
- Next: the validation round (charter §8.2) — deploy `_template` to gz-dev
  as-is, then build the **real ops dashboard** on the default stack as the
  stress test / kitchen-sink exemplar, then rewire the SPA escape hatch.
  Shared `packages/` get extracted after that round, not before.

## Repo layout

```
├── apps/
│   ├── _template/       # canonical default-stack skeleton (pnpm scaffold copies this)
│   ├── _template-spa/   # React + Vite escape-hatch frontend (pending rewiring)
│   └── <app-name>/      # live apps, one directory each
├── packages/            # shared libs (extracted on real duplication, not before)
├── scripts/             # scaffold.mjs, random-slug.sh, admin IAM bootstrap
├── .github/workflows/   # ci.yml (path-filtered), deploy.yml (per-app OIDC)
└── docs/                # charter, setup, environments, adding-features
```

## Related context

- Existing serverless template (different shape, will be superseded):
  `~/Documents/gz/__github/gz-webapp-template`
- Existing SQLite-on-S3 reference (legacy AppRunner pattern):
  `~/Documents/gz/__github/yeti-inspector-backend`
- BioLite reference (the Django + EC2 timesheet PoC that prompted this discussion):
  `https://github.com/BioLite/burndown`
