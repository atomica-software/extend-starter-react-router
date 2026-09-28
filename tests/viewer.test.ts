import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getViewer, hasValidIdentitySignature, IDENTITY_MAX_AGE_SECONDS, requireViewer } from "../app/lib/viewer.server";

const KEY = "preview-identity-key-0123456789abcdef";
const NOW = Date.parse("2026-09-28T12:00:00Z");

/** What the edge sends: the identity headers and a signature over them (as control makes it). */
function signed(identity: Record<string, string>, opts: { key?: string; ts?: number } = {}): Record<string, string> {
  const ts = String(opts.ts ?? Math.floor(NOW / 1000));
  const names = ["X-CZ-User-Id", "X-CZ-User-Name", "X-CZ-User-Email", "X-CZ-Team", "X-CZ-Role"];
  const payload = ["extend-identity-v1", ts, ...names.map((n) => identity[n] ?? "")].join("\n");
  const sig = createHmac("sha256", opts.key ?? KEY).update(payload).digest("hex");
  return { ...identity, "X-CZ-Identity-Timestamp": ts, "X-CZ-Identity-Signature": `v1=${sig}` };
}

function req(headers: Record<string, string>) {
  return new Request("http://app.test/", { headers });
}

const ADA = {
  "X-CZ-User-Id": "42",
  "X-CZ-User-Name": "Ada Lovelace",
  "X-CZ-User-Email": "ada@example.com",
  "X-CZ-Team": "acme",
  "X-CZ-Role": "admin",
};

beforeEach(() => {
  vi.stubEnv("EXTEND_IDENTITY_KEY", KEY);
  vi.stubEnv("EXTEND_TRUST_IDENTITY_HEADERS", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getViewer", () => {
  it("parses all X-CZ-* headers when the edge signed them", () => {
    expect(getViewer(req(signed(ADA)), NOW)).toEqual({
      id: "42",
      name: "Ada Lovelace",
      email: "ada@example.com",
      team: "acme",
      role: "admin",
    });
  });

  it("is case-insensitive on header names and role values", () => {
    const h = signed({ "X-CZ-User-Id": "7", "X-CZ-Role": "Member" });
    const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
    const viewer = getViewer(req(lower), NOW);
    expect(viewer?.id).toBe("7");
    expect(viewer?.role).toBe("member");
  });

  it("decodes percent-encoded non-ASCII values from the stack", () => {
    const viewer = getViewer(req(signed({ "X-CZ-User-Id": "1", "X-CZ-User-Name": "Zo%C3%AB %25 Ng" })), NOW);
    expect(viewer?.name).toBe("Zoë % Ng");
  });

  it("returns null without a user id", () => {
    expect(getViewer(req(signed({})), NOW)).toBeNull();
    expect(getViewer(req(signed({ "X-CZ-User-Id": "  ", "X-CZ-Team": "acme" })), NOW)).toBeNull();
  });

  it("defaults missing fields and treats unknown roles as restricted", () => {
    const viewer = getViewer(req(signed({ "X-CZ-User-Id": "1", "X-CZ-Role": "owner" })), NOW);
    expect(viewer).toEqual({ id: "1", name: "", email: "", team: "", role: "restricted" });
  });
});

describe("identity signature (#7)", () => {
  it("refuses headers without a signature: anything that can reach the app could send them", () => {
    expect(getViewer(req(ADA), NOW)).toBeNull();
  });

  it("refuses a tampered identity", () => {
    const good = signed(ADA);
    for (const [name, value] of [
      ["X-CZ-User-Id", "1"],
      ["X-CZ-User-Name", "Eve"],
      ["X-CZ-User-Email", "eve@example.com"],
      ["X-CZ-Team", "other-team"],
      ["X-CZ-Role", "member"],
      ["X-CZ-Identity-Timestamp", String(Math.floor(NOW / 1000) - 1)],
    ] as const) {
      expect(getViewer(req({ ...good, [name]: value }), NOW), name).toBeNull();
    }
    const flipped = good["X-CZ-Identity-Signature"]!.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
    expect(getViewer(req({ ...good, "X-CZ-Identity-Signature": flipped }), NOW)).toBeNull();
    expect(getViewer(req({ ...good, "X-CZ-Identity-Signature": "v1=zz" }), NOW)).toBeNull();
  });

  it("refuses another environment's (or any other) key", () => {
    expect(getViewer(req(signed(ADA, { key: "live-identity-key-0123456789abcdef" })), NOW)).toBeNull();
  });

  it(`refuses a signature more than ${IDENTITY_MAX_AGE_SECONDS} seconds old, or ahead`, () => {
    const ts = Math.floor(NOW / 1000);
    expect(getViewer(req(signed(ADA, { ts: ts - IDENTITY_MAX_AGE_SECONDS })), NOW)?.id).toBe("42");
    expect(getViewer(req(signed(ADA, { ts: ts - IDENTITY_MAX_AGE_SECONDS - 1 })), NOW)).toBeNull();
    expect(getViewer(req(signed(ADA, { ts: ts + IDENTITY_MAX_AGE_SECONDS + 1 })), NOW)).toBeNull();
  });

  it("accepts what Extend's control signs (a vector from services/control/test/identity.test.ts)", () => {
    const headers = new Headers({
      "X-CZ-User-Id": "42",
      "X-CZ-User-Name": "Zo%C3%AB",
      "X-CZ-User-Email": "zoe@example.com",
      "X-CZ-Team": "acme",
      "X-CZ-Role": "admin",
      "X-CZ-Identity-Timestamp": "1790000000",
      "X-CZ-Identity-Signature": "v1=2a90cf37d3655485788e8507b69eaa9037d927674d1beac91a9fb6f8307fae75",
    });
    expect(hasValidIdentitySignature(headers, "test-vector-key", 1_790_000_000_000)).toBe(true);
  });

  it("checks against the key it is given", () => {
    const headers = new Headers(signed(ADA));
    expect(hasValidIdentitySignature(headers, KEY, NOW)).toBe(true);
    expect(hasValidIdentitySignature(headers, "", NOW)).toBe(false);
  });

  it("without a key, trusts headers only when told to (running behind a proxy of your own)", () => {
    vi.stubEnv("EXTEND_IDENTITY_KEY", "");
    expect(getViewer(req(signed(ADA)), NOW)).toBeNull();
    vi.stubEnv("EXTEND_TRUST_IDENTITY_HEADERS", "1");
    expect(getViewer(req(ADA), NOW)?.id).toBe("42");
  });
});

describe("requireViewer", () => {
  it("returns the viewer when present", () => {
    vi.useFakeTimers({ now: NOW });
    try {
      expect(requireViewer(req(signed({ "X-CZ-User-Id": "1" }))).id).toBe("1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws a 401 Response when absent", () => {
    try {
      requireViewer(req({}));
      expect.unreachable();
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(Response);
      expect((thrown as Response).status).toBe(401);
    }
  });
});
