import { defineConfig } from 'drizzle-kit';

// For local dev, set DATABASE_URL to a local Postgres instance.
// For DSQL, db:push runs from CI (or a gatekeeper shell) with IAM credentials;
// generate a token with: aws dsql generate-db-connect-admin-auth-token --hostname $DSQL_ENDPOINT
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? `postgres://admin:${encodeURIComponent(process.env.DSQL_TOKEN ?? '')}@${process.env.DSQL_ENDPOINT ?? 'localhost'}:5432/postgres?sslmode=require`,
  },
});
