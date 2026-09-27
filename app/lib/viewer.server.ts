/**
 * Who is looking at the app.
 *
 * Extend's edge proxy authenticates every request and then sets these headers
 * (any copies sent by the browser are stripped first, so they can be trusted):
 *
 *   X-CZ-User-Id     Contactzilla user id
 *   X-CZ-User-Name   display name
 *   X-CZ-User-Email  email address
 *   X-CZ-Team        team slug (use it in Contactzilla API paths)
 *   X-CZ-Role        admin | member | restricted
 *
 * Never build a separate login: this is the viewer.
 */

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

/** Reads the viewer from the X-CZ-* headers. Returns null when there is no user id (e.g. local dev). */
export function getViewer(request: Request | { headers: Headers }): Viewer | null {
  const { headers } = request;
  const id = header(headers, "X-CZ-User-Id");
  if (!id) return null;
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
