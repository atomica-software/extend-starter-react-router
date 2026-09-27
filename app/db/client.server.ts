import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

// Cached on globalThis so dev-server hot reloads don't open a new pool each time.
const globalForDb = globalThis as unknown as { __extendDb?: { db: Database; sql: postgres.Sql } };

/** Lazily creates the Drizzle client from DATABASE_URL. Server-only. */
export function getDb(): Database {
  if (!globalForDb.__extendDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const sql = postgres(url, { max: 10 });
    globalForDb.__extendDb = { db: drizzle(sql, { schema }), sql };
  }
  return globalForDb.__extendDb.db;
}
