import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectManifest, decryptToken, encryptToken } from "../app/lib/connect.server";

// Made by Extend control's Encryptor (services/control/src/crypto.ts) with this key:
// the app must read exactly what Connect writes.
const KEY = "BQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU=";
const FROM_CONNECT = "v1.EatzEif6liEWqmU_YyvCxARYp2MzUfb93Yv0QsdDA1IoeyyRMu1rDLW284XJIAk2uCtw8OQ";

describe("token encryption", () => {
  beforeEach(() => vi.stubEnv("OAUTH_TOKEN_KEY", KEY));
  afterEach(() => vi.unstubAllEnvs());

  it("decrypts what Connect stores", () => {
    expect(decryptToken(FROM_CONNECT)).toBe("ya29.example-access-token");
  });

  it("round-trips, with a fresh IV each time", () => {
    const a = encryptToken("secret");
    expect(a).toMatch(/^v1\./);
    expect(a).not.toBe(encryptToken("secret"));
    expect(decryptToken(a)).toBe("secret");
  });

  it("refuses tampered tokens and a wrong key", () => {
    const flipped = FROM_CONNECT.slice(0, -2) + (FROM_CONNECT.endsWith("Q") ? "AA" : "QQ");
    expect(() => decryptToken(flipped)).toThrow();
    vi.stubEnv("OAUTH_TOKEN_KEY", Buffer.alloc(32, 6).toString("base64"));
    expect(() => decryptToken(FROM_CONNECT)).toThrow();
  });
});

describe("the managed manifest", () => {
  const cwd = process.cwd();
  afterEach(() => process.chdir(cwd));

  it("reads .extend/connect.json from the app root, and copes without one", () => {
    const dir = mkdtempSync(join(tmpdir(), "connect-manifest-"));
    process.chdir(dir);
    expect(connectManifest()).toEqual({ providers: [] });

    mkdirSync(join(dir, ".extend"));
    const manifest = { providers: [{ id: "google", name: "Google", mode: "user", scopes: ["email"] }] };
    writeFileSync(join(dir, ".extend", "connect.json"), JSON.stringify(manifest));
    expect(connectManifest()).toEqual(manifest);
  });
});
