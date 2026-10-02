// Structured logging for server code (loaders, actions, server modules).
//
//   import { log } from "~/lib/log.server";
//   log.info("Restored contact", { contact: contact.uuid, addressBook: book.slug, viewer: viewer.id });
//   try { … } catch (error) {
//     log.error("Saving the contact failed", { error, url: request.url, contact: contact.uuid });
//   }
//
// Each call writes one `[extend-log] {json}` line to stdout. `error` and `url` are special; any
// other fields go into the record's `context` object (ids, slugs — never secrets, tokens or
// personal details). Extend shows the records to the admin in the console's Logs tab (errors
// also in chat), and the Builder can read them with `extend-logs`. Use this instead of a bare
// console.error in catch blocks.

export type LogLevel = "error" | "warn" | "info";
export type LogSource = "server" | "client";
/**
 * Who caused the record, when it isn't the app in use (CONTRACTS §6.6): "builder" for the
 * Builder's own test requests (app/lib/extend-origin.server.ts), "hmr" for the dev server's hot
 * reloads. Absent means the app.
 */
export type LogOrigin = "builder" | "hmr";

export const LOG_PREFIX = "[extend-log] ";
export const MAX_MESSAGE = 2000;
export const MAX_STACK = 8000;
export const MAX_URL = 2000;
/** Longest `context` (as JSON) kept whole; larger ones are cut to a string under `_truncated`. */
export const MAX_CONTEXT = 4000;

export type LogContext = Record<string, unknown>;

export interface LogRecord {
  level: LogLevel;
  source: LogSource;
  message: string;
  stack?: string;
  url?: string;
  at: string;
  context?: LogContext;
  origin?: LogOrigin;
}

export interface LogFields {
  /** The caught error: its message is appended and its stack recorded. */
  error?: unknown;
  /** Request URL (a full URL is reduced to path + query). */
  url?: string;
  /** Anything else useful for debugging (ids, slugs): recorded as the `context` object. */
  [key: string]: unknown;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Reduces an absolute URL to its path and query; leaves relative URLs alone. */
export function urlPath(url: string): string {
  try {
    const u = new URL(url, "http://x");
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v: unknown) =>
      v instanceof Error ? { name: v.name, message: v.message } : typeof v === "bigint" ? String(v) : v,
    );
  } catch {
    return "[unserialisable]";
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Error);
}

/** The JSON-safe `context` for a record's extra fields, or undefined when there are none. */
export function toContext(extra: Record<string, unknown>): LogContext | undefined {
  const keys = Object.keys(extra);
  if (keys.length === 0) return undefined;
  // `log.info("…", { context: { … } })` is accepted too, without nesting it.
  const source = keys.length === 1 && isPlainObject(extra.context) ? extra.context : extra;
  const json = safeJson(source);
  if (json === "[unserialisable]") return { _truncated: json };
  if (json.length > MAX_CONTEXT) return { _truncated: truncate(json, MAX_CONTEXT) };
  const parsed = JSON.parse(json) as unknown;
  return isPlainObject(parsed) && Object.keys(parsed).length > 0 ? parsed : undefined;
}

/** Builds a normalised record from a message and fields. Pure (apart from `now`). */
export function buildRecord(
  level: LogLevel,
  message: string,
  fields: LogFields = {},
  source: LogSource = "server",
  now: Date = new Date(),
): LogRecord {
  const { error, url, ...extra } = fields;
  let msg = String(message);
  let stack: string | undefined;
  if (error instanceof Error) {
    if (error.message && !msg.includes(error.message)) msg += `: ${error.message}`;
    stack = error.stack;
  } else if (error !== undefined && error !== null) {
    msg += `: ${typeof error === "string" ? error : safeJson(error)}`;
  }
  const record: LogRecord = {
    level,
    source,
    message: truncate(msg, MAX_MESSAGE),
    at: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
  if (stack) record.stack = truncate(stack, MAX_STACK);
  if (typeof url === "string" && url) record.url = truncate(urlPath(url), MAX_URL);
  const context = toContext(extra);
  if (context) record.context = context;
  return record;
}

/** The single stdout line for a record (no trailing newline). */
export function formatLine(record: LogRecord): string {
  return LOG_PREFIX + JSON.stringify(record);
}

export function writeRecord(record: LogRecord): void {
  process.stdout.write(formatLine(record) + "\n");
}

function emit(level: LogLevel) {
  return (message: string, fields?: LogFields): void => {
    try {
      writeRecord(buildRecord(level, message, fields));
    } catch {
      // Logging must never break the request.
    }
  };
}

export const log = {
  error: emit("error"),
  warn: emit("warn"),
  info: emit("info"),
};
