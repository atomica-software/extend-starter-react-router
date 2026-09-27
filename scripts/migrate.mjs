// Applies Drizzle migrations from ./app/db/migrations to DATABASE_URL.
// Used by `npm run db:migrate` (the manifest's "migrate" command).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsFolder = join(root, "app", "db", "migrations");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("db:migrate: DATABASE_URL is not set; cannot run migrations.");
  process.exit(1);
}

// Drizzle's migrator needs meta/_journal.json. A fresh template has no
// migrations yet (no journal, or an empty one), which is not an error.
const journalPath = join(migrationsFolder, "meta", "_journal.json");
let entries = [];
if (existsSync(journalPath)) {
  try {
    entries = JSON.parse(readFileSync(journalPath, "utf8")).entries ?? [];
  } catch (error) {
    console.error(`db:migrate: could not read ${journalPath}:`, error);
    process.exit(1);
  }
}
if (entries.length === 0) {
  console.log("db:migrate: no migrations in app/db/migrations; nothing to do.");
  process.exit(0);
}

const { default: postgres } = await import("postgres");
const { drizzle } = await import("drizzle-orm/postgres-js");
const { migrate } = await import("drizzle-orm/postgres-js/migrator");

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(sql), { migrationsFolder });
  console.log("db:migrate: migrations applied.");
} catch (error) {
  console.error("db:migrate: failed:", error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
