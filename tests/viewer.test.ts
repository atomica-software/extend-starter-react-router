import { describe, expect, it } from "vitest";

import { getViewer, requireViewer } from "../app/lib/viewer.server";

function req(headers: Record<string, string>) {
  return new Request("http://app.test/", { headers });
}

describe("getViewer", () => {
  it("parses all X-CZ-* headers", () => {
    const viewer = getViewer(
      req({
        "X-CZ-User-Id": "42",
        "X-CZ-User-Name": "Ada Lovelace",
        "X-CZ-User-Email": "ada@example.com",
        "X-CZ-Team": "acme",
        "X-CZ-Role": "admin",
      }),
    );
    expect(viewer).toEqual({
      id: "42",
      name: "Ada Lovelace",
      email: "ada@example.com",
      team: "acme",
      role: "admin",
    });
  });

  it("is case-insensitive on header names and role values", () => {
    const viewer = getViewer(req({ "x-cz-user-id": "7", "x-cz-role": "Member" }));
    expect(viewer?.id).toBe("7");
    expect(viewer?.role).toBe("member");
  });

  it("decodes percent-encoded non-ASCII values from the stack", () => {
    const viewer = getViewer(req({ "X-CZ-User-Id": "1", "X-CZ-User-Name": "Zo%C3%AB %25 Ng" }));
    expect(viewer?.name).toBe("Zoë % Ng");
  });

  it("returns null without a user id", () => {
    expect(getViewer(req({}))).toBeNull();
    expect(getViewer(req({ "X-CZ-User-Id": "  ", "X-CZ-Team": "acme" }))).toBeNull();
  });

  it("defaults missing fields and treats unknown roles as restricted", () => {
    const viewer = getViewer(req({ "X-CZ-User-Id": "1", "X-CZ-Role": "owner" }));
    expect(viewer).toEqual({ id: "1", name: "", email: "", team: "", role: "restricted" });
  });
});

describe("requireViewer", () => {
  it("returns the viewer when present", () => {
    expect(requireViewer(req({ "X-CZ-User-Id": "1" })).id).toBe("1");
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
