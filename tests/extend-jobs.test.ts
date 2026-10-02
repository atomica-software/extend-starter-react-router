import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extendSignature, twilioSignature, verifyExtendCall, verifyTwilioSignature, type ExtendCall } from "../app/lib/extend-jobs.server";

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
    expect(await verifyExtendCall(call(body), NOW)).toEqual({ body, job: null, webhook: "stripe", url: null });
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

describe("verifyTwilioSignature", () => {
  const TOKEN = "twilio-auth-token";
  const URL_ = "https://hooks.abc.extend.example/live/twilio-sms/tok123?x=1";
  const form = "From=%2B15005550006&Body=YES&MessageSid=SM1";
  const params = new URLSearchParams(form);
  const extendCall = (over: Partial<ExtendCall> = {}): ExtendCall => ({ body: form, job: null, webhook: "twilio-sms", url: URL_, ...over });
  const request = (headers: Record<string, string>) =>
    new Request("http://app/_hooks/twilio-sms?x=1", { method: "POST", body: form, headers: { "content-type": "application/x-www-form-urlencoded", ...headers } });

  it("matches Twilio's documented example", () => {
    const p = new URLSearchParams({ CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" });
    expect(twilioSignature("12345", "https://mycompany.com/myapp.php?foo=1&bar=2", p)).toBe("0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
  });

  it("accepts Twilio's signature over the public URL and the form fields", () => {
    const signed = request({ "x-twilio-signature": twilioSignature(TOKEN, URL_, params) });
    expect(verifyTwilioSignature(signed, extendCall(), TOKEN)).toBe(true);
    // Signed with the default port in the URL.
    const withPort = request({ "x-twilio-signature": twilioSignature(TOKEN, URL_.replace(".example/", ".example:443/"), params) });
    expect(verifyTwilioSignature(withPort, extendCall(), TOKEN)).toBe(true);
  });

  it("refuses an unsigned, tampered or misdirected request", () => {
    const sig = twilioSignature(TOKEN, URL_, params);
    expect(verifyTwilioSignature(request({}), extendCall(), TOKEN)).toBe(false);
    expect(verifyTwilioSignature(request({ "x-twilio-signature": sig }), extendCall({ body: form.replace("YES", "NO") }), TOKEN)).toBe(false);
    expect(verifyTwilioSignature(request({ "x-twilio-signature": sig }), extendCall({ url: URL_.replace("/live/", "/preview/") }), TOKEN)).toBe(false);
    expect(verifyTwilioSignature(request({ "x-twilio-signature": sig }), extendCall({ url: null }), TOKEN)).toBe(false);
    expect(verifyTwilioSignature(request({ "x-twilio-signature": sig }), extendCall(), "another-token")).toBe(false);
    expect(verifyTwilioSignature(request({ "x-twilio-signature": sig }), extendCall(), undefined)).toBe(false);
  });

  it("checks a JSON body through bodySHA256", async () => {
    const body = '{"a":1}';
    const { createHash } = await import("node:crypto");
    const url = `https://hooks.abc.extend.example/live/t/tok?bodySHA256=${createHash("sha256").update(body).digest("hex")}`;
    const req = new Request("http://app/_hooks/t", { method: "POST", body, headers: { "content-type": "application/json", "x-twilio-signature": twilioSignature(TOKEN, url, null) } });
    expect(verifyTwilioSignature(req, { body, job: null, webhook: "t", url }, TOKEN)).toBe(true);
    expect(verifyTwilioSignature(req, { body: '{"a":2}', job: null, webhook: "t", url }, TOKEN)).toBe(false);
  });

  it("gets the URL from Extend's header", async () => {
    vi.stubEnv("EXTEND_JOBS_SECRET", SECRET);
    try {
      const got = await verifyExtendCall(call("a", { "x-extend-webhook-url": URL_ }), NOW);
      expect(got?.url).toBe(URL_);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
