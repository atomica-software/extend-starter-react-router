import { afterEach, describe, expect, it, vi } from "vitest";

import {
  _resetForTests,
  formatConsoleArgs,
  installExtendLog,
  Reporter,
  sameOriginPath,
  type ClientLogRecord,
  type ReporterWindow,
} from "../app/lib/extend-log.client";

function fakeTimers() {
  let t = Date.parse("2026-09-24T10:00:00Z");
  const timers: { at: number; fn: () => void }[] = [];
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => {
      const h = { at: t + ms, fn };
      timers.push(h);
      return h;
    },
    clearTimer: (h: unknown) => {
      const i = timers.indexOf(h as never);
      if (i >= 0) timers.splice(i, 1);
    },
    advance(ms: number) {
      t += ms;
      for (const h of [...timers]) {
        if (h.at <= t) {
          timers.splice(timers.indexOf(h), 1);
          h.fn();
        }
      }
    },
  };
}

describe("formatConsoleArgs", () => {
  it("substitutes printf args, drops %c, keeps the first Error's stack", () => {
    const e = new Error("bad");
    expect(formatConsoleArgs(["Hello %s, %d items %c!", "Ada", 3, "color:red"]).message).toBe("Hello Ada, 3 items !");
    const r = formatConsoleArgs(["Failed:", e, { id: 1 }]);
    expect(r.message).toBe('Failed: bad {"id":1}');
    expect(r.stack).toBe(e.stack);
    expect(formatConsoleArgs([e]).message).toBe("bad");
  });
});

describe("sameOriginPath", () => {
  it("resolves relative URLs and rejects other origins", () => {
    expect(sameOriginPath("/contacts.data?x=1", "https://app.h.test")).toBe("/contacts.data?x=1");
    expect(sameOriginPath("https://app.h.test/a", "https://app.h.test")).toBe("/a");
    expect(sameOriginPath("https://cdn.test/a", "https://app.h.test")).toBeNull();
  });
});

describe("Reporter", () => {
  it("flushes after 2s, or at once at 20 records", () => {
    const clock = fakeTimers();
    const batches: ClientLogRecord[][] = [];
    const r = new Reporter({ send: (b) => batches.push(b), ...clock });
    r.report({ level: "error", message: "one", url: "/" });
    expect(batches).toHaveLength(0);
    clock.advance(1999);
    expect(batches).toHaveLength(0);
    clock.advance(1);
    expect(batches).toEqual([[{ level: "error", message: "one", url: "/", at: "2026-09-24T10:00:00Z" }]]);
    for (let i = 0; i < 20; i++) r.report({ level: "warn", message: `m${i}` });
    expect(batches).toHaveLength(2);
    expect(batches[1]).toHaveLength(20);
    clock.advance(5000);
    expect(batches).toHaveLength(2); // timer was cleared by the size flush
  });

  it("dedupes identical level+message within 10s", () => {
    const clock = fakeTimers();
    const batches: ClientLogRecord[][] = [];
    const r = new Reporter({ send: (b) => batches.push(b), ...clock });
    r.report({ level: "error", message: "same" });
    r.report({ level: "error", message: "same" });
    r.report({ level: "warn", message: "same" });
    clock.advance(2000);
    expect(batches.flat().map((x) => x.level)).toEqual(["error", "warn"]);
    clock.advance(8000);
    r.report({ level: "error", message: "same" });
    clock.advance(2000);
    expect(batches.flat()).toHaveLength(3);
  });

  it("does not re-report errors raised while sending, and survives send failures", () => {
    const clock = fakeTimers();
    let calls = 0;
    const r: Reporter = new Reporter({
      ...clock,
      send: () => {
        calls++;
        r.report({ level: "error", message: "error while sending" });
        throw new Error("network down");
      },
    });
    r.report({ level: "error", message: "first" });
    expect(() => r.flush()).not.toThrow();
    expect(calls).toBe(1);
    clock.advance(10_000);
    expect(calls).toBe(1); // nothing was queued by the nested report
  });

  it("caps records per page load and message sizes", () => {
    const clock = fakeTimers();
    const sent: ClientLogRecord[] = [];
    const r = new Reporter({ send: (b) => sent.push(...b), ...clock, maxTotal: 3 });
    for (let i = 0; i < 10; i++) r.report({ level: "error", message: `${i}`.padEnd(3000, "x"), stack: "s".repeat(9000) });
    r.flush();
    expect(sent).toHaveLength(3);
    expect(sent[0]!.message).toHaveLength(2000);
    expect(sent[0]!.stack).toHaveLength(8000);
  });
});

describe("installExtendLog", () => {
  afterEach(() => {
    _resetForTests();
    vi.useRealTimers();
  });

  it("is a no-op without a window", () => {
    expect(installExtendLog(undefined)).toBeNull();
  });

  it("captures console.error/warn, error events and failed same-origin fetches", async () => {
    vi.useFakeTimers();
    const listeners: Record<string, (ev: any) => void> = {};
    const beacons: unknown[] = [];
    const origError = vi.fn();
    const origWarn = vi.fn();
    const responses: Record<string, Response> = {
      "/ok": new Response("", { status: 200 }),
      "/contacts.data": new Response("Bad Request", { status: 400, statusText: "Bad Request" }),
      "https://other.test/x": new Response("", { status: 500 }),
    };
    const win: ReporterWindow = {
      location: { origin: "https://app.h.test", pathname: "/contacts", search: "" },
      console: { error: origError, warn: origWarn } as unknown as Console,
      fetch: (async (input: RequestInfo | URL) => {
        const key = String(input);
        if (key === "/boom") throw new TypeError("Failed to fetch");
        return responses[key]!;
      }) as typeof fetch,
      navigator: {
        sendBeacon: (url: string, data: BodyInit) => {
          beacons.push({ url, data });
          return true;
        },
      },
      addEventListener: (type, fn) => {
        listeners[type] = fn;
      },
    };
    const reporter = installExtendLog(win)!;
    expect(installExtendLog(win)).toBe(reporter); // idempotent

    win.console.error("Something %s", "broke");
    win.console.warn("[vite] connecting..."); // ignored
    expect(origError).toHaveBeenCalledWith("Something %s", "broke");
    expect(origWarn).toHaveBeenCalledTimes(1);
    listeners.error!({ error: new TypeError("x is undefined") });
    listeners.unhandledrejection!({ reason: "nope" });
    await win.fetch("/ok");
    await win.fetch("/contacts.data", { method: "post" });
    await win.fetch("https://other.test/x");
    await expect(win.fetch("/boom")).rejects.toThrow("Failed to fetch");

    vi.advanceTimersByTime(2000);
    expect(beacons).toHaveLength(1);
    const { url, data } = beacons[0] as { url: string; data: Blob };
    expect(url).toBe("/_app/log");
    const records = JSON.parse(await data.text()) as ClientLogRecord[];
    expect(records.map((r) => [r.level, r.message])).toEqual([
      ["error", "Something broke"],
      ["error", "Uncaught TypeError: x is undefined"],
      ["error", "Unhandled rejection: nope"],
      ["error", "POST /contacts.data → 400 Bad Request"],
      ["error", "GET /boom failed: Failed to fetch"],
    ]);
    expect(records.every((r) => r.url === "/contacts")).toBe(true);
  });
});
