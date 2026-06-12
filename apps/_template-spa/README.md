# _template-spa — React + Vite escape hatch (frontend only)

This is the **SPA escape hatch** frontend skeleton, kept from the original
`gz-webapp-template`. It is *not* a complete app: an escape-hatch app uses the
same backbone as `apps/_template/` (Fastify + Lambda Web Adapter + Aurora
DSQL + CDK) with this React frontend served from S3 instead of Eta views.

Per [docs/charter.md](../../docs/charter.md) §3.2.2, this path is justified
only when client-side state is the *dominant* UX shape: real-time
collaborative editing, offline-first, IDE-like surfaces, or sub-50 ms
latency-sensitive interactions. Charts, live tiles, drag-drop, wizards, and
streaming chat all stay in the default stack.

## Status

⚠️ **Pending rewiring** (charter §8). Carried over as-is from the old
template, so it still assumes the old zip-Lambda + API Gateway backend:

- `src/lib/auth.ts` does browser-side PKCE against `/auth/google/*` JSON
  endpoints; the unified backbone does the OAuth flow server-side and sets a
  session cookie. The SPA flow needs to be reconciled with
  `apps/_template/src/auth/` (likely: keep the cookie session, drop the
  client-side token handling).
- `.env.dev` / `.env.prod` reference an API Gateway URL; the unified shape is
  same-origin `/api/*` through CloudFront — no CORS, no separate API domain.
- There is no CDK here; an escape-hatch app copies `apps/_template/cdk/` and
  adds the S3 bucket + CloudFront `/*` → S3, `/api/*` → Function URL split.

Do not scaffold new apps from this directory until that rewiring lands. The
scaffold script only offers it once `pnpm scaffold --spa` is unblocked.
