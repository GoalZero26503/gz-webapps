# /gz:webapp:new-app — Scaffold a new app

Scaffold a new app in the monorepo from `apps/_template/`. The heart of this
command is a **conversation, not a form** (charter §3.3): you talk with the
creator about what their app should do, pick the stack yourself, and then run
the scaffold script.

## 1. The conversation

Ask the creator to describe what they want the app to do, who uses it, and
what a typical session looks like. Then choose the frontend stack:

- **Default — SSR (Eta + HTMX + Lit).** This is the answer for nearly every
  app. Tables, forms, dashboards, lists, search, filtering, inline edits,
  reports, file uploads, interactive charts, live-updating tiles, multi-step
  wizards, streaming chat — all confirmed fine for the default stack.
- **Escape hatch — React + Vite SPA.** Only when client-side state is the
  *dominant* UX shape: real-time collaborative editing, offline-first with
  reconciliation, IDE-like surfaces, or sub-50 ms interaction loops. Hearing
  "collaborative", "offline", "editor", "canvas", "feels instant" warrants one
  or two clarifying questions — not an automatic SPA.
  ⚠️ The SPA skeleton (`apps/_template-spa/`) is pending rewiring to the
  unified backbone — check its README before offering it.

Do **not**: run a Y/N feature questionnaire, suggest SPA because they "want it
modern / like Linear", or frame the choice architecturally. Talk about what
the app does; pick the stack yourself.

Also gather:
- **App name**: kebab-case; becomes directory, subdomain, AWS resource infix.
  Offer a playful default from `./scripts/random-slug.sh` if they don't care.
- **Display name** for the UI.
- **Owning business**: GZ (`goalzeroapp.com`) or BL (`bioliteapp.com`).
- **Creator's GitHub handle** (CODEOWNERS) and **admin email** (seed admin).

## 2. Run the scaffold

```bash
pnpm scaffold <app-name> --display "<Display Name>" --owner <gh-handle> --admin <email>
pnpm install
```

## 3. After scaffolding

1. Write the "what this app does and why this stack" section into the new
   app's `README.md` and `.claude/CLAUDE.md` — summarize the conversation and
   the stack reasoning so future contributors understand it.
2. Verify: `pnpm --filter ./apps/<app-name> typecheck && pnpm --filter ./apps/<app-name> build`
3. Walk the creator through branch → commit → push → PR (plain English,
   concrete commands). The gatekeeper review of this PR admits the app to the
   fleet.
4. Point at `docs/setup.md` for the one-time per-app AWS/GitHub setup that a
   gatekeeper does after merge (GitHub Environment, deploy role, Google OAuth
   client, SSM parameters).
