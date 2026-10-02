import { afterEach, describe, expect, it, vi } from "vitest";
import { UNSAFE_ErrorResponseImpl as ErrorResponse } from "react-router";

import { handleError } from "../app/entry.server";
import { isBuilderRequest } from "../app/lib/extend-origin.server";
import { action } from "../app/routes/_app.log";

// The same vector as services/builder/test/extend-identity.test.ts: what extend-preview,
// extend-screenshot and extend-verify send.
const KEY = "test-vector-key";
const NOW = 1_790_000_000_000;
const SIGNED = {
  "X-Extend-Builder": "test",
  "X-Extend-Builder-Timestamp": "1790000000",
  "X-Extend-Builder-Signature": "v1=36a46e18ce4267dd140670d8fd0167aa74dfee57b0323171bbd156a19885a5bc",
};

describe("isBuilderRequest (#48)", () => {
  it("accepts the Builder's signed header", () => {
    expect(isBuilderRequest(new Headers(SIGNED), KEY, NOW)).toBe(true);
  });

  it("ignores it unsigned, stale, under another key, or without a key", () => {
    expect(isBuilderRequest(new Headers({ "X-Extend-Builder": "test" }), KEY, NOW)).toBe(false);
    expect(isBuilderRequest(new Headers(SIGNED), KEY, NOW + 301_000)).toBe(false);
    expect(isBuilderRequest(new Headers(SIGNED), "other-key", NOW)).toBe(false);
    expect(isBuilderRequest(new Headers(SIGNED), "", NOW)).toBe(false);
    expect(isBuilderRequest(new Headers({ ...SIGNED, "X-Extend-Builder": "prod" }), KEY, NOW)).toBe(false);
  });
});

describe("records from the Builder's test requests (#48)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  const lines = (write: { mock: { calls: unknown[][] } }) => write.mock.calls.map((c) => JSON.parse(String(c[0]).slice("[extend-log] ".length)));
  const request = (method: string, headers: Record<string, string> = {}) => new Request("http://app.test/", { method, headers });

  function setup() {
    vi.useFakeTimers({ now: NOW });
    vi.stubEnv("EXTEND_IDENTITY_KEY", KEY);
    return vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  }

  it("handleError: a Builder POST without an action is info; a viewer's is still an error", () => {
    const write = setup();
    const missingAction = new ErrorResponse(405, "Method Not Allowed", null);
    handleError(missingAction, { request: request("POST", SIGNED), params: {}, context: {} } as never);
    handleError(missingAction, { request: request("POST"), params: {}, context: {} } as never);
    const [builder, viewer] = lines(write);
    expect(builder).toMatchObject({ level: "info", origin: "builder" });
    expect(builder.message).toContain("index route's action is at ?index");
    expect(viewer).toMatchObject({ level: "error", message: "Unhandled server error in POST (405)" });
    expect(viewer).not.toHaveProperty("origin");
  });

  it("handleError: a Builder request that breaks the app is still an error, marked as the Builder's", () => {
    const write = setup();
    handleError(new Error("db down"), { request: request("GET", SIGNED), params: {}, context: {} } as never);
    expect(lines(write)[0]).toMatchObject({ level: "error", origin: "builder", message: "Unhandled server error in GET: db down" });
  });

  it("/_app/log: records from a page the Builder loaded are its own; a page can't claim that itself", async () => {
    const write = setup();
    const post = (headers: Record<string, string>, records: object[]) =>
      action({ request: new Request("http://app.test/_app/log", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(records) }) } as never);
    await post(SIGNED, [{ level: "error", message: "from the screenshot" }]);
    await post({}, [{ level: "error", message: "claims builder", origin: "builder" }, { level: "info", message: "hot reload", origin: "hmr" }]);
    const [shot, claim, hmr] = lines(write);
    expect(shot).toMatchObject({ source: "client", origin: "builder" });
    expect(claim).not.toHaveProperty("origin");
    expect(hmr).toMatchObject({ origin: "hmr" });
  });

  it("/_app/log: no hot reloads in production", async () => {
    const write = setup();
    vi.stubEnv("NODE_ENV", "production");
    await action({ request: new Request("http://app.test/_app/log", { method: "POST", body: JSON.stringify([{ level: "error", message: "x", origin: "hmr" }]) }) } as never);
    expect(lines(write)[0]).not.toHaveProperty("origin");
  });
});
