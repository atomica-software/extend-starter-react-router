import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extendSignature, verifyExtendCall } from "../app/lib/extend-jobs.server";

const SECRET = "jobs-secret";
const NOW = Date.parse("2026-09-25T12:00:00Z");
const TS = String(NOW / 1000);

function call(body: string, headers: Record<string, string>) {
  return new Request("http://app/_hooks/stripe", { method: "POST", body, headers });
}

describe("verifyExtendCall", () => {
  beforeEach(() => vi.stubEnv("EXTEND_JOBS_SECRET", SECRET));
  afterEach(() => vi.unstubAllEnvs());

  it("accepts a call Extend signed, and returns the raw body", async () => {
    const body = '{"type":"invoice.paid"}';
    const r = await verifyExtendCall(
      call(body, { "x-extend-timestamp": TS, "x-extend-signature": extendSignature(SECRET, TS, body), "x-extend-webhook": "stripe" }),
      NOW,
    );
    expect(r).toEqual({ body, job: null, webhook: "stripe" });
  });

  it("refuses a missing or wrong signature, a changed body and an old timestamp", async () => {
    const sig = extendSignature(SECRET, TS, "a");
    expect(await verifyExtendCall(call("a", {}), NOW)).toBeNull();
    expect(await verifyExtendCall(call("b", { "x-extend-timestamp": TS, "x-extend-signature": sig }), NOW)).toBeNull();
    expect(await verifyExtendCall(call("a", { "x-extend-timestamp": TS, "x-extend-signature": "v1=00" }), NOW)).toBeNull();
    expect(await verifyExtendCall(call("a", { "x-extend-timestamp": TS, "x-extend-signature": sig }), NOW + 10 * 60_000)).toBeNull();
  });

  it("matches Extend control's signing (CONTRACTS §6.13)", () => {
    // services/control/src/jobs/service.ts signBody("jobs-secret", "1790000000", "hello")
    expect(extendSignature(SECRET, "1790000000", "hello")).toBe("v1=08a3bb43e2809a699993538fffdf9b1d0cb91d3d212a4e69c27e406917baee2e");
  });
});
