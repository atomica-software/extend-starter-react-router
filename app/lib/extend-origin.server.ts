/**
 * Whether a request is the Extend Builder's own test traffic (extend-preview, extend-screenshot,
 * extend-verify). Those send `X-Extend-Builder: test`, signed with this environment's
 * EXTEND_IDENTITY_KEY like the identity headers (app/lib/viewer.server.ts):
 *
 *   X-Extend-Builder            test
 *   X-Extend-Builder-Timestamp  Unix time
 *   X-Extend-Builder-Signature  v1= + hex HMAC-SHA256 of "extend-builder-v1", the timestamp
 *                               and "test", one per line
 *
 * What such a request logs is marked `origin: "builder"` (app/entry.server.tsx, /_app/log), so
 * Contactzilla shows it as the Builder's testing, not as the app failing for a viewer. Extend's
 * edge only strips `X-CZ-*` headers, so an unsigned or stale value counts for nothing.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** How old (or how far ahead) the signature may be. */
export const BUILDER_MAX_AGE_SECONDS = 300;

export function isBuilderRequest(headers: Headers, key: string = process.env.EXTEND_IDENTITY_KEY ?? "", nowMs = Date.now()): boolean {
  if (headers.get("X-Extend-Builder")?.trim() !== "test") return false;
  const ts = headers.get("X-Extend-Builder-Timestamp")?.trim() ?? "";
  const sig = headers.get("X-Extend-Builder-Signature")?.trim() ?? "";
  if (!key || !/^\d{1,12}$/.test(ts) || !/^v1=[0-9a-f]{64}$/.test(sig)) return false;
  if (Math.abs(Math.floor(nowMs / 1000) - Number(ts)) > BUILDER_MAX_AGE_SECONDS) return false;
  const expected = createHmac("sha256", key).update(["extend-builder-v1", ts, "test"].join("\n")).digest();
  const given = Buffer.from(sig.slice(3), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
