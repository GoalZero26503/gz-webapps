# Adding Features

How to build features in an app, in the order you should reach for each tool.
Claude Code knows these patterns — describe what you want, or use
`/gz:webapp:scaffold`. This page is the human-readable version.

## The ladder

1. **Server-rendered page** — a new screen is an Eta view plus a route.
   Plain HTML solves more than you'd think.
2. **HTMX fragment** — "click this, update that" without writing JavaScript:
   the element points at an endpoint (`hx-post="/things/add"`), the endpoint
   returns rendered HTML, HTMX swaps it in. Live tiles are
   `hx-trigger="every 10s"`. This covers the bulk of interactivity.
3. **Lit component** — only when a widget holds real client-side state: chart
   hover/zoom, drag-and-drop, a multi-step inline editor, WebSerial. Lives in
   `client/components/`, talks JSON to `/api/*`.

If you're unsure, start lower on the ladder; moving up later is cheap.

## Example: a "notes" feature

1. **Table** — `src/db/schema.ts`:
   ```ts
   export const notes = pgTable('notes', {
     id: text('id').primaryKey(),            // DSQL: no serial — use crypto.randomUUID()
     authorEmail: text('author_email').notNull(),
     body: text('body').notNull(),
     createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
   });
   ```
   Then `pnpm db:generate` and commit the migration.

2. **Page** — `views/notes.eta` + route in `src/routes/pages.ts` rendering the
   list and an add form.

3. **Fragment endpoint** — `src/routes/notes.ts`: `POST /notes/add` inserts
   via Drizzle and returns the `partials/notes-list.eta` partial; the form
   targets it with `hx-post`/`hx-target`.

4. **Permission (optional)** — add `notes:write` to `src/auth/types.ts`, guard
   the route with `requirePermission('notes:write')`, hide the form in the
   view when the user lacks it.

Run `pnpm typecheck` and `pnpm dev` as you go; test against local Postgres.

## What not to do

- Don't add client-side fetch/render code for something a fragment swap does.
- Don't add a JSON endpoint *and* a fragment endpoint for the same action —
  fragments are the default; JSON is for Lit components and scripts.
- Don't reach for new npm dependencies casually; the small footprint is a
  feature. Anything beyond small utilities deserves a PR conversation.
- Don't touch other apps or `packages/` in the same PR as your feature.
