/**
 * Cron job and webhook routes (extend.json, CONTRACTS §6.13). Extend calls
 * them over the stack's internal network and signs every call; anyone else,
 * including a signed-in user reaching the same URL, can't. Check first:
 *
 *   export async function action({ request }: Route.ActionArgs) {
 *     const call = await verifyExtendCall(request);
 *     if (!call) return new Response("Forbidden", { status: 403 });
 *     const event = JSON.parse(call.body);   // the raw body, e.g. to check Stripe's own signature too
 *     …
 *     return Response.json({ received: true });
 *   }
 *
 * Signature (v2): X-Extend-Signature-V2 = "v2=" + hex HMAC-SHA256, under
 * EXTEND_JOBS_SECRET, of "v2\n{METHOD}\n{path and query}\n{job:name | webhook:name}\n
 * {X-Extend-Timestamp}\n{X-Extend-Nonce}\n{raw body}". It covers the route and the
 * job, so a captured call can't be sent elsewhere. Calls more than 60 seconds off,
 * or with a nonce already seen, are refused. (The older v1 signature, which
 * covers only the timestamp and body, isn't accepted.)
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_SKEW_S = 60;

/**
 * Nonces accepted in the last MAX_SKEW_S seconds, with when they can be
 * forgotten: after that the timestamp check refuses the call anyway. In
 * memory, as the app is one process; a restart forgets them, which matters
 * only for a call captured and replayed within that minute.
 */
const seenNonces = new Map<string, number>();

function rememberNonce(nonce: string, nowS: number): boolean {
  for (const [n, until] of seenNonces) {
    if (until < nowS) seenNonces.delete(n);
  }
  if (seenNonces.has(nonce)) return false;
  seenNonces.set(nonce, nowS + 2 * MAX_SKEW_S);
  return true;
}

export interface ExtendCall {
  /** The raw request body (read once here; use this rather than request.text()). */
  body: string;
  /** The cron job's name, or null for a webhook. */
  job: string | null;
  /** The webhook's name, or null for a cron job. */
  webhook: string | null;
}

export interface SignedCall {
  method: string;
  /** The request URL's pathname + search, as the app parses it. */
  pathWithQuery: string;
  /** `job:{name}` or `webhook:{name}`. */
  target: string;
  timestamp: string;
  nonce: string;
  body: string;
}

/** Extend's v2 signature of a call (CONTRACTS §6.13), as control signs it. */
export function extendSignature(secret: string, c: SignedCall): string {
  const head = ["v2", c.method.toUpperCase(), c.pathWithQuery, c.target, c.timestamp, c.nonce, ""].join("\n");
  return "v2=" + createHmac("sha256", secret).update(head).update(c.body).digest("hex");
}

/** The call's details if Extend made it, else null. Reads the request body. */
export async function verifyExtendCall(request: Request, now: number = Date.now()): Promise<ExtendCall | null> {
  const secret = process.env.EXTEND_JOBS_SECRET;
  const timestamp = request.headers.get("x-extend-timestamp");
  const nonce = request.headers.get("x-extend-nonce");
  const signature = request.headers.get("x-extend-signature-v2");
  const job = request.headers.get("x-extend-job");
  const webhook = request.headers.get("x-extend-webhook");
  if (!secret || !timestamp || !nonce || !signature || !/^\d+$/.test(timestamp)) return null;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(nonce) || (job === null) === (webhook === null)) return null;
  const nowS = now / 1000;
  if (Math.abs(nowS - Number(timestamp)) > MAX_SKEW_S) return null;

  const url = new URL(request.url);
  const body = await request.text();
  const expected = Buffer.from(
    extendSignature(secret, {
      method: request.method,
      pathWithQuery: url.pathname + url.search,
      target: job !== null ? `job:${job}` : `webhook:${webhook}`,
      timestamp,
      nonce,
      body,
    }),
  );
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  // Only once the signature is good, so nobody can use up a nonce.
  if (!rememberNonce(nonce, nowS)) return null;
  return { body, job, webhook };
}
