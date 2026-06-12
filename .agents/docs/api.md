# Routes & Fragments

The backend serves three kinds of responses, all from Fastify routes under
`src/routes/`. Pick the lightest one that satisfies the feature.

## 1. Pages — full HTML documents

Server-rendered Eta views for navigations. Route in `src/routes/pages.ts`:

```ts
app.get('/things', { preHandler: requireAuth }, async (request, reply) => {
  const things = await getDb().query.things.findMany();
  return reply.view('things.eta', { user: request.user, things });
});
```

View starts with `<% layout('layout') %>`; the layout provides topbar/nav and
loads HTMX + the Lit bundle. Pass `user` so the layout renders the chrome.

## 2. Fragments — HTML partials for HTMX (the default for interactivity)

Endpoints that take a form body and return a *rendered partial*, not JSON.
Example from the template (`src/routes/users.ts` + `views/partials/`):

```html
<form hx-post="/users/invite" hx-target="#users-section" hx-swap="outerHTML">
```

```ts
app.post('/users/invite', { preHandler: requirePermission('users:invite') },
  async (request, reply) => reply.view('partials/users-section.eta', {...}));
```

Rules:
- Partials live in `views/partials/` and must be self-contained fragments.
- **Return 200 with the error rendered inside the fragment** — HTMX does not
  swap 4xx responses by default. See the `users-section` pattern.
- Form bodies via `@fastify/formbody`; type them with the route generic.
- Live updates: `hx-trigger="every 10s"` polling first; SSE when polling is
  genuinely too coarse.

## 3. JSON — `/api/*`

For Lit components and programmatic consumers. Same preHandler guards; return
plain objects. The template ships `/api/me`.

## When does a widget become a Lit component?

Fragment-first. Reach for Lit (`client/components/`, registered in
`client/index.ts`) only when the widget holds **client-side state across
interactions** that fragment swaps can't express: hover/selection state in a
chart, drag-in-progress, a multi-step inline editor, WebSerial/WebUSB access,
streaming token display. A component that just fetches-and-renders should be
an HTMX fragment instead.

Lit components read theme via `--gz-*` CSS custom properties and talk to the
backend via `/api/*` JSON (cookie auth rides along automatically).

## Adding a permission

1. Add the key to `PERMISSIONS` and grant it in `ROLE_PERMISSIONS`
   (`src/auth/types.ts`).
2. Guard routes with `requirePermission('<key>')`.
3. Gate UI affordances in views with
   `it.user.permissions.includes('<key>')` — hide what the user can't do.
