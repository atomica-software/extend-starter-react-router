import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocalTime } from "../app/components/ui/LocalTime";

describe("LocalTime", () => {
  it("renders the same fixed UTC text wherever it runs, so hydration matches", () => {
    const html = renderToString(createElement(LocalTime, { value: "2026-09-27T13:05:00Z" }));
    expect(html).toContain('dateTime="2026-09-27T13:05:00.000Z"');
    expect(html).toContain("27 Sept 2026, 13:05 UTC");
    const again = renderToString(createElement(LocalTime, { value: new Date("2026-09-27T13:05:00Z") }));
    expect(again).toBe(html);
  });

  it("renders nothing for an invalid date", () => {
    expect(renderToString(createElement(LocalTime, { value: "not a date" }))).toBe("");
  });
});
