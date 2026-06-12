import { DsqlSigner } from '@aws-sdk/dsql-signer';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { getConfig } from '../config.js';
import * as schema from './schema.js';

let db: NodePgDatabase<typeof schema> | null = null;

/**
 * Aurora DSQL authenticates with short-lived IAM tokens instead of a static
 * password, so the pool generates a fresh token for every new connection.
 * Locally, DATABASE_URL points at a plain Postgres instance.
 */
export function getDb(): NodePgDatabase<typeof schema> {
  if (db) return db;
  const config = getConfig();

  let pool: pg.Pool;
  if (config.databaseUrl) {
    pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5 });
  } else {
    if (!config.dsqlEndpoint) throw new Error('Neither DATABASE_URL nor DSQL_ENDPOINT is set');
    const signer = new DsqlSigner({ hostname: config.dsqlEndpoint });
    pool = new pg.Pool({
      host: config.dsqlEndpoint,
      port: 5432,
      database: 'postgres',
      user: 'admin',
      password: () => signer.getDbConnectAdminAuthToken(),
      ssl: { rejectUnauthorized: true },
      max: 5,
      // DSQL tokens are per-connection; recycle idle connections well within token life
      idleTimeoutMillis: 60_000,
    });
  }

  db = drizzle(pool, { schema });
  return db;
}
