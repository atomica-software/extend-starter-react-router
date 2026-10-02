import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applySeeds, seedFiles } from "../scripts/seeds.mjs";

/** Enough of postgres.js for applySeeds: unsafe() and begin(), with a failing statement on demand. */
function fakeSql(applied: string[] = []) {
  const ran: string[] = [];
  const unsafe = async (query: string, params?: unknown[]) => {
    if (query.includes("FAIL")) throw new Error('relation "nope" does not exist');
    if (query.startsWith("select name from _extend_seeds")) return applied.map((name) => ({ name }));
    if (query.startsWith("insert into _extend_seeds")) applied.push(String(params?.[0]));
    else if (!query.startsWith("create table if not exists _extend_seeds")) ran.push(query);
    return [];
  };
  return { ran, applied, sql: { unsafe, begin: async (fn: (tx: { unsafe: typeof unsafe }) => Promise<void>) => fn({ unsafe }) } };
}

async function seeds(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "seeds-"));
  await mkdir(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
  return dir;
}

const quiet = { log: () => {}, warn: () => {} };

describe("example data seeds (#47)", () => {
  it("lists .sql files in name order, and none for a missing folder", async () => {
    const dir = await seeds({ "0002_b.sql": "", "0001_a.sql": "", "notes.md": "" });
    expect(seedFiles(dir)).toEqual(["0001_a.sql", "0002_b.sql"]);
    expect(seedFiles(join(dir, "missing"))).toEqual([]);
  });

  it("applies each seed once per database, in order", async () => {
    const dir = await seeds({ "0001_requests.sql": "insert into requests …", "0002_more.sql": "insert into more …" });
    const db = fakeSql(["0001_requests.sql"]);
    const r = await applySeeds(db.sql, dir, quiet);
    expect(r).toEqual({ applied: ["0002_more.sql"], failed: [] });
    expect(db.ran).toEqual(["insert into more …"]);
    expect(await applySeeds(db.sql, dir, quiet)).toEqual({ applied: [], failed: [] });
  });

  it("reports a failing seed without recording it or stopping the rest", async () => {
    const dir = await seeds({ "0001_bad.sql": "insert into nope FAIL", "0002_good.sql": "insert into good …" });
    const db = fakeSql();
    const warnings: string[] = [];
    const r = await applySeeds(db.sql, dir, { log: () => {}, warn: (m) => warnings.push(m) });
    expect(r.applied).toEqual(["0002_good.sql"]);
    expect(r.failed).toEqual([{ name: "0001_bad.sql", message: 'relation "nope" does not exist' }]);
    expect(db.applied).toEqual(["0002_good.sql"]);
    expect(warnings[0]).toContain("0001_bad.sql failed and was rolled back");
  });
});
