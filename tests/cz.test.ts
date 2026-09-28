import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { contactDisplayName, cz, CzApiError, CzNotConnectedError, czHost, czPublicUrl } from "../app/lib/cz.server";

const fetchMock = vi.fn<typeof fetch>();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function lastCall(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error("fetch was not called");
  return { url: String(call[0]), init: call[1] ?? {} };
}

function sentHeaders(): Record<string, string> {
  return lastCall().init.headers as Record<string, string>;
}

beforeEach(() => {
  vi.stubEnv("CZ_API_BASE", "http://control:8080/cz/");
  vi.stubEnv("CZ_API_HOST", "https://contactzilla.us");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("cz(viewer)", () => {
  it("calls the stack's proxy, not Contactzilla directly", async () => {
    fetchMock.mockResolvedValue(json(200, { count: 0, results: [] }));
    await cz().listContacts({ team: "acme", address_book: "clients", query: "a b", labels: ["vip", "lead"] });
    expect(lastCall().url).toBe(
      "http://control:8080/cz/teams/acme/address-books/clients/contacts?query=a+b&labels%5B%5D=vip&labels%5B%5D=lead",
    );
  });

  it("sends the viewer and never a token", async () => {
    fetchMock.mockResolvedValue(json(200, { data: [] }));
    await cz({ id: "42" }).listAddressBooks({ team: "acme" });
    expect(sentHeaders()["X-CZ-User-Id"]).toBe("42");
    expect(sentHeaders().Authorization).toBeUndefined();
  });

  it("omits X-CZ-User-Id without a viewer", async () => {
    fetchMock.mockResolvedValue(json(200, { data: [] }));
    await cz(null).listAddressBooks({ team: "acme" });
    expect(sentHeaders()["X-CZ-User-Id"]).toBeUndefined();
  });

  it("returns the API's response unchanged", async () => {
    fetchMock.mockResolvedValue(json(200, { count: 1, total_address_book_count: 9, results: [{ id: "c-1" }] }));
    const { results, count } = await cz().listContacts({ team: "acme", address_book: "clients" });
    expect(count).toBe(1);
    expect(results[0]?.id).toBe("c-1");
  });

  it("reaches any other endpoint with request()", async () => {
    fetchMock.mockResolvedValue(json(201, { ok: true }));
    await cz().request("POST", "teams/acme/thing", { body: { a: 1 } });
    expect(lastCall().url).toBe("http://control:8080/cz/teams/acme/thing");
    expect(lastCall().init.body).toBe('{"a":1}');
  });
});

describe("errors", () => {
  it("maps 503 cz_not_connected to CzNotConnectedError", async () => {
    fetchMock.mockResolvedValue(json(503, { error: "cz_not_connected" }));
    const error = await cz().listAddressBooks({ team: "acme" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CzNotConnectedError);
    expect(error).toBeInstanceOf(CzApiError);
    expect((error as CzApiError).status).toBe(503);
  });

  it("maps other failures to CzApiError with status and code", async () => {
    fetchMock.mockResolvedValue(json(403, { error: "outside_team", message: "Only this stack’s team is reachable" }));
    const error = (await cz().request("GET", "teams/other/address-books").catch((e: unknown) => e)) as CzApiError;
    expect(error).toBeInstanceOf(CzApiError);
    expect(error).not.toBeInstanceOf(CzNotConnectedError);
    expect(error.status).toBe(403);
    expect(error.code).toBe("outside_team");
  });

  it("wraps network failures", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const error = (await cz().listTeams().catch((e: unknown) => e)) as CzApiError;
    expect(error).toBeInstanceOf(CzApiError);
    expect(error.code).toBe("network_error");
  });
});

describe("helpers", () => {
  it("gives the stack's Contactzilla host for links", () => {
    expect(czHost()).toBe("https://contactzilla.us");
  });

  it("gives the bridge's Contactzilla: CZ_PUBLIC_URL, else CZ_API_HOST, else contactzilla.app", () => {
    vi.stubEnv("CZ_PUBLIC_URL", "https://localhost.test");
    expect(czPublicUrl()).toBe("https://localhost.test");
    // A stack from before CZ_PUBLIC_URL reached apps (compose sets it empty or not at all).
    vi.stubEnv("CZ_PUBLIC_URL", "");
    expect(czPublicUrl()).toBe("https://contactzilla.us");
    vi.stubEnv("CZ_API_HOST", "");
    expect(czPublicUrl()).toBe("https://contactzilla.app");
  });

  it("names a contact", () => {
    expect(contactDisplayName({ first_name: "Ada", last_name: "Lovelace" })).toBe("Ada Lovelace");
    expect(contactDisplayName({ company_name: "Acme" })).toBe("Acme");
    expect(contactDisplayName({})).toBe("(no name)");
  });
});
