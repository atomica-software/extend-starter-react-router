// Browser error reporter (installed once from app/root.tsx).
//
// Captures console.error / console.warn, uncaught errors, unhandled promise rejections and
// failed same-origin fetches (including React Router data requests and form posts), batches
// them and posts them to the app's own `POST /_app/log` route, which writes them to the server
// log. Extend then shows them to the admin and the Builder reads them with `extend-logs`.
//
// You don't need to call anything: just use console.error as usual. To report a caught error
// explicitly: `reportClientError(error, "Saving failed")`.
//
// Expected noise is reported at info, which raises nothing in Contactzilla (#48):
// - a form's validation answer (an action's 400/422, which React Router marks X-Remix-Response);
// - React Router's "manifest version mismatch" warning after a deploy or a hot reload;
// - in the dev server only, errors caused by a hot reload (their stack runs through Vite's HMR
//   runtime, or they arrive within seconds of an update), tagged `origin: "hmr"`.
//
// In the Preview (the dev server), a page that loads and reports nothing for a few seconds says
// so once, as an info record with `loadMs`. Extend's runner checks that nothing else in the app
// logged an error while it loaded, and then Contactzilla clears that page's error cards (#954).

export type ClientLevel = "error" | "warn" | "info";
/** Set on records a hot reload caused (dev server only); absent for the app's own. */
export type ClientOrigin = "hmr";

export interface ClientLogRecord {
  level: ClientLevel;
  message: string;
  stack?: string;
  url?: string;
  at: string;
  origin?: ClientOrigin;
  /** Only on the page-loaded record: milliseconds from navigation start to this record. */
  loadMs?: number;
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
  private problemCount = 0;
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

  /** Errors and warnings reported so far on this page, repeats and dropped ones included. */
  get problems(): number {
    return this.problemCount;
  }

  /** True while the reporter itself is running (anything logged then must not be re-reported). */
  get reporting(): boolean {
    return this.busy;
  }

  report(input: { level: ClientLevel; message: string; stack?: string; url?: string; origin?: ClientOrigin; loadMs?: number }): void {
    if (this.busy) return; // recursion guard: errors raised while reporting are dropped
    this.busy = true;
    try {
      const message = truncate(String(input.message ?? "").trim(), MAX_MESSAGE);
      if (!message) return;
      if (input.level !== "info") this.problemCount++;
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
      if (input.origin) rec.origin = input.origin;
      if (input.loadMs !== undefined) rec.loadMs = input.loadMs;
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
// Expected, not a problem in the app: reported at info.
const QUIET = [/manifest version mismatch/i];
/** A stack through Vite's HMR runtime or React Refresh: the error came from a hot reload. */
const HMR_STACK = /hmr-runtime|@vite\/client|scheduleRefresh|performReactRefresh|@react-refresh|react-refresh/;
/** Errors this soon after a hot update count as caused by it (a half-saved file, a re-render). */
export const HMR_WINDOW_MS = 5_000;

/** The page-loaded record's message (the runner recognises it by `loadMs`). */
export const PAGE_LOADED = "Page loaded without errors";
/** How long a loaded page must stay quiet before it counts as loaded without errors. */
export const PAGE_QUIET_MS = 3_000;

/** Vite's `import.meta.hot`, as far as the reporter needs it. */
export interface HotContext {
  on(event: "vite:beforeUpdate" | "vite:afterUpdate" | "vite:error", cb: () => void): void;
}

let installed: { reporter: Reporter } | null = null;

/** Minimal window surface used by `install` (so tests can pass a fake). */
export interface ReporterWindow {
  location: { origin: string; pathname: string; search: string };
  console: Console;
  fetch: typeof fetch;
  navigator?: { sendBeacon?: (url: string, data: BodyInit) => boolean };
  addEventListener: (type: string, fn: (ev: any) => void) => void;
  document?: { readyState: string };
  performance?: { now(): number; getEntriesByType?(type: string): unknown[] };
}

/**
 * Hooks console, error events and fetch. Idempotent; a no-op on the server. Returns the reporter
 * (or null on the server). `hot` is Vite's import.meta.hot (only set by the dev server).
 */
export function installExtendLog(
  win: ReporterWindow | undefined = typeof window === "undefined" ? undefined : window,
  opts: { hot?: HotContext; now?: () => number } = { hot: import.meta.hot as HotContext | undefined },
): Reporter | null {
  if (!win) return null;
  if (installed) return installed.reporter;
  const now = opts.now ?? Date.now;
  // When the dev server last hot-updated a module (never, outside the dev server).
  let lastUpdate = -Infinity;
  if (opts.hot) {
    const mark = () => {
      lastUpdate = now();
    };
    opts.hot.on("vite:beforeUpdate", mark);
    opts.hot.on("vite:afterUpdate", mark);
  }

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
    if (QUIET.some((re) => re.test(message))) {
      reporter.report({ level: "info", message, stack, url });
      return;
    }
    const hmr = Boolean(opts.hot) && level !== "info" && ((stack !== undefined && HMR_STACK.test(stack)) || now() - lastUpdate < HMR_WINDOW_MS);
    reporter.report(hmr ? { level: "info", message, stack, url, origin: "hmr" } : { level, message, stack, url });
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
      // An action's own 400/422 (React Router's data responses say so) is a validation answer
      // the page shows, not a failure.
      const validation = (res.status === 400 || res.status === 422) && res.headers?.get?.("X-Remix-Response") === "yes";
      const level: ClientLevel = validation ? "info" : res.status === 401 || res.status === 403 ? "warn" : "error";
      report(level, `${method.toUpperCase()} ${path} → ${res.status} ${res.statusText}`.trim());
    }
    return res;
  } as typeof fetch;

  win.addEventListener("pagehide", () => reporter.flush());

  // The Preview only (the dev server): say once that this page loaded without errors (#954).
  if (opts.hot) {
    const quiet = () =>
      setTimeout(() => {
        if (reporter.problems > 0) return;
        // An error page (the root ErrorBoundary doesn't report a 404) isn't the page loading.
        const nav = win.performance?.getEntriesByType?.("navigation")?.[0] as { responseStatus?: number } | undefined;
        if (typeof nav?.responseStatus === "number" && nav.responseStatus >= 400) return;
        reporter.report({ level: "info", message: PAGE_LOADED, url: here(), loadMs: Math.round(win.performance?.now() ?? 0) });
        reporter.flush();
      }, PAGE_QUIET_MS);
    if (win.document?.readyState === "complete") quiet();
    else win.addEventListener("load", quiet);
  }
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
