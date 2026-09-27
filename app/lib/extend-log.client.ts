// Browser error reporter (installed once from app/root.tsx).
//
// Captures console.error / console.warn, uncaught errors, unhandled promise rejections and
// failed same-origin fetches (including React Router data requests and form posts), batches
// them and posts them to the app's own `POST /_app/log` route, which writes them to the server
// log. Extend then shows them to the admin and the Builder reads them with `extend-logs`.
//
// You don't need to call anything: just use console.error as usual. To report a caught error
// explicitly: `reportClientError(error, "Saving failed")`.

export type ClientLevel = "error" | "warn" | "info";

export interface ClientLogRecord {
  level: ClientLevel;
  message: string;
  stack?: string;
  url?: string;
  at: string;
}

export const LOG_ENDPOINT = "/_app/log";
export const MAX_MESSAGE = 2000;
export const MAX_STACK = 8000;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function isoNow(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message || value.name;
  if (value === undefined) return "undefined";
  try {
    const s = JSON.stringify(value);
    return s === undefined ? String(value) : s;
  } catch {
    return String(value);
  }
}

/**
 * Turns console arguments into a message (+ the first Error's stack). Handles printf-style
 * `%s %d %i %f %o %O %j` substitutions and drops `%c` styling. Pure.
 */
export function formatConsoleArgs(args: readonly unknown[]): { message: string; stack?: string } {
  const rest = [...args];
  let head = "";
  if (typeof rest[0] === "string") {
    const fmt = rest.shift() as string;
    head = fmt.replace(/%([sdifoOjc%])/g, (m, k: string) => {
      if (k === "%") return "%";
      if (rest.length === 0) return m;
      const v = rest.shift();
      return k === "c" ? "" : stringify(v);
    });
  }
  const parts = head ? [head, ...rest.map(stringify)] : rest.map(stringify);
  const err = args.find((a): a is Error => a instanceof Error);
  return { message: parts.join(" ").trim(), stack: err?.stack };
}

export interface ReporterOptions {
  send: (records: ClientLogRecord[]) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  flushMs?: number;
  maxBatch?: number;
  dedupeMs?: number;
  /** Hard cap per page load, so a render loop can't flood the log. */
  maxTotal?: number;
}

/** Batching, dedupe and the recursion guard. No DOM access, so it is unit-testable. */
export class Reporter {
  private queue: ClientLogRecord[] = [];
  private timer: unknown = undefined;
  private readonly recent = new Map<string, number>();
  private busy = false;
  private total = 0;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly flushMs: number;
  private readonly maxBatch: number;
  private readonly dedupeMs: number;
  private readonly maxTotal: number;

  constructor(private readonly opts: ReporterOptions) {
    this.now = opts.now ?? Date.now;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.flushMs = opts.flushMs ?? 2000;
    this.maxBatch = opts.maxBatch ?? 20;
    this.dedupeMs = opts.dedupeMs ?? 10_000;
    this.maxTotal = opts.maxTotal ?? 200;
  }

  /** True while the reporter itself is running (anything logged then must not be re-reported). */
  get reporting(): boolean {
    return this.busy;
  }

  report(input: { level: ClientLevel; message: string; stack?: string; url?: string }): void {
    if (this.busy) return; // recursion guard: errors raised while reporting are dropped
    this.busy = true;
    try {
      const message = truncate(String(input.message ?? "").trim(), MAX_MESSAGE);
      if (!message) return;
      const now = this.now();
      const key = `${input.level}\n${message}`;
      const seen = this.recent.get(key);
      if (seen !== undefined && now - seen < this.dedupeMs) return;
      this.recent.set(key, now);
      if (this.recent.size > 200) {
        for (const [k, t] of this.recent) if (now - t >= this.dedupeMs) this.recent.delete(k);
      }
      if (this.total >= this.maxTotal) return;
      this.total++;
      const rec: ClientLogRecord = { level: input.level, message, at: isoNow(now) };
      if (input.stack) rec.stack = truncate(input.stack, MAX_STACK);
      if (input.url) rec.url = truncate(input.url, 2000);
      this.queue.push(rec);
      if (this.queue.length >= this.maxBatch) this.flushLocked();
      else if (this.timer === undefined) {
        this.timer = this.setTimer(() => {
          this.timer = undefined;
          this.flush();
        }, this.flushMs);
      }
    } catch {
      /* never throw from the reporter */
    } finally {
      this.busy = false;
    }
  }

  flush(): void {
    if (this.busy) return;
    this.busy = true;
    try {
      this.flushLocked();
    } finally {
      this.busy = false;
    }
  }

  private flushLocked(): void {
    if (this.timer !== undefined) {
      this.clearTimer(this.timer);
      this.timer = undefined;
    }
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.maxBatch);
      try {
        this.opts.send(batch);
      } catch {
        /* reporting failures are swallowed */
      }
    }
  }
}

/** Same-origin check for fetch URLs. Pure. */
export function sameOriginPath(input: string, origin: string): string | null {
  try {
    const u = new URL(input, origin);
    return u.origin === origin ? u.pathname + u.search : null;
  } catch {
    return null;
  }
}

function requestInfo(input: unknown, init?: { method?: string }): { url: string; method: string } {
  if (typeof input === "string") return { url: input, method: init?.method ?? "GET" };
  if (input instanceof URL) return { url: input.href, method: init?.method ?? "GET" };
  const r = input as { url?: string; method?: string } | null;
  return { url: r?.url ?? String(input), method: init?.method ?? r?.method ?? "GET" };
}

// Dev-server chatter that isn't an app problem.
const IGNORED = [/^\[vite\]/, /^\[HMR\]/, /Download the React DevTools/];

let installed: { reporter: Reporter } | null = null;

/** Minimal window surface used by `install` (so tests can pass a fake). */
export interface ReporterWindow {
  location: { origin: string; pathname: string; search: string };
  console: Console;
  fetch: typeof fetch;
  navigator?: { sendBeacon?: (url: string, data: BodyInit) => boolean };
  addEventListener: (type: string, fn: (ev: any) => void) => void;
}

/**
 * Hooks console, error events and fetch. Idempotent; a no-op on the server. Returns the reporter
 * (or null on the server).
 */
export function installExtendLog(win: ReporterWindow | undefined = typeof window === "undefined" ? undefined : window): Reporter | null {
  if (!win) return null;
  if (installed) return installed.reporter;

  const origFetch = win.fetch.bind(win);
  const here = () => win.location.pathname + win.location.search;

  const send = (records: ClientLogRecord[]) => {
    const body = JSON.stringify(records);
    let sent = false;
    try {
      if (win.navigator?.sendBeacon) {
        sent = win.navigator.sendBeacon(LOG_ENDPOINT, new Blob([body], { type: "application/json" }));
      }
    } catch {
      sent = false;
    }
    if (!sent) {
      void origFetch(LOG_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
        credentials: "same-origin",
      }).catch(() => {});
    }
  };

  const reporter = new Reporter({ send });
  installed = { reporter };

  const report = (level: ClientLevel, message: string, stack?: string, url: string = here()) => {
    if (IGNORED.some((re) => re.test(message))) return;
    reporter.report({ level, message, stack, url });
  };

  for (const level of ["error", "warn"] as const) {
    const original = win.console[level];
    win.console[level] = function (this: Console, ...args: unknown[]) {
      original.apply(this, args);
      if (reporter.reporting) return;
      try {
        const { message, stack } = formatConsoleArgs(args);
        report(level, message, stack);
      } catch {
        /* ignore */
      }
    } as Console["error"];
  }

  win.addEventListener("error", (ev: ErrorEvent) => {
    const err = ev?.error;
    const message = err instanceof Error ? `Uncaught ${err.name}: ${err.message}` : `Uncaught error: ${ev?.message ?? "unknown"}`;
    const where = ev?.filename ? ` (${ev.filename}:${ev.lineno ?? 0}:${ev.colno ?? 0})` : "";
    report("error", message + (err instanceof Error ? "" : where), err instanceof Error ? err.stack : undefined);
  });

  win.addEventListener("unhandledrejection", (ev: PromiseRejectionEvent) => {
    const reason: unknown = ev?.reason;
    const message = reason instanceof Error ? `Unhandled rejection: ${reason.name}: ${reason.message}` : `Unhandled rejection: ${stringify(reason)}`;
    report("error", message, reason instanceof Error ? reason.stack : undefined);
  });

  win.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const { url, method } = requestInfo(input, init);
    const path = sameOriginPath(url, win.location.origin);
    if (path === null || path.startsWith(LOG_ENDPOINT)) return origFetch(input, init);
    let res: Response;
    try {
      res = await origFetch(input, init);
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      if (!aborted) report("error", `${method.toUpperCase()} ${path} failed: ${stringify(err)}`);
      throw err;
    }
    if (res.status >= 400) {
      const level: ClientLevel = res.status === 401 || res.status === 403 ? "warn" : "error";
      report(level, `${method.toUpperCase()} ${path} → ${res.status} ${res.statusText}`.trim());
    }
    return res;
  } as typeof fetch;

  win.addEventListener("pagehide", () => reporter.flush());
  return reporter;
}

/** Reports a caught error explicitly (e.g. from an ErrorBoundary). Safe to call on the server. */
export function reportClientError(error: unknown, context?: string): void {
  const reporter = installExtendLog();
  if (!reporter) return;
  const base = error instanceof Error ? `${error.name}: ${error.message}` : stringify(error);
  const url = typeof window === "undefined" ? undefined : window.location.pathname + window.location.search;
  reporter.report({
    level: "error",
    message: context ? `${context}: ${base}` : base,
    stack: error instanceof Error ? error.stack : undefined,
    url,
  });
}

/** Test hook: forget the installed instance. */
export function _resetForTests(): void {
  installed = null;
}
