// Validation for browser log batches posted to /_app/log (see app/routes/_app.log.ts).
import { MAX_MESSAGE, MAX_STACK, MAX_URL, urlPath, type LogRecord } from "./log.server";

export const MAX_RECORDS = 20;
export const MAX_BODY_BYTES = 256 * 1024;
const LEVELS = new Set(["error", "warn", "info"]);

function cap(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Validates one client record; returns null when it is unusable. Pure (apart from `now`). */
export function toClientRecord(raw: unknown, now: Date = new Date()): LogRecord | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.level !== "string" || !LEVELS.has(r.level)) return null;
  if (typeof r.message !== "string" || !r.message.trim()) return null;
  const atMs = typeof r.at === "string" ? Date.parse(r.at) : NaN;
  // Use the client's timestamp only when it is plausible (clock skew up to a day).
  const at = Number.isFinite(atMs) && Math.abs(atMs - now.getTime()) < 86_400_000 ? new Date(atMs) : now;
  const rec: LogRecord = {
    level: r.level as LogRecord["level"],
    source: "client",
    message: cap(r.message, MAX_MESSAGE),
    at: at.toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
  if (typeof r.stack === "string" && r.stack) rec.stack = cap(r.stack, MAX_STACK);
  if (typeof r.url === "string" && r.url) rec.url = cap(urlPath(r.url), MAX_URL);
  // A hot reload's errors (the reporter tags them in the dev server only). The page can't
  // claim "builder": only a signed request header can (app/routes/_app.log.ts).
  if (r.origin === "hmr" && process.env.NODE_ENV !== "production") rec.origin = "hmr";
  // "This page loaded without errors" (the dev server's reporter only): Extend's runner checks
  // the rest of the log over that time, and Contactzilla clears the page's error cards (#954).
  if (rec.level === "info" && typeof r.loadMs === "number" && Number.isFinite(r.loadMs)) {
    rec.context = { extend_page_load_ms: Math.max(0, Math.round(r.loadMs)) };
  }
  return rec;
}

/** Parses a request body into records, or an error string. Pure. */
export function parseBatch(body: string, now: Date = new Date()): LogRecord[] | string {
  if (body.length > MAX_BODY_BYTES) return "body too large";
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return "invalid JSON";
  }
  if (!Array.isArray(data)) return "expected a JSON array";
  if (data.length > MAX_RECORDS) return `at most ${MAX_RECORDS} records per request`;
  return data.map((d) => toClientRecord(d, now)).filter((r): r is LogRecord => r !== null);
}
