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
 * Signature: X-Extend-Signature = "v1=" + hex HMAC-SHA256 of "{X-Extend-Timestamp}.{raw body}"
 * under EXTEND_JOBS_SECRET. Timestamps more than 5 minutes off are refused.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_SKEW_S = 5 * 60;

export interface ExtendCall {
  /** The raw request body (read once here; use this rather than request.text()). */
  body: string;
  /** The cron job's name, or null for a webhook. */
  job: string | null;
  /** The webhook's name, or null for a cron job. */
  webhook: string | null;
}

export function extendSignature(secret: string, timestamp: string, body: string): string {
  return "v1=" + createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** The call's details if Extend made it, else null. Reads the request body. */
export async function verifyExtendCall(request: Request, now: number = Date.now()): Promise<ExtendCall | null> {
  const secret = process.env.EXTEND_JOBS_SECRET;
  const timestamp = request.headers.get("x-extend-timestamp");
  const signature = request.headers.get("x-extend-signature");
  if (!secret || !timestamp || !signature || !/^\d+$/.test(timestamp)) return null;
  if (Math.abs(now / 1000 - Number(timestamp)) > MAX_SKEW_S) return null;

  const body = await request.text();
  const expected = Buffer.from(extendSignature(secret, timestamp, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { body, job: request.headers.get("x-extend-job"), webhook: request.headers.get("x-extend-webhook") };
}
