# Agent Reference Documentation

Technical reference docs for AI agents working in this monorepo. More detailed
than the human-facing docs in `docs/`. Design rationale lives in
`docs/charter.md` — these docs describe *how*, the charter describes *why*.

## Index

| File | Description |
|------|-------------|
| [structure.md](structure.md) | Monorepo layout, app anatomy, request path through the stack |
| [auth.md](auth.md) | Server-side Google OAuth flow, JWT session cookie, RBAC, allowlist |
| [api.md](api.md) | Route patterns: pages, HTMX fragments, JSON endpoints, Lit decision rule |
| [deploy.md](deploy.md) | CI-only deploys, OIDC roles, stages, first-deploy bootstrap |
| [conventions.md](conventions.md) | Code conventions: TS/ESM, Eta, Drizzle/DSQL, CSS tokens |
| [aws-namespace.md](aws-namespace.md) | AWS namespace (`gzweb`): naming, tags, IAM access model |
