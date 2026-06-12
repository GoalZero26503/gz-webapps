# Authentication & Authorization

Server-side Google OAuth 2.0 (authorization code + PKCE) → app-issued JWT in
an HttpOnly session cookie. No Cognito, no client-side token handling. Code:
`apps/<name>/src/auth/`.

## Login flow

```
GET /login                     unauthenticated landing page (Eta view)
GET /auth/login                generate state + code_verifier, store in gz_oauth
                               cookie (10 min, path=/auth), 302 → Google
GET /auth/callback?code&state  verify state, exchange code (client_secret +
                               code_verifier), gate, set gz_session cookie, 302 → return_to
POST /auth/logout              clear gz_session, 302 → /login
GET /api/me                    JSON: current user (email, name, role, permissions)
```

Two access gates in `completeLogin()` (`src/auth/google.ts`):

1. **Domain**: Google `hd` claim must be in `ALLOWED_DOMAINS`
   (default `bioliteenergy.com`). The Google Workspace tenant is
   `bioliteenergy.com` only — `@goalzero.com` addresses are aliases, can't
   sign in to Google services, and never appear in the `hd` claim or profile
   email. All app user identities (allowlist rows, seed admin, invites) are
   therefore `@bioliteenergy.com` addresses.
2. **Allowlist**: a row in the `users` table with `status = 'active'`. No row
   → "not invited". Exception: `SEED_ADMIN_EMAIL` is auto-created as admin on
   first login so a fresh deploy is never locked out.

## Session

- `gz_session` cookie: HttpOnly, Secure (except local), SameSite=Lax, 7 days.
- Payload (`AppJwtPayload`): `sub`, `email`, `name`, `role`, `permissions`, `iat`, `exp`.
- HS256-signed with `jwt_secret` from SSM (`JWT_SECRET` env locally). Sign and
  verify in `src/auth/jwt.ts` — no JWT library.
- Sessions are not refreshed; after 7 days the user re-authenticates (one
  redirect round-trip — invisible if their Google session is alive).
- Role changes take effect on next login, not mid-session.

## Enforcement

`src/auth/plugin.ts` decorates every request with `request.user`
(null if no/invalid cookie). Routes opt in via preHandlers:

```ts
app.get('/', { preHandler: requireAuth }, ...)
app.get('/users', { preHandler: requirePermission('users:read') }, ...)
```

Unauthenticated handling: full-page GETs redirect to
`/login?return_to=<url>`; HTMX fragment requests (`HX-Request` header) and
`/api/*` get `401` JSON.

## RBAC

`src/auth/types.ts` defines roles (`user`, `admin`), permissions, and
`ROLE_PERMISSIONS`. `canAssignRole` enforces hierarchy: you can only assign
roles strictly below your own. Apps add app-specific permissions to
`PERMISSIONS` and grant them in `ROLE_PERMISSIONS`; permissions are resolved
at login and embedded in the JWT.

## GitHub: linked identity only, never primary

Google is the **only** sign-in method. Do not implement GitHub OAuth as an
app's login, even for developer-facing tools (charter §6.11 has the full
reasoning — seat cost, identity coverage, offboarding).

For apps whose subject matter is GitHub (PR dashboards, repo tooling), the
sanctioned pattern is a **post-login "Connect GitHub" flow**: the
Google-authenticated user links their GitHub account, and the app stores that
credential as a resource connection for calling GitHub APIs on their behalf.
Roles still come from the app's `users` table; GitHub-team-derived roles, if
ever needed, are a server-side sync via a GitHub App installation token — not
a login-path dependency. This linking pattern is per-app custom for now (not
in the template skeleton).

## Google OAuth client (per app, per stage)

Created in Google Cloud Console (type: Web application):
- Authorized redirect URI: `https://<app-domain>/auth/callback`
  (plus `http://localhost:3000/auth/callback` on the dev client for local work)
- Client id/secret → SSM `/gzweb/{app}/{stage}/google_client_id|google_client_secret`
