# Code Conventions

## TypeScript / ESM

- Node 22, TS strict, `"type": "module"`, `module: NodeNext` — **relative
  imports require the `.js` extension** (`./config.js`, not `./config`).
- Server code compiled by `tsc` to `dist/`; client code bundled by esbuild;
  `tsx` runs TS directly in dev and for CDK.
- One workspace per app; shared root `tsconfig.base.json`. No cross-app
  imports — shared code is extracted to `packages/` (with gatekeeper review),
  never imported across `apps/`.

## Fastify

- Routes are plugin functions (`async (app) => {...}`) registered in
  `src/app.ts`; auth guards as route-level `preHandler`, never inline checks.
- Type bodies/params/querystring via route generics
  (`app.post<{ Body: {...} }>`).
- Config access via `getConfig()` — never `process.env` outside `config.ts`.
- HTTP errors via `reply.code(...).send(...)`; don't throw for expected
  failures.

## Eta views

- `views/<page>.eta` for pages (start with `<% layout('layout') %>`),
  `views/partials/` for HTMX fragments.
- Data via `it.*`. Escaped output `<%= %>` by default; raw `<%~ %>` only for
  `include()` and the layout body slot.
- Keep logic in routes; templates render, they don't compute.

## Drizzle / Aurora DSQL

- Schema in `src/db/schema.ts`; access via `getDb()` only.
- After schema changes: `pnpm db:generate`, commit `drizzle/`.
- DSQL constraints: no foreign keys, no serial/sequences, no extensions —
  text/uuid primary keys, relations enforced in code.
- snake_case column names mapped to camelCase TS properties.

## CSS / theming

- Plain CSS in `public/styles.css` built on the `--gz-*` design tokens (dark
  theme). No Tailwind in the default stack; reuse existing component classes
  (`.btn`, `.card`, `.badge`, `.data-table`, `.callout`) before adding new ones.
- Lit components consume the same tokens with fallbacks:
  `var(--gz-green, #bfd22b)`.

## Naming

- App slug: kebab-case; AWS resources `gzweb-{stage}-{app}-*`; stacks
  `GzWeb-{AppPascal}-{stage}`; SSM `/gzweb/{app}/{stage}/*`.
- Lit components: `gz-` tag prefix (`gz-sparkline`).
- Branches: `<gh-username>/<short-description>`.

## Placeholders (template only)

`{{APP_NAME}}`, `{{APP_NAME_PASCAL}}`, `{{APP_DISPLAY_NAME}}`,
`{{SEED_ADMIN_EMAIL}}` are substituted by `pnpm scaffold`. They live only in
`apps/_template*/`; finding one in a scaffolded app means scaffolding didn't
finish.
