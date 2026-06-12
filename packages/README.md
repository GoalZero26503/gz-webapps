# packages/

Shared workspace packages consumed by apps under `apps/`.

Nothing lives here yet — deliberately. Shared code is extracted *after* a second
app demonstrates real duplication, not speculatively (YAGNI). Expected first
extractions, per the charter:

- `packages/auth` — Google OAuth flow, JWT signing/verification, RBAC helpers
- `packages/ui` — shared Eta partials, CSS tokens, Lit components
- `packages/infra` — the reusable `WebappStack` CDK construct

Until then, the canonical implementations live in `apps/_template/` and are
copied into each scaffolded app.
