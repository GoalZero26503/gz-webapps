# Charter — Unified Webapp Template

This document captures the *why* behind the unified template: the problem it solves,
the principles we're optimizing for, the chosen stack with rationale for each piece,
and the alternatives we considered and rejected (with reasons).

It is meant to be read end-to-end before contributing to the template, and to be the
artifact a new team member or external collaborator (Anthony, anyone joining BioLite
engineering, a contractor) reads to understand *why* the template looks the way it does.

---

## 1. Problem statement

Goal Zero and BioLite together run a small product-development org. With Claude-assisted
development now mature enough to ship real software, the realistic forecast is **10+ to
several dozen internal webapps over the next two years** — timesheet tools, internal
dashboards, ops utilities, customer-service portals, firmware-fleet inspectors, lab
data viewers, and the long tail of "someone needed a UI for this."

Without a shared template:

- Every new app re-litigates auth, deploy, observability, secrets, IAM, and database
  hosting from scratch.
- A small engineering team can't maintain N parallel stacks.
- Security review and deploy gatekeeping (currently held by a small group) becomes
  impossible if every app is bespoke.
- Operational costs balloon — twenty $30/mo idle apps is $600/mo of largely wasted spend.

A single, well-chosen template solves all four problems simultaneously.

## 2. Driving principles

These are the values we used to pick the stack. When a future decision is in tension,
fall back to these in roughly this order:

1. **One mental model.** A developer who has worked on one app should be productive on
   any other app the same day. One language, one web framework, one infra pattern,
   one auth flow, one deploy story. (The template defaults to a single SSR stack;
   SPA exists as an escape hatch for the narrow cases that need it, but everything
   else is shared.)
2. **Cost discipline at scale.** Whatever we pick must remain defensible at 20+ apps.
   Anything that costs ~$25+/mo per app idle fails this test. Scale-to-zero, or close
   to it, is mandatory.
3. **Relational-first data model by default.** We almost never know up front whether
   an app's access patterns will be key-value or relational. Defaulting to a real SQL
   database keeps the most options open. DynamoDB is reserved for apps whose access
   patterns are *obviously* KV from day one.
4. **Right-size the client.** Default to server-rendered HTML with progressive
   enhancement (Eta + HTMX + Lit) — including for things people reflexively assume
   require an SPA (live updates via SSE/polling, interactive charts as Lit
   components, drag-and-drop within a panel). Escape to a React + Vite SPA only
   when client-side state is the *dominant* UX shape: real-time collaborative
   editing, offline-first with conflict resolution, IDE-like surfaces, or apps
   where partial-HTML round-trips would feel sluggish. The industry has correctly
   cooled on the late-2010s "everything is a SPA" default; we follow that lesson.
5. **TypeScript end-to-end for webapps.** Frontend, backend, infrastructure — same
   language, same types, same tooling, shareable internal libs. Avoids the
   dual-ecosystem tax of a Python or Go backend. Python remains the right tool for
   *offline* work (firmware support tooling, lab data scripts, one-off automation,
   CI helpers) — just not for webapps.
6. **AWS-native, no third-party platform lock-in.** Our infra, IAM, observability, and
   billing all live in AWS already. Adding Vercel, Cloudflare, Turso, Fly.io, etc.
   creates a second control plane to secure, monitor, and budget for. Use AWS unless
   AWS genuinely doesn't offer the capability.
7. **No dead-end services.** A template is a 5+ year commitment. We do not build on
   AWS services in maintenance mode or with publicly stated end-of-life trajectories,
   even if they're currently the cheapest option.
8. **Containerized application code.** Container images are portable, reproducible,
   and let us pick our web framework freely. Whatever runtime we land on (Lambda
   today, ECS tomorrow, somewhere-else later) the same container should be deployable
   with minimal change.
9. **Deployment authority is centralized; contribution is open.** Anyone with a
   GitHub account can scaffold an app and submit changes via PR — including
   non-technical employees, coached through git mechanics by the in-repo LLM. But
   only a small group of authorized deployers (currently Alex and Anthony) can
   approve merges to `main`, and deployment to AWS happens *exclusively* through
   GitHub Actions triggered by such a merge. No AWS credentials are ever
   distributed to app creators or stored on developer machines. See §4.
10. **Templates evolve; deployed apps don't have to.** When the template improves, old
    apps continue to work. We don't auto-migrate; we offer upgrade guides.

## 3. The chosen stack

### 3.1 Shared backbone

Every app built from this template uses the same backend and infrastructure,
regardless of whether the frontend is the default SSR stack or the SPA escape hatch:

| Layer | Choice | Why |
|---|---|---|
| Backend framework | **Fastify** (Node/TS) | Modern, fast, first-class TypeScript, schema-driven validation, healthy plugin ecosystem. Lighter than Next.js/Remix and more actively maintained than Express. Serves HTML for the default SSR stack, JSON for the SPA escape hatch. |
| Backend runtime | **AWS Lambda container image + Lambda Web Adapter (LWA)** | AWS-supported way to run an unmodified Fastify app inside Lambda. Container deploy (Docker familiarity preserved). True scale-to-zero. Pennies-per-app idle cost. Public benchmarks put Node-container cold starts at ~600 ms–1.4 s (Deno benchmark; AJ Stuyvenberg's container deep-dive), and AWS data shows cold starts hit <1% of invocations on a real app — acceptable for internal tools. |
| Backend public entry | **Lambda Function URL** | No API Gateway needed for HTTPS. Free. Fronted by CloudFront so user-facing traffic hits one origin. |
| Database | **Aurora DSQL** | Serverless, Postgres-compatible, scales to zero, distributed, designed specifically for Lambda-style connection bursts (no RDS Proxy band-aid needed). 100k DPU + 1 GB/mo free tier easily covers small internal tools. Migration path is "change connection string + dump/restore." |
| ORM / query layer | **Drizzle** (TS) | Lightweight, schema-is-TypeScript, no codegen step, no engine binary (good for Lambda cold starts), reads like SQL. Better fit for serverless than Prisma. |
| Edge / routing | **CloudFront** | Single user-facing origin for the whole app. TLS termination, custom domains, WAF, edge caching for static assets. Sits in front of the Lambda Function URL (and an S3 bucket when the SPA escape hatch is in use). |
| AuthN/AuthZ | **Google OAuth 2.0 (PKCE) → app-issued JWT** | Same pattern proven in `gz-webapp-template`, `yeti-support-portal`, and `backup-inspector`. Anyone with a company Google Workspace account just logs in. Domain allowlist via Google `hd` claim plus a per-user allowlist in the database. JWT secret in SSM Parameter Store. No Cognito, no separate user pool to manage. RBAC pattern from `lambda/shared/rbac.ts` is reusable. |
| Infrastructure as code | **AWS CDK (TypeScript)** | Same language as the app. Already used in `gz-webapp-template`. Composable constructs let us ship a reusable `WebappStack` that each new app instantiates with a few parameters. |
| Secrets | **SSM Parameter Store** under `/{namespace}/{app-name}/{stage}/*` | IAM-scoped, free for standard parameters, integrates cleanly with Lambda env injection. Namespace TBD (see §7). |
| Deploy | **CDK + GitHub Actions, OIDC-federated to AWS roles** | No long-lived AWS credentials in CI. Authorized-deployer model enforced via IAM trust policies on the deploy roles. |
| Domains | **`goalzeroapp.com` and `bioliteapp.com`** | Two domains managed in-house. Apps get subdomains under whichever business owns them: `{app}.goalzeroapp.com` / `{app}.bioliteapp.com`. |

### 3.2 Frontend stack

The template has one frontend stack and one escape hatch. Both share the entire
backbone above.

#### 3.2.1 Default — Eta + HTMX + Lit (SSR)

| Piece | Role |
|---|---|
| **Eta** | Server-side templating engine. Fastify renders HTML responses via `@fastify/view` with Eta. Lightweight, fast, JS-like syntax. |
| **HTMX** | Declarative interactivity attributes on HTML elements. Handles the bulk of typical interactions ("click this → swap that fragment", SSE-driven live updates, optimistic UI) without writing JS fetch/DOM code. ~14 KB client footprint. |
| **Lit** | Web Components for the parts of the UI that need real client-side state — interactive charts, drag-and-drop within a panel, a stateful multi-step inline editor, a WebSerial bridge, an in-page chat with streaming tokens. Composes naturally with HTMX-rendered HTML. |
| Static assets | Served from the same Fastify container, or optionally an S3 bucket fronted by CloudFront for larger asset sets. |

Per [lorenstew.art](https://www.lorenstew.art/blog/eta-htmx-lit-stack/) and the broader
industry shift in 2024–2026, this stack delivers ~150 KB of client JS on a typical
page vs. 600 KB–2.5 MB for React/Next.js — meaningfully better first paint, less
hydration overhead, simpler mental model.

**Why this is the default:** for the realistic majority of apps we'll build —
including ones people reflexively assume "must be an SPA" because they have charts
or a live feed or a custom input widget — HTMX + Lit covers it. The combo
explicitly handles: live updates (HTMX SSE/polling), interactive charts (Lit
component wrapping Chart.js/D3), drag-drop within a panel (Lit), in-page chat with
streaming tokens (HTMX + SSE, or a Lit component), WebSerial / WebUSB / WebMIDI
access (Lit component), client-side filtering of an already-loaded table (HTMX
+ a Lit component, or just `<details>`/CSS). Defaulting here keeps client bundles
small, first paint fast, and the codebase close to the Fastify-rendered HTML the
developer is already in.

#### 3.2.2 Escape hatch — React + Vite SPA

| Piece | Role |
|---|---|
| **React 19 + Vite 6** | SPA frontend, fast HMR, clean build. |
| **Tailwind CSS 4** | Utility-first styling, consistent design tokens, low decision overhead. |
| **React Router 7** | Client-side routing. |
| Static assets | Built bundle deployed to S3, served via CloudFront. |
| API | Fastify backend serves JSON at `/api/*`. |

**When the escape hatch is justified** — only when client-side state is the
*dominant* UX shape, not just present:

- **Real-time collaborative editing with conflict resolution** (Google-Docs-style,
  CRDT-backed multi-user surfaces).
- **Offline-first apps** that need to function for extended periods without
  network and then reconcile.
- **IDE-like surfaces** with deep client state machines (a code editor, a node
  graph editor, a full design tool).
- **Latency-sensitive UIs** where the round-trip to fetch even a small HTML
  fragment from Lambda would feel sluggish — e.g. an interaction that needs to
  respond in <50 ms across many discrete UI events per second.

The list is intentionally short. Things that *aren't* on it and do not by
themselves push to SPA: a dashboard with live tiles (HTMX SSE), a page with
interactive charts (Lit + Chart.js), a form with conditional fields (HTMX swap),
drag-and-drop within a single panel (Lit), a multi-step wizard (HTMX-driven),
inline editing of a row in a table (HTMX swap).

### 3.3 How the frontend choice is made at scaffold time

The choice is **conversational, not a form.** The scaffolding LLM (see §4.1) talks
with the creator about what their app is supposed to do and chooses the default
SSR stack unless the description hits one of the §3.2.2 escape-hatch shapes.

What the LLM should listen for in the conversation:

- **Things that confirm the default is fine** (most common): tables, forms,
  dashboards, lists, search, filtering, inline edits, reports, file uploads,
  read-mostly data, occasional interactive charts, status pages, a chat that
  streams responses, occasional live updates.
- **Things that warrant probing for an escape-hatch case** (rare): the words
  "collaborative", "offline", "real-time multi-user", "design tool", "editor",
  "drawing/canvas with heavy interactivity", "node graph", "feels instant" /
  "60 fps". Hearing one of these isn't an automatic SPA — the LLM should ask one
  or two clarifying questions to see whether the actual shape matches §3.2.2 or
  whether HTMX + Lit still covers it.

What the LLM should **not** do:

- Run a fixed multiple-choice questionnaire ("does your app need charts? Y/N").
  Most "yes" answers to such questions are misleading — interactive charts, live
  refresh, drag-and-drop in a panel, and similar features all work fine in the
  default stack. The form would over-prescribe SPA.
- Suggest SPA because the creator says they "want it to feel modern" or "like
  Linear/Notion." Both Linear and Notion-style polish are achievable in the
  default stack; what isn't achievable is multi-user collaborative editing.
- Frame the choice as architectural to the creator. Talk in terms of what the
  app does for users, then pick the stack itself.

The chosen stack and the reasoning the LLM used to pick it are written into the
generated app's README so future contributors understand why the app uses the
stack it does.

### 3.4 What "one CloudFront, one origin" buys us

Regardless of which frontend the app uses, CloudFront fronts the entire app:

- **Default (Eta + HTMX + Lit)**: all paths → Lambda Function URL (Fastify serves
  HTML and any JSON endpoints).
- **SPA escape hatch (React + Vite)**: `/*` → S3 bucket (the React bundle),
  `/api/*` → Lambda Function URL.

In either case the browser sees one origin, giving us:

- **No CORS.** The browser sees one origin.
- **One custom domain.** `app.goalzeroapp.com` or `app.bioliteapp.com` covers the
  whole app.
- **One place for WAF, rate limiting, and edge caching.**
- **One TLS certificate to manage.**

The existing `gz-webapp-template` doesn't yet route `/api/*` through CloudFront — it
exposes API Gateway at its own AWS domain and uses `allowOrigins: ['*']`. The unified
template fixes this.

### 3.5 Escape hatches

The template is opinionated, but a few apps will need to deviate:

- **Genuinely KV-shaped data** (session stores, simple lookup tables, event logs):
  drop Aurora DSQL, use DynamoDB. Same Fastify + Lambda + CloudFront shell.
- **WebSockets or Server-Sent Events**: Lambda Function URLs don't support
  WebSockets. Add API Gateway WebSocket API as a separate piece for the realtime
  channel.
- **Long-running background jobs** (>15 min): not Lambda's domain. Run as a separate
  Lambda zip with EventBridge, or as a Step Functions state machine. Don't put it
  inside the request-handling container.
- **Large file uploads/downloads** (>6 MB): use S3 presigned URLs from the Fastify
  handler. Don't stream large bodies through Lambda.
- **Truly always-on workloads with steady traffic** (rare for internal tools): may
  be cheaper on Lightsail Containers or ECS than on Lambda. Re-evaluate per app.

## 4. Contribution and deployment workflow

The template is designed so any internal employee — including non-technical
ones — can scaffold and contribute to an app via GitHub, while deployment
authority stays narrowly scoped to a small group of gatekeepers (currently
Alex and Anthony). No AWS credentials are ever issued to app creators.

### 4.1 Roles

- **App creator**: any internal employee with a GitHub account. May be
  non-technical (a customer-service lead, an ops manager, a lab tech). They
  describe what they want, work with the in-repo LLM to write the code, and
  open a PR. They have `write` access to their app's repo but cannot push to
  `main` or change branch-protection settings.
- **Gatekeeper**: Alex or Anthony. Reviews PRs, approves merges, monitors the
  fleet. The only people with AWS deploy authority.
- **In-repo LLM** (Claude, configured via `.claude/CLAUDE.md` in each app
  repo): coaches the creator through git/branch/commit/PR mechanics; explains
  CI errors and review feedback in plain English; never attempts to push
  directly to `main` or bypass branch protection.

### 4.2 Repository structure: monorepo

All apps live in a single repository under `apps/<app-name>/`. Shared code
lives under `packages/<lib-name>/`, wired together via pnpm workspaces.

```
gz-webapps/
├── apps/
│   ├── _template/         # canonical skeleton; copied for new apps
│   ├── timesheet/
│   ├── ops-dashboard/
│   └── ...
├── packages/              # shared libs (auth, ui, infra constructs)
├── .github/workflows/
│   ├── ci.yml             # path-filtered: only runs jobs for changed apps
│   └── deploy.yml         # per-app, OIDC-federated, triggered on merge
├── pnpm-workspace.yaml
└── README.md
```

Rationale:

- **Discovery and cross-reference.** Creators (and their LLM) can see how
  existing apps solve auth, charts, deploy, etc. — the single biggest
  productivity win when most apps are LLM-assisted CRUD that should look the
  same. Pattern drift across the fleet is much harder to sustain when every
  app is visible at once.
- **Operational overhead doesn't scale with app count.** One ruleset, one
  CODEOWNERS, one set of secrets, one set of OIDC trust scopes to maintain.
  20-30 repos to administer is a real tax.
- **Scaffolding is `mkdir apps/foo`, not `gh repo create`.** No GitHub App,
  no per-repo permission wiring, no OIDC trust setup per app. The friction
  for non-technical creators drops to ~zero.
- **Gatekeeping is unchanged.** Branch protection on `main` + CODEOWNERS at
  `apps/foo/ @creator-handle @webapp-gatekeepers` gives the same "no merge
  without gatekeeper approval" guarantee that polyrepo would have, and a
  per-path CODEOWNERS entry stops a creator from sneaking changes into
  another app's directory without that app's owner approving.

What we give up vs. polyrepo, and how it's handled:

- *Physical prevention of cross-app code touching*: replaced by per-path
  CODEOWNERS + the gatekeeper review that we'd have done anyway.
- *Independent dependency versioning*: pnpm workspaces let each app pin its
  own deps in `apps/<name>/package.json`; only genuinely shared packages
  need coordinated upgrades.
- *Small-by-construction CI*: replaced by `paths:` filters and
  matrix-per-app jobs; CI runs only for the apps a PR actually touches.

### 4.3 Lifecycle: scaffolding a new app

1. Creator chats with the scaffolding LLM (Claude in their cloned working
   copy of the monorepo, or in a designated playground repo). The LLM picks
   the frontend stack conversationally per §3.3 (default SSR unless the
   description hits a specific escape-hatch shape) and gathers app name,
   description, owning business (GZ or BL), and intended contributors.
2. The LLM (or a thin `pnpm scaffold` script invoked by the LLM) creates
   `apps/<app-name>/` from `apps/_template/`, substituting names and
   defaults. It also appends a CODEOWNERS entry — `apps/<app-name>/
   @<creator-handle> @goalzero26503/webapp-gatekeepers` — so future PRs
   touching that app require both creator and gatekeeper sign-off.
3. Creator commits the scaffold on a feature branch and opens a PR. The
   gatekeeper review on this PR is the moment the new app is admitted to
   the fleet.
4. On merge, the deploy workflow (see §4.5) runs CDK against the new app's
   stack on first commit, which provisions its AWS resources and its IAM
   role. No GitHub Apps, no separate `app-registry`, no per-repo OIDC
   trust setup.

### 4.4 Lifecycle: making a change

1. Creator clones the monorepo (LLM walks them through if needed) and `cd`s
   into `apps/<their-app>/`.
2. Creates a feature branch (LLM-coached). Convention: `<gh-username>/<short-description>`.
3. Works with the LLM to make changes inside their app's directory (or
   `packages/` only when the change is genuinely shared).
4. Commits with a clear message (LLM drafts; creator approves).
5. Pushes the branch — push to `main` is blocked by branch protection;
   push to a feature branch succeeds.
6. Opens a PR (LLM-assisted, including what changed and why).
7. CI runs only the jobs for paths the PR actually touches: lint, typecheck,
   tests, and `cdk diff` for the affected app(s).
8. CODEOWNERS auto-requests review from the app owner(s) and the gatekeeper
   team. Both must approve before merge.

### 4.5 Lifecycle: deploy

- Merge to `main` triggers `.github/workflows/deploy.yml`, which runs a
  per-app matrix job — only the apps whose paths changed in that commit
  are deployed.
- Each app's job assumes its own AWS deploy role via OIDC. The trust
  policy on each role is scoped to the monorepo, the `main` branch, and a
  specific job identity (e.g., `job_workflow_ref` + an `environment:` claim
  matching the app name). No long-lived AWS credentials live in GitHub
  Actions secrets.
- `cdk deploy` runs against the target environment (stage selection
  determined by workflow input or environment branch).
- Deploy status posts back to the PR/commit and to a Slack channel
  (channel TBD — see §7).

### 4.6 Access control specifics

- **Branch protection on `main`** is configured directly on the monorepo
  (no org-level ruleset needed):
  - PR required; direct pushes to `main` blocked.
  - Approval required from a CODEOWNER (the gatekeeper team, and the
    relevant app's owner via the per-path entry).
  - All CI status checks must pass.
  - No force pushes, no branch deletions.
- **CODEOWNERS** has one root entry for the gatekeeper team plus per-path
  entries per app (`apps/foo/ @foo-owner @goalzero26503/webapp-gatekeepers`).
  Scaffolding adds the per-path entry; review-without-this-entry is the
  failure mode that catches "creator sneaks a change into another app's
  directory" — gatekeeper sees the unrequested cross-app change in the diff.
- **AWS OIDC trust policy** for each app's deploy role is scoped to:
  - The monorepo (`repo:<org>/gz-webapps:*`)
  - The `main` branch (`ref:refs/heads/main`)
  - A claim identifying the app (the deploy workflow's `environment:` set
    to the app name, or `job_workflow_ref` pointing at the per-app job).
  This means the timesheet deploy role can only be assumed by the
  timesheet's job on `main`, even though all apps share the repo.
- **AWS resource scoping** via the IAM namespace prefix (see §7) ensures
  each app's deploy role can only touch resources named for that app.
- **No repo-creation automation needed.** Adding an app is a directory
  change inside the existing repo, gated by the same PR mechanism as any
  other change. The "creator becomes admin of their own repo" failure mode
  doesn't exist — there is no per-app repo.

### 4.7 What the in-repo LLM coaches creators through

The template's `.claude/CLAUDE.md` (and equivalents for other coding
agents) makes the LLM aware of:

- The creator may be non-technical and needs git/branch/commit/PR coaching
  in plain English, with concrete commands.
- Direct push to `main` will fail; work on a branch and open a PR.
- Branch naming and commit-message conventions for this repo.
- PR description template: what changed, why, how to test, any
  infrastructure impact.
- After opening the PR, tag the gatekeeper team for review.
- If CI fails, explain the error and propose a fix; never instruct the
  user to bypass CI or branch protection.
- AWS-touching actions (`cdk deploy`, `aws ...` with write permissions)
  are not for the creator's local machine — only for CI. If something
  seems to require this, the LLM should explain why the right move is a
  PR rather than a local deploy attempt.

## 5. Cost model

Per-app idle cost is the binding constraint at 20+ apps. Approximate numbers:

| Stack | Idle cost / app | 20 apps idle |
|---|---|---|
| ECS Express Mode + ALB + Fargate min=1 task | ~$25–35/mo | ~$500–700/mo |
| AWS App Runner (1 vCPU / 2 GB provisioned) | ~$5/mo | ~$100/mo |
| Lightsail Containers (Nano tier) | $7/mo fixed | $140/mo |
| **This template (Lambda Web Adapter + Function URL)** | **~$0/mo** | **~$0–40/mo** |

The Aurora DSQL free tier (100k DPU + 1 GB/mo, applied per account, not per cluster)
likely covers the long tail of small internal tools at $0/mo on the database side too.

For an app that gets actual traffic, costs scale with usage on every component — but
that's expected and acceptable. The discipline is on the **idle floor**.

## 6. Alternatives considered

Recording rejected options so future-us doesn't re-litigate them.

### 6.1 Django + EC2 (Anthony's original proposal, based on `BioLite/burndown`)

- **Strengths:** Mature batteries-included framework; admin, ORM, forms, auth,
  migrations out of the box; one process, one box, dead simple; relational-native;
  great for CRUD/forms-heavy internal tools.
- **Why rejected:** Two reasons that compound:
  1. *Django requires the always-on container/EC2 model.* Django's whole design
     assumes a long-running WSGI/ASGI process (persistent connection pool, app
     registry, session middleware). It can technically run on Lambda via Mangum +
     LWA, but cold starts are materially worse (2–5 s for typical apps) and the
     value proposition of "batteries-included long-running server" is undermined.
     So "Django" in practice means ECS Express Mode or EC2, which hits the
     ~$25–35/mo per-app cost floor (~$500–700/mo for 20 apps).
  2. *Ecosystem unification.* Adding a Python webapp lane to a TS-everywhere org
     doubles maintenance surface, hiring profile, internal library investment, and
     security-review effort.
- **What about Python without Django (Flask, FastAPI)?** Python is a first-class
  LWA runtime — Flask/FastAPI in Lambda containers cold-start in the same
  ~600 ms–1.4 s range as Node. The *cost* argument doesn't apply. But "Python
  without Django" gives up Anthony's actual ask (Django's batteries) while still
  incurring the dual-ecosystem cost with the inevitable TS frontend. Not worth it.
- **Anthony's response (2026-05-18):** agreed on full TypeScript stack; came around
  on the Django question voluntarily.
- **Python remains the right tool for offline work** — firmware support tooling,
  lab data scripts, one-off automation, CI helpers. Just not for webapps.

### 6.2 Next.js / Remix (full-stack React frameworks with SSR)

- **Why rejected:** Our default is Eta + HTMX + Lit (SSR) with React + Vite as a
  narrow SPA escape hatch — neither shape is Next.js/Remix-shaped. Next.js's
  value — server-rendered React with selective hydration — is real but pulls in
  significant framework lock-in (file-based routing, build pipeline, Vercel-shaped
  deploy gravitational pull) for a benefit we get more cheaply by either
  server-rendering with Eta/HTMX (much smaller JS bundles) or shipping a plain
  Vite SPA when an escape-hatch case genuinely warrants it.

### 6.3 Express.js

- **Why rejected:** Effectively in maintenance mode (Express 5 only just shipped
  after years of dormancy; ecosystem still largely on Express 4). Fastify is
  materially faster, has better TypeScript support, and has more momentum.

### 6.4 AWS App Runner

- **Status:** In maintenance mode as of April 30, 2026. No new customers accepted.
  Existing customers (including GZ accounts that already host
  `yeti-inspector-backend`) can still create new services, but no new features will
  be added.
- **Why rejected for the unified template:** Building a 5-year template on a service
  AWS has publicly committed not to invest in is asking for a forced migration in
  18–36 months. Cost-attractive, but the dead-end trajectory disqualifies it.

### 6.5 ECS Express Mode

- **Why rejected as default:** ALB (Application Load Balancing) cost (~$16–22/mo)
  plus a minimum running Fargate task (~$9/mo) gives a fixed floor of ~$25–35/mo
  per app. At 20 apps that's ~$500–700/mo just in idle infrastructure.
  Indefensible at our scale.
- **Still the right answer** for an app that genuinely needs always-on container
  semantics, WebSockets at scale, or workloads that exceed Lambda's limits.

### 6.6 Lightsail Containers

- **Why rejected:** Fixed $7/mo/app even for the Nano tier; doesn't scale to zero.
  $140/mo for 20 apps is better than ECS EM but still ~$140 worse than the Lambda
  Web Adapter path. The fixed pricing is appealing for budgeting, but we lose the
  variable-cost discipline.

### 6.7 Lambda zip + native handler

- **Why rejected as the *default*:** Each route needs to be a Lambda handler with
  API Gateway routing — exactly the shape of the current `gz-webapp-template`.
  That pattern works but produces more boilerplate per app and ties developers
  into Lambda-specific code shape. With LWA, the same Fastify code could in
  principle run on ECS or any container host later — Lambda is a deployment
  choice, not a code constraint.
- **Still appropriate** for the rare app that's just two or three endpoints and
  obviously KV-shaped — but that's an escape hatch, not the template.

### 6.8 Aurora Serverless v2 (Postgres)

- **Why not preferred over DSQL:** Aurora Serverless v2 now scales to zero
  (changed earlier in 2025), but it's still a single-region, single-writer
  Postgres with traditional connection-pool limits — needs RDS Proxy in front for
  Lambda. DSQL is purpose-built for the connection-burst Lambda pattern,
  distributed by default, and has a more generous free tier for small workloads.
- **Worth re-evaluating** if a specific app needs Postgres extensions DSQL doesn't
  support (DSQL is wire-compatible with Postgres but doesn't have full feature
  parity).

### 6.9 SQLite + Litestream on EBS-attached Fargate

- **Why not chosen as default:** This is the polished modern form of the
  `yeti-inspector-backend` pattern, but it inherits the same ECS EM cost floor
  (~$25–35/mo) and adds the single-writer constraint of SQLite. For the rare app
  that fits, it's a great option — but DSQL covers the same use case with no cost
  floor and no single-writer constraint.

### 6.10 LiteFS / Turso / Cloudflare D1

- **Why rejected:** LiteFS is in pre-1.0 limbo (Fly.io sunset LiteFS Cloud in Oct
  2024, active development deprioritized). Turso and D1 are interesting but pull
  data outside AWS, add a second vendor to secure and budget for, and break the
  "AWS-native" principle. None are good defaults for an internal AWS-only fleet.

### 6.11 GitHub OAuth as the identity provider

- **Context (2026-06-12):** Dorian (BioLite firmware) built a webapp loosely
  based on the old template using GitHub OAuth instead of Google. The
  underlying instinct — "we already maintain access groups in GitHub, reuse
  them" — deserves an answer on record.
- **Why rejected as primary sign-in:**
  1. *Identity coverage.* Every employee has a company Google Workspace
     account by construction; that's the corporate identity provider. GitHub
     accounts are opt-in, often personal, and each org member is a paid seat
     on paid plans. The fleet's user base (§4: CS leads, ops managers, lab
     techs) is exactly the population least likely to have one. "Who can use
     internal apps" must not be coupled to "who we pay GitHub seats for."
  2. *Offboarding.* Disabling a Google account ends access to every app the
     same day. GitHub org membership is a separate offboarding step on top of
     a personal account that persists. There is no clean equivalent of the
     Google `hd` domain claim — org-membership checks need an extra API call
     and an org-read scope grant.
  3. *One mental model (§2.1).* Two blessed sign-in paths means two login
     flows, two secret sets per app, and two failure modes — for zero new
     capability, since the per-user allowlist + roles in the database already
     handles authZ.
- **The sanctioned pattern — "Connect GitHub" as a linked identity, never the
  primary identity driver:** for apps whose subject matter *is* GitHub (PR
  dashboards, repo tooling), sign-in stays Google; the app offers a
  post-login "Connect GitHub" OAuth flow and stores the linked credential as
  a resource connection for calling GitHub APIs as that user. If an app ever
  genuinely needs GitHub-team-derived permissions, the shape is a server-side
  sync (GitHub App installation token mapping team membership → app role at
  login or on a schedule) — viewers without GitHub accounts can still be
  granted roles manually, and no seat is required just to use the app. This
  linking pattern is per-app custom for now, not part of the template
  skeleton; extract to `packages/` only when a second app needs it.

## 7. Open questions

These are not blockers but should be resolved before the template repo is finalized.

- ~~**Auth.**~~ **Resolved 2026-05-18.** Google OAuth 2.0 (PKCE) → app-issued
  JWT — the existing pattern from `gz-webapp-template`, `yeti-support-portal`, and
  `backup-inspector`. Domain allowlist via Google `hd` claim plus a per-user
  allowlist in the database. No Cognito.
- ~~**Cold-start budget.**~~ **Resolved 2026-05-18.** Public benchmarks put Node +
  LWA container cold starts at ~600 ms–1.4 s; AWS data shows cold starts hit <1%
  of invocations on a real app. Acceptable for internal webapps. PoC skipped.
- ~~**Monorepo vs polyrepo.**~~ **Resolved 2026-05-18 (monorepo, after
  reconsidering polyrepo).** Initial call was polyrepo for blast-radius
  isolation. Reversed once we recognized that gatekeeper-only merges to `main`
  already provide the same protection (CODEOWNERS per-path enforces who can
  approve cross-app changes), and the monorepo wins are substantial:
  discovery / cross-app reference for LLM-assisted dev, ~zero scaffolding
  friction for non-technical creators (`mkdir apps/foo` vs. `gh repo create` +
  permission wiring + OIDC trust setup), and operational overhead that doesn't
  grow with app count. See §4.2 for the full structure.
- **Naming / IAM namespace.** Leaning toward a unified `web-` AWS resource prefix
  with apps deployed under `goalzeroapp.com` and `bioliteapp.com`. Final call
  deferred until the Django-lane question below is resolved — if BL keeps a
  parallel Django lane, per-business `gzweb-` / `blweb-` prefixes make more sense
  for IAM scoping.
- **Does BL retain a parallel Django lane?** Pending Anthony's call. As of
  2026-05-18 he's agreed to full TS for new apps, but we haven't formally retired
  the Django option for apps the BL team might choose to own end-to-end.
- **Gatekeeper team.** Create a GitHub team (`@goalzero26503/webapp-gatekeepers`?)
  so the root CODEOWNERS entry references a team, not individual handles, and
  adding/removing a gatekeeper is a team-membership change rather than a
  CODEOWNERS edit.
- **Per-app OIDC scoping mechanism.** Two viable shapes — (a) GitHub
  Environments per app, with the deploy job declaring `environment:
  <app-name>` and each AWS role's trust policy keyed on that claim, or
  (b) reusable workflow per app referenced from the matrix, with trust
  keyed on `job_workflow_ref`. (a) is more discoverable in the GitHub UI
  and keeps protected-environment-style approvals available; (b) keeps the
  workflow tree flatter. Lean (a). Pick during the PoC.
- **`apps/_template/` shape.** Decide whether the scaffold skeleton lives
  as a real directory under `apps/` (copied by the scaffold script and
  excluded from CI/deploy) or as a separate `tools/scaffold-template/`
  directory. Real directory under `apps/_template/` is the simpler default.
- **Slack channel for deploy notifications.** Per-app channel,
  central `#webapp-deploys`, both? Lean central by default; per-app on
  request.
- **Local dev story.** Container + LWA + Function URL is great in AWS, less great
  locally. Plan is to run Fastify directly (`fastify start`) for local dev — the
  LWA layer is only needed when packaged for Lambda. To be documented in the
  template README.
- ~~**Default-stack PoC.**~~ **Superseded 2026-06-12** by the risk-ordered
  validation round in §8.2: deploy `_template` to gz-dev, then build the real
  ops dashboard as the default-stack stress test (no throwaway CRUD app), then
  rewire the SPA escape hatch. Local validation already done on the template
  itself (typecheck/build/browser smoke test; three bugs found and fixed).
- **Migration path for the existing `gz-webapp-template` apps.** None deployed
  yet (template is brand new and still placeholder-named). Recommend: hold off
  scaffolding new apps until unified template ships.

## 8. Next steps

1. ~~Walk Anthony through this charter and get his reaction.~~ **Done
   2026-05-18.** Anthony agreed on full TS stack, agreed Aurora DSQL obsoletes
   the SQLite-for-simplicity argument, raised a valid concern about SPAs being
   over-prescribed (originally prompted a dual-mode wizard), and on follow-up
   pushed back on the prescriptive 3-question form — pointing out that HTMX +
   Lit handles cases that the form would have railroaded to SPA (his knowledge
   base chat and WebSerial demo as examples). §3.2 and §3.3 now reflect
   default-SSR with a narrow, conversationally-chosen SPA escape hatch.
2. **Validation round — one prototype per risk, not per feature** (plan
   updated 2026-06-12; supersedes the original "small CRUD PoC"). The
   this-or-that forks in the template (SSR vs SPA frontend, DSQL vs DynamoDB
   data) can't share one prototype, so the round is a small portfolio,
   risk-ordered. Validation apps live in `apps/` like any other app and double
   as the permanent reference apps the monorepo model depends on.
   1. **Deploy the template to gz-dev.** Mechanically: `pnpm scaffold
      hello-fleet ...` and deploy *that* — deploy.yml deliberately skips
      `_`-prefixed skeletons, and scaffolding first exercises the scaffold
      path for real. Retires the biggest unknowns in one shot: Docker build
      in CI, OIDC deploy-role wiring, image size and real cold starts, DSQL
      provisioning + IAM-token auth + `drizzle-kit push` compatibility,
      OAuth on a real CloudFront domain, and measured idle cost. Blocked on
      the per-app gatekeeper setup (deploy role, SSM params, Google OAuth
      client — `docs/setup.md`), which itself is blocked on the repo rename
      to `gz-webapps` (OIDC trust policies are scoped to
      `repo:GoalZero26503/gz-webapps`; roles wired under the old name won't
      match).
   2. **`apps/gzops` — the gzops portal rebuild, built on the default
      stack.** (Merged 2026-06-12 with the 2601-gzops-v2 plan: this IS the
      "real ops dashboard" — one app, not two. Screen spec and phased plan:
      `~/Documents/gz/projects/2601-gzops-v2/ui-prototype/` and
      `.agents/design/webapp-template-alignment.md` in that project.) Not a
      throwaway: a production app that doubles as the default-stack stress
      test and the kitchen-sink exemplar. It exercises the "people assume
      this needs an SPA" list: SSE-driven live deploy tiles (validates LWA
      response streaming (`AWS_LWA_INVOKE_MODE=RESPONSE_STREAM`) through
      CloudFront without buffering — asserted in §3.2.1 but never run; wire
      the deploy-progress tile end-to-end FIRST since a buffering failure
      would force a polling redesign), Lit islands (program-editor preview),
      presigned S3 transfers, and EventBridge-fed data (§3.5). One scope
      note: gzops keeps **DynamoDB** per the §3.5 KV escape hatch — so this
      app also validates the KV fork (un-deferring it), and **DSQL
      validation rests on step (i) plus the first relational app.** If this
      app fights HTMX + Lit anywhere, we learn it here, not in the fleet's
      first creator-built app.
   3. **Rewire `apps/_template-spa` onto the unified backbone** so the SPA
      escape hatch is real: S3 bundle behind CloudFront `/*`, `/api/*` →
      Function URL, cookie-session auth from the SPA (see its README for
      the known gaps).
   4. **Deferred:** the DynamoDB fork (lowest novelty — DynamoDB is run in
      production here daily; wait for the first genuinely KV-shaped app)
      and the side-by-side React bundle-size comparison (the deployed
      template already measures the default stack's footprint).
   5. **Modularize as the output of this round, not the input.** After
      (ii) and (iii) exist, the real duplication defines what
      `packages/auth` and `packages/infra` (`WebappStack`) should be —
      extract then, per the extract-on-second-use rule.
3. Resolve the remaining open questions in §7 (IAM namespace, Django lane,
   ruleset scope, gatekeeper team, deploy-notification channel, local dev).
4. ~~Restructure the repo into the monorepo shape from §4.2.~~ **Done
   2026-06-12** on `feature/unified-template`: `apps/_template/` (working
   default-stack skeleton), `apps/_template-spa/` (escape-hatch frontend,
   pending rewiring to the unified backbone — see its README), `packages/`,
   `pnpm-workspace.yaml`.
5. ~~Migrate the existing template's reusable pieces.~~ **Done 2026-06-12.**
   RBAC/JWT/OAuth rewritten for the server-side flow in
   `apps/_template/src/auth/`; GZ theme tokens in `public/styles.css`; IAM
   admin scaffolding kept at `scripts/admin/`; CDK rebuilt as `WebappStack`
   (DSQL + Lambda container + CloudFront). The old zip-Lambda + API Gateway +
   DynamoDB stack is deleted (lives in git history).
6. ~~Author the conversational scaffolding flow (§3.3 + §4.3).~~ **Done
   2026-06-12**: `pnpm scaffold` (`scripts/scaffold.mjs`) + the coaching doc
   `.claude/commands/gz:webapp:new-app.md`.
7. Set up branch protection on `main` and create the
   `@goalzero26503/webapp-gatekeepers` team for the root CODEOWNERS entry
   (the CODEOWNERS file already references it).
8. ~~Build `.github/workflows/`.~~ **Done 2026-06-12**: `ci.yml`
   (path-filtered typecheck/build/synth per changed app; `cdk diff` PR
   comment still TODO pending the per-app OIDC read roles) and `deploy.yml`
   (per-app matrix, GitHub-Environment-scoped OIDC, deploy + drizzle
   migration on merge to `main`).
9. ~~Author the in-repo `.claude/CLAUDE.md`.~~ **Done 2026-06-12**: root
   `.claude/CLAUDE.md` (creator coaching per §4.7) + per-app
   `.claude/CLAUDE.md` via the scaffold.
10. ~~Document the developer workflow.~~ **Done 2026-06-12**: `docs/setup.md`
    (creator + gatekeeper halves), `docs/adding-features.md`,
    `docs/environments.md`, and `.agents/docs/*` rewritten for the unified
    stack.
