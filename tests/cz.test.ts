import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  appAddressBooks,
  contactDisplayName,
  contactMobileE164,
  contactUrl,
  cz,
  CzApiError,
  CzNotConnectedError,
  czHost,
  czPublicUrl,
} from "../app/lib/cz.server";

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

describe("contact helpers (#39)", () => {
  /** Answers by path: the team, phone/details (by number) and address books. */
  function api(routes: { country?: string | null; numbers?: Record<string, { e164: string; type: string } | "invalid">; books?: unknown[] }) {
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      const path = url.pathname.replace(/^\/cz\//, "");
      if (path === "phone/details") {
        const { phone } = JSON.parse(String(init?.body)) as { phone: string };
        const n = routes.numbers?.[phone];
        if (!n || n === "invalid") return json(422, { error: "Invalid phone number. Select a country to help parse it." });
        return json(200, { country: "GB", calling_code: 44, number_type: n.type, formats: { e164: n.e164, international: n.e164, national: phone, rfc3966: "" }, dial_from: null, dial_from_formatted: null });
      }
      if (/^teams\/[^/]+\/address-books$/.test(path)) return json(200, { data: routes.books ?? [] });
      if (/^teams\/[^/]+$/.test(path)) return json(200, { slug: path.split("/")[1], phone_number_country: routes.country ?? null });
      return json(404, { message: "not found" });
    });
  }
  const phone = (value: string, label?: string, meta?: { phone_e164: string; phone_type: number }) => ({
    field_value: value,
    custom_label: null,
    contact_field: { component_key: "Phone" },
    contact_field_label: label ? { label_value: label } : null,
    ...(meta ? { phone_meta: { phone_country: null, ...meta } } : {}),
  });
  const paths = () => fetchMock.mock.calls.map((c) => new URL(String(c[0])).pathname.replace(/^\/cz\//, ""));

  it("links to a contact's page on the stack's Contactzilla", () => {
    expect(contactUrl({ team: "acme" }, "clients", "9f1c")).toBe("https://contactzilla.us/teams/acme/address-books/clients/contacts/9f1c");
    expect(contactUrl({ team: "a b" }, "x/y", "1")).toBe("https://contactzilla.us/teams/a%20b/address-books/x%2Fy/contacts/1");
  });

  it("lists only the address books the app is available in", async () => {
    api({ books: [{ slug: "staff", in_app: true }, { slug: "board", in_app: false }, { slug: "volunteers", in_app: true }] });
    expect((await appAddressBooks({ id: "7", team: "acme" })).map((b) => b.slug)).toEqual(["staff", "volunteers"]);
    expect(sentHeaders()["X-CZ-User-Id"]).toBe("7");
    // In a job, as the app.
    await appAddressBooks({ team: "acme" });
    expect(sentHeaders()["X-CZ-User-Id"]).toBeUndefined();
    // A Contactzilla that doesn't mark them yet: every book counts.
    api({ books: [{ slug: "staff" }, { slug: "board" }] });
    expect((await appAddressBooks({ team: "acme" })).map((b) => b.slug)).toEqual(["staff", "board"]);
  });

  it("takes a formatted mobile's E.164 without asking Contactzilla", async () => {
    api({});
    const c = { contact_data: [phone("020 7946 0000", "Work", { phone_e164: "+442079460000", phone_type: 0 }), phone("07700 900123", "Home", { phone_e164: "+447700900123", phone_type: 1 })] };
    expect(await contactMobileE164({ team: "t1" }, c)).toBe("+447700900123");
    expect(fetchMock).not.toHaveBeenCalled();
    // A landline only when asked for.
    const landline = { contact_data: [phone("020 7946 0000", "Work", { phone_e164: "+442079460000", phone_type: 0 })] };
    expect(await contactMobileE164({ team: "t1" }, landline)).toBeUndefined();
    expect(await contactMobileE164({ team: "t1" }, landline, { allowLandline: true })).toBe("+442079460000");
  });

  it("counts a US number of type 2 as a mobile", async () => {
    api({});
    const c = { contact_data: [phone("(212) 555-0123", "Work", { phone_e164: "+12125550123", phone_type: 2 })] };
    expect(await contactMobileE164({ team: "t2" }, c)).toBe("+12125550123");
  });

  it("normalises a national number without phone_meta in the team's country", async () => {
    api({ country: "GB", numbers: { "01632 960000": { e164: "+441632960000", type: "Fixed line" }, "07700 900513": { e164: "+447700900513", type: "Mobile" } } });
    // A landline listed first, neither formatted, neither labelled Mobile.
    const c = { contact_data: [phone("01632 960000", "Home"), phone("07700 900513", "Work")] };
    expect(await contactMobileE164({ id: "1", team: "t3" }, c)).toBe("+447700900513");
    const details = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/phone/details")).map((call) => JSON.parse(String(call[1]?.body)));
    expect(details).toEqual([
      { phone: "01632 960000", country: "GB" },
      { phone: "07700 900513", country: "GB" },
    ]);
    // The team's country is looked up once, then remembered.
    fetchMock.mockClear();
    await contactMobileE164({ id: "1", team: "t3" }, c);
    expect(paths()).not.toContain("teams/t3");
  });

  it("uses the given country, skips invalid numbers and returns undefined when nothing is textable", async () => {
    api({ numbers: { "0412 345 678": { e164: "+61412345678", type: "Mobile" }, "555": "invalid" } });
    const c = { contact_data: [phone("555", "Mobile"), phone("0412 345 678")] };
    expect(await contactMobileE164({ team: "t4" }, c, { country: "AU" })).toBe("+61412345678");
    expect(paths()).not.toContain("teams/t4");
    expect(await contactMobileE164({ team: "t4" }, { contact_data: [] })).toBeUndefined();
  });
});
