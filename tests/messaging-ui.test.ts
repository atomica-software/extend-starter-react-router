import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { Outbox, type OutboxItem } from "../app/components/messaging";

const base: OutboxItem = {
  id: 1,
  mode: "test",
  toNumber: "+447700900513",
  body: "Can you cover Saturday? Reply YES or NO",
  status: "simulated",
  error: null,
  expects: ["YES", "NO"],
  replyBody: null,
  replyKeyword: null,
  createdAt: "2026-10-01T09:00:00Z",
  repliedAt: null,
};

/** Renders inside a router at /shifts/7, as a page would. */
function render(rows: OutboxItem[], simulate: boolean) {
  const Stub = createRoutesStub([{ path: "/shifts/7", Component: () => createElement(Outbox, { rows, simulate }) }]);
  return renderToString(createElement(Stub, { initialEntries: ["/shifts/7"] }));
}

describe("<Outbox>", () => {
  it("labels test-mode texts as simulated, not sent, and offers simulated replies", () => {
    const html = render([base], true);
    expect(html).toContain("Simulated (not sent)");
    expect(html).toContain("Waiting for a reply (YES / NO)");
    expect(html).toContain('action="/_app/sms/simulate"');
    expect(html).toContain('name="redirectTo" value="/shifts/7"');
    expect(html).toMatch(/name="body" value="YES"/);
  });

  it("shows replies and errors, and no simulation for live or answered texts", () => {
    const html = render(
      [
        { ...base, id: 2, mode: "live", status: "failed", error: "Twilio 400 (21211): invalid number" },
        { ...base, id: 3, status: "simulated", replyBody: "yes", replyKeyword: "YES", repliedAt: "2026-10-01T09:05:00Z" },
      ],
      true,
    );
    expect(html).toContain("Failed");
    expect(html).toContain("Twilio 400 (21211): invalid number");
    expect(html).toContain("YES");
    expect(html).not.toContain("/_app/sms/simulate");
    expect(render([], false)).toContain("No texts yet.");
  });
});
