import { afterEach, describe, expect, it, vi } from "vitest";

import { buildRecord, formatLine, log, MAX_CONTEXT, MAX_MESSAGE, MAX_STACK } from "../app/lib/log.server";

const NOW = new Date("2026-09-24T10:00:00.456Z");

describe("log.server", () => {
  afterEach(() => vi.restoreAllMocks());

  it("formats one [extend-log] JSON line", () => {
    const err = new Error("db down");
    const rec = buildRecord("error", "Saving failed", { error: err, url: "http://app.test/contacts?x=1" }, "server", NOW);
    expect(rec).toMatchObject({ level: "error", source: "server", message: "Saving failed: db down", url: "/contacts?x=1", at: "2026-09-24T10:00:00Z" });
    expect(rec.stack).toContain("db down");
    const line = formatLine(rec);
    expect(line.startsWith("[extend-log] {")).toBe(true);
    expect(line).not.toContain("\n");
    expect(JSON.parse(line.slice("[extend-log] ".length))).toEqual(rec);
  });

  it("records extra fields as a structured context object", () => {
    const rec = buildRecord("info", "Restored contact", { contact: "01J9", addressBook: "clients", viewer: 12, url: "/x" }, "server", NOW);
    expect(rec.message).toBe("Restored contact");
    expect(rec.context).toEqual({ contact: "01J9", addressBook: "clients", viewer: 12 });
    expect(rec.url).toBe("/x");
    // An explicit `context` object is used as is, not nested.
    expect(buildRecord("info", "m", { context: { a: 1 } }, "server", NOW).context).toEqual({ a: 1 });
    // No extras, no context; errors, bigints and undefined serialise safely.
    expect(buildRecord("info", "m", {}, "server", NOW).context).toBeUndefined();
    expect(buildRecord("warn", "m", { n: 10n, cause: new Error("x"), gone: undefined }, "server", NOW).context).toEqual({
      n: "10",
      cause: { name: "Error", message: "x" },
    });
    const big = buildRecord("info", "m", { blob: "b".repeat(10_000) }, "server", NOW).context!;
    expect(String(big._truncated)).toHaveLength(MAX_CONTEXT);
    const line = JSON.parse(formatLine(rec).slice("[extend-log] ".length));
    expect(line.context).toEqual({ contact: "01J9", addressBook: "clients", viewer: 12 });
  });

  it("appends non-Error errors, and truncates", () => {
    expect(buildRecord("warn", "Slow", { contactId: 7 }, "server", NOW).message).toBe("Slow");
    expect(buildRecord("error", "Failed", { error: "nope" }, "server", NOW).message).toBe("Failed: nope");
    const e = new Error("x");
    e.stack = "s".repeat(20_000);
    const rec = buildRecord("error", "m".repeat(5000), { error: e }, "server", NOW);
    expect(rec.message).toHaveLength(MAX_MESSAGE);
    expect(rec.stack).toHaveLength(MAX_STACK);
    expect(rec.message.endsWith("…")).toBe(true);
  });

  it("writes to stdout and never throws", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    log.info("hello");
    expect(write).toHaveBeenCalledTimes(1);
    const out = String(write.mock.calls[0]![0]);
    expect(out).toMatch(/^\[extend-log\] \{.*\}\n$/);
    expect(JSON.parse(out.slice(13))).toMatchObject({ level: "info", source: "server", message: "hello" });
    write.mockImplementation(() => {
      throw new Error("EPIPE");
    });
    expect(() => log.error("still fine")).not.toThrow();
  });
});
