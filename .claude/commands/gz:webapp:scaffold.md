# /gz:webapp:scaffold — Add features to an existing app

Scaffold a page, fragment endpoint, Lit component, or database table inside
the app the user describes. Work from the patterns already in the app (they
came from `apps/_template/`); don't invent new ones.

## Decide the shape first

| The user wants… | Scaffold |
|---|---|
| A new screen | Eta view + route in `src/routes/pages.ts` |
| "When I click X, Y updates" | HTMX attribute on the element + an endpoint returning a partial |
| Live-updating data | HTMX polling (`hx-trigger="every 10s"`) or SSE fragment swap |
| A stateful widget (chart w/ hover, drag-drop, multi-step inline editor) | Lit component in `client/components/` |
| Storing new data | Drizzle table in `src/db/schema.ts` + migration |

Default to the simplest row that satisfies the ask. A Lit component that just
fetches-and-displays should have been an HTMX fragment.

## Page

1. `views/<name>.eta` starting with `<% layout('layout') %>`.
2. Route in `src/routes/pages.ts` with `preHandler: requireAuth` (or
   `requirePermission('<perm>')` for restricted pages).
3. Nav link in `views/layout.eta` if it's a top-level page.

## Fragment endpoint (HTMX)

1. Partial in `views/partials/<name>.eta` — a self-contained HTML fragment.
2. Route (usually in a feature-named file under `src/routes/`) that takes a
   form body, does the work via Drizzle, and returns
   `reply.view('partials/<name>.eta', {...})`.
3. Trigger markup: `hx-post`/`hx-get` + `hx-target` + `hx-swap` on the page.
4. Errors must render *inside* the swapped fragment (HTMX ignores 4xx bodies
   by default) — follow the `users-section` pattern in the template.

## Lit component

1. `client/components/<gz-name>.ts`, registered in `client/index.ts`.
2. Use `--gz-*` CSS custom properties for theming; keep it dependency-free if
   possible (bundle size is a feature of this stack).

## Table

1. Add to `src/db/schema.ts`. DSQL notes: no foreign-key constraints, no
   serial columns — use text/uuid keys; enforce relations in code.
2. `pnpm db:generate` and commit the migration under `drizzle/`.
3. Queries through `getDb()` — never raw SQL strings in routes.

## Always

- `pnpm typecheck` after each change; fix before moving on.
- New permissions go in `src/auth/types.ts` (PERMISSIONS + ROLE_PERMISSIONS).
- Update the app's README if the feature changes how the app is used.
