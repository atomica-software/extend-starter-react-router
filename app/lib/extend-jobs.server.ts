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
 *
 * Webhooks also get X-Extend-Webhook-Url, the full public URL the provider called
 * (call.url), which providers such as Twilio sign. Check theirs too:
 *
 *   const call = await verifyExtendCall(request);
 *   if (!call || !verifyTwilioSignature(request, call)) return new Response("Forbidden", { status: 403 });
 *   const form = new URLSearchParams(call.body);   // From, Body, MessageSid…
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

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
  /**
   * The full public URL the webhook was called at, query included (X-Extend-Webhook-Url,
   * set by Extend: a sender's copy is dropped); null for a cron job. It holds the
   * webhook's secret token: don't log it or show it.
   */
  url: string | null;
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
  return { body, job, webhook, url: webhook !== null ? request.headers.get("x-extend-webhook-url") : null };
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Twilio's signature of a request to `url` with these form fields (base64 HMAC-SHA1). */
export function twilioSignature(authToken: string, url: string, params: URLSearchParams | null): string {
  let data = url;
  if (params) {
    for (const name of [...new Set(params.keys())].sort()) {
      for (const value of params.getAll(name).sort()) data += name + value;
    }
  }
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

/** The URL with and without the default port: Twilio may have signed either. */
function portVariants(url: string): string[] {
  try {
    const u = new URL(url);
    if (u.port) {
      const without = new URL(url);
      without.port = "";
      return [url, without.href];
    }
    const withPort = url.replace(/^(https?:\/\/[^/?#]+)/, `$1:${u.protocol === "https:" ? 443 : 80}`);
    return [url, withPort];
  } catch {
    return [url];
  }
}

/**
 * Whether a webhook call really came from Twilio: its X-Twilio-Signature over the
 * public URL Twilio called (call.url) and the form fields, under your account's
 * auth token (the TWILIO_AUTH_TOKEN secret by default). Call it after
 * verifyExtendCall. A JSON body is checked through the URL's bodySHA256.
 * `extend-webhook send <name> --sign twilio` sends a test that passes.
 */
export function verifyTwilioSignature(request: Request, call: ExtendCall, authToken: string | undefined = process.env.TWILIO_AUTH_TOKEN): boolean {
  const signature = request.headers.get("x-twilio-signature");
  if (!authToken || !signature || !call.url) return false;
  const form = /^application\/x-www-form-urlencoded/i.test(request.headers.get("content-type") ?? "");
  let params: URLSearchParams | null = form ? new URLSearchParams(call.body) : null;
  if (!form) {
    // JSON and other bodies: Twilio signs the URL alone, which carries the body's hash.
    let bodyHash: string | null = null;
    try {
      bodyHash = new URL(call.url).searchParams.get("bodySHA256");
    } catch {
      return false;
    }
    if (bodyHash !== null && !safeEqual(bodyHash, createHash("sha256").update(call.body).digest("hex"))) return false;
    params = null;
  }
  return portVariants(call.url).some((url) => safeEqual(twilioSignature(authToken, url, params), signature));
}
