import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extendSignature, verifyExtendCall } from "../app/lib/extend-jobs.server";

const SECRET = "jobs-secret";
const NOW = Date.parse("2026-09-25T12:00:00Z");
const TS = String(NOW / 1000);
let n = 0;

/** A call to the stripe webhook route, signed as control signs it unless headers say otherwise. */
function call(body: string, over: Record<string, string> = {}, sign: Partial<{ path: string; target: string; ts: string }> = {}) {
  const nonce = over["x-extend-nonce"] ?? `nonce-${String(++n).padStart(16, "0")}`;
  const ts = over["x-extend-timestamp"] ?? TS;
  const signature = extendSignature(SECRET, {
    method: "POST",
    pathWithQuery: sign.path ?? "/_hooks/stripe?x=1",
    target: sign.target ?? "webhook:stripe",
    timestamp: sign.ts ?? ts,
    nonce,
    body,
  });
  const headers = {
    "x-extend-timestamp": ts,
    "x-extend-nonce": nonce,
    "x-extend-signature-v2": signature,
    "x-extend-webhook": "stripe",
    ...over,
  };
  return new Request("http://app/_hooks/stripe?x=1", { method: "POST", body, headers });
}

describe("verifyExtendCall", () => {
  beforeEach(() => vi.stubEnv("EXTEND_JOBS_SECRET", SECRET));
  afterEach(() => vi.unstubAllEnvs());

  it("accepts a call Extend signed, and returns the raw body", async () => {
    const body = '{"type":"invoice.paid"}';
    expect(await verifyExtendCall(call(body), NOW)).toEqual({ body, job: null, webhook: "stripe" });
  });

  it("refuses a missing or wrong signature, a changed body and a stale timestamp", async () => {
    expect(await verifyExtendCall(new Request("http://app/_hooks/stripe", { method: "POST", body: "a" }), NOW)).toBeNull();
    expect(await verifyExtendCall(call("a", { "x-extend-signature-v2": "v2=00" }), NOW)).toBeNull();
    const signedA = call("a");
    const changed = new Request(signedA.url, { method: "POST", body: "b", headers: signedA.headers });
    expect(await verifyExtendCall(changed, NOW)).toBeNull();
    expect(await verifyExtendCall(call("a"), NOW + 61_000)).toBeNull();
  });

  it("refuses a call signed for another route or another job", async () => {
    expect(await verifyExtendCall(call("a", {}, { path: "/_hooks/other" }), NOW)).toBeNull();
    expect(await verifyExtendCall(call("a", {}, { target: "webhook:github" }), NOW)).toBeNull();
    expect(await verifyExtendCall(call("a", { "x-extend-job": "digest" }), NOW)).toBeNull();
  });

  it("accepts each call once", async () => {
    const first = call("a");
    const replay = new Request(first.url, { method: "POST", body: "a", headers: first.headers });
    expect(await verifyExtendCall(first, NOW)).not.toBeNull();
    expect(await verifyExtendCall(replay, NOW)).toBeNull();
  });

  it("refuses the older v1 signature on its own", async () => {
    const headers = { "x-extend-timestamp": TS, "x-extend-signature": "v1=00", "x-extend-webhook": "stripe" };
    expect(await verifyExtendCall(new Request("http://app/_hooks/stripe", { method: "POST", body: "a", headers }), NOW)).toBeNull();
  });

  it("matches Extend control's signing (CONTRACTS §6.13)", () => {
    // services/control/src/jobs/service.ts signCall("jobs-secret", {post, /_hooks/stripe?x=1, webhook:stripe, 1790000000, AAAA…, "hello"})
    expect(
      extendSignature(SECRET, {
        method: "post",
        pathWithQuery: "/_hooks/stripe?x=1",
        target: "webhook:stripe",
        timestamp: "1790000000",
        nonce: "AAAAAAAAAAAAAAAAAAAAAA",
        body: "hello",
      }),
    ).toBe("v2=03fe3850155beb57816a3fdbb806b92b4e2e840607d16f5a9d4a6c134d256ecf");
  });
});
