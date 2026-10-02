// Example data (app/db/seeds/*.sql): each file runs once per database, after the
// migrations, so once in Preview and once in Live (Publish runs `npm run db:migrate`).
// Applied files are recorded in _extend_seeds by name; editing one later doesn't re-run
// it, so add a new file instead. A seed that fails is rolled back and reported, and is
// tried again next time: example data never blocks a publish.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The seed files in `folder`, in name order (0001_….sql, 0002_….sql…). */
export function seedFiles(folder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * Applies the seeds `sql` (a postgres.js client) hasn't had yet. Returns the names
 * applied and those that failed (with the error message).
 */
export async function applySeeds(sql, folder, { log = console.log, warn = console.error } = {}) {
  const files = seedFiles(folder);
  const result = { applied: [], failed: [] };
  if (!files.length) return result;
  await sql.unsafe(
    "create table if not exists _extend_seeds (name text primary key, applied_at timestamptz not null default now())",
  );
  const done = new Set((await sql.unsafe("select name from _extend_seeds")).map((r) => r.name));
  for (const name of files) {
    if (done.has(name)) continue;
    const text = readFileSync(join(folder, name), "utf8");
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx.unsafe("insert into _extend_seeds (name) values ($1)", [name]);
      });
      result.applied.push(name);
      log(`db:migrate: example data ${name} applied.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.failed.push({ name, message });
      warn(`db:migrate: example data ${name} failed and was rolled back (it will be tried again next time): ${message}`);
    }
  }
  return result;
}
