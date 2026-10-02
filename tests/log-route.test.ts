import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_RECORDS, parseBatch, toClientRecord } from "../app/lib/client-log.server";
import { action } from "../app/routes/_app.log";

const NOW = new Date("2026-09-24T10:00:00Z");

function post(body: string) {
  return new Request("http://app.test/_app/log", { method: "POST", body, headers: { "content-type": "application/json" } });
}

describe("_app/log route", () => {
  afterEach(() => vi.restoreAllMocks());

  it("validates records and forces source=client", () => {
    expect(toClientRecord({ level: "error", message: "m", url: "https://app.test/x?y=1", at: "2026-09-24T09:59:00Z", source: "server" }, NOW)).toEqual({
      level: "error",
      source: "client",
      message: "m",
      url: "/x?y=1",
      at: "2026-09-24T09:59:00Z",
    });
    expect(toClientRecord({ level: "fatal", message: "m" }, NOW)).toBeNull();
    expect(toClientRecord({ level: "error", message: "" }, NOW)).toBeNull();
    expect(toClientRecord("x", NOW)).toBeNull();
    // implausible client clock → server time; oversized fields capped
    const r = toClientRecord({ level: "warn", message: "x".repeat(9000), stack: "s".repeat(20000), at: "1999-01-01T00:00:00Z" }, NOW)!;
    expect(r.at).toBe("2026-09-24T10:00:00Z");
    expect(r.message).toHaveLength(2000);
    expect(r.stack).toHaveLength(8000);
  });

  it("passes a page-loaded record's load time on for the runner, and only at info (#954)", () => {
    const loaded = { level: "info", message: "Page loaded without errors", url: "/incidents", loadMs: 1234.6 };
    expect(toClientRecord(loaded, NOW)!.context).toEqual({ extend_page_load_ms: 1235 });
    expect(toClientRecord({ ...loaded, loadMs: -5 }, NOW)!.context).toEqual({ extend_page_load_ms: 0 });
    expect(toClientRecord({ ...loaded, level: "error" }, NOW)).not.toHaveProperty("context");
    expect(toClientRecord({ ...loaded, loadMs: "1" }, NOW)).not.toHaveProperty("context");
    // A page can't send any other context, such as the markers Extend itself sets.
    expect(toClientRecord({ ...loaded, loadMs: undefined, context: { extend_clean: "verify" } }, NOW)).not.toHaveProperty("context");
  });

  it("rejects non-arrays, bad JSON and oversized batches", () => {
    expect(parseBatch("{}", NOW)).toBe("expected a JSON array");
    expect(parseBatch("nope", NOW)).toBe("invalid JSON");
    expect(parseBatch(JSON.stringify(Array(MAX_RECORDS + 1).fill({ level: "error", message: "m" })), NOW)).toMatch(/at most 20/);
    expect(parseBatch(JSON.stringify([{ level: "error", message: "m" }, { bogus: 1 }]), NOW)).toHaveLength(1);
  });

  it("writes one [extend-log] line per record and answers 204 without identity headers", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const res = await action({ request: post(JSON.stringify([{ level: "error", message: "a", url: "/p" }, { level: "warn", message: "b" }])) } as never);
    expect(res.status).toBe(204);
    const lines = write.mock.calls.map((c) => String(c[0]));
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.startsWith("[extend-log] ") && l.endsWith("\n"))).toBe(true);
    expect(JSON.parse(lines[0]!.slice(13))).toMatchObject({ level: "error", source: "client", message: "a", url: "/p" });
    const bad = await action({ request: post("{}") } as never);
    expect(bad.status).toBe(400);
  });
});
