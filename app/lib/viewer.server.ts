/**
 * Who is looking at the app.
 *
 * Extend's edge authenticates every request and then sets these headers
 * (any copies sent by the browser are stripped first):
 *
 *   X-CZ-User-Id     Contactzilla user id
 *   X-CZ-User-Name   display name
 *   X-CZ-User-Email  email address
 *   X-CZ-Team        team slug (use it in Contactzilla API paths)
 *   X-CZ-Role        admin | member | restricted
 *
 * plus a signature over them (X-CZ-Identity-Timestamp, X-CZ-Identity-Signature),
 * made with this environment's EXTEND_IDENTITY_KEY. Only a signed, recent identity
 * is trusted: anything else that can reach the app (another container, other code
 * in the stack) could send these headers too.
 *
 * Never build a separate login: this is the viewer.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const VIEWER_ROLES = ["admin", "member", "restricted"] as const;
export type ViewerRole = (typeof VIEWER_ROLES)[number];

export interface Viewer {
  id: string;
  name: string;
  email: string;
  /** Team slug, e.g. "acme". */
  team: string;
  role: ViewerRole;
}

/** The headers the signature covers, in order. */
const IDENTITY_HEADERS = ["X-CZ-User-Id", "X-CZ-User-Name", "X-CZ-User-Email", "X-CZ-Team", "X-CZ-Role"] as const;

/** How old (or how far ahead) a signature may be. The edge signs each request as it arrives. */
export const IDENTITY_MAX_AGE_SECONDS = 300;

/**
 * Whether the identity headers carry a valid, recent signature under `key`:
 * `v1=` + hex HMAC-SHA256 of "extend-identity-v1", the timestamp and each header's
 * value (trimmed, as sent), one per line. Compared in constant time.
 */
export function hasValidIdentitySignature(headers: Headers, key: string, nowMs = Date.now()): boolean {
  const ts = headers.get("X-CZ-Identity-Timestamp")?.trim() ?? "";
  const sig = headers.get("X-CZ-Identity-Signature")?.trim() ?? "";
  if (!key || !/^\d{1,12}$/.test(ts) || !/^v1=[0-9a-f]{64}$/.test(sig)) return false;
  if (Math.abs(Math.floor(nowMs / 1000) - Number(ts)) > IDENTITY_MAX_AGE_SECONDS) return false;
  const payload = ["extend-identity-v1", ts, ...IDENTITY_HEADERS.map((h) => headers.get(h)?.trim() ?? "")].join("\n");
  const expected = createHmac("sha256", key).update(payload).digest();
  const given = Buffer.from(sig.slice(3), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Whether this request's identity headers can be believed. On Extend,
 * EXTEND_IDENTITY_KEY is always set and the signature must check out. Running
 * the app elsewhere, behind a proxy of your own that sets (and strips) these
 * headers, set EXTEND_TRUST_IDENTITY_HEADERS=1 instead.
 */
function trusted(headers: Headers, nowMs: number): boolean {
  const key = process.env.EXTEND_IDENTITY_KEY;
  if (key) return hasValidIdentitySignature(headers, key, nowMs);
  return process.env.EXTEND_TRUST_IDENTITY_HEADERS === "1";
}

/**
 * Header values are percent-encoded by the stack when they contain anything
 * outside plain ASCII (e.g. "Zoë"), since HTTP headers can't carry it. Plain
 * values decode to themselves.
 */
function header(headers: Headers, name: string): string {
  const raw = headers.get(name)?.trim() ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function parseRole(value: string): ViewerRole {
  const role = value.toLowerCase();
  // Unknown or missing roles get the least privilege.
  return (VIEWER_ROLES as readonly string[]).includes(role)
    ? (role as ViewerRole)
    : "restricted";
}

/**
 * Reads the viewer from the X-CZ-* headers. Returns null when there is no user id,
 * or when the headers aren't signed by the edge (e.g. a request that didn't come
 * through it).
 */
export function getViewer(request: Request | { headers: Headers }, nowMs = Date.now()): Viewer | null {
  const { headers } = request;
  const id = header(headers, "X-CZ-User-Id");
  if (!id || !trusted(headers, nowMs)) return null;
  return {
    id,
    name: header(headers, "X-CZ-User-Name"),
    email: header(headers, "X-CZ-User-Email"),
    team: header(headers, "X-CZ-Team"),
    role: parseRole(header(headers, "X-CZ-Role")),
  };
}

/** Like getViewer, but throws a 401 Response (handled by React Router) when there is no viewer. */
export function requireViewer(request: Request | { headers: Headers }): Viewer {
  const viewer = getViewer(request);
  if (!viewer) {
    throw new Response("Unauthorized: no Contactzilla viewer on this request", {
      status: 401,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return viewer;
}

export function isAdmin(viewer: Viewer | null): boolean {
  return viewer?.role === "admin";
}
