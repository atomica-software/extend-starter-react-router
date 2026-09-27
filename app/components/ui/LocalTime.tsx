import { useEffect, useState } from "react";

/**
 * A date or time in the viewer's own time zone and format.
 *
 * The server doesn't know the viewer's time zone, so `toLocaleString()` in a
 * component renders one thing on the server and another in the browser, and
 * React reports a hydration mismatch. This renders the same fixed UTC text on
 * both, then switches to local time once it's in the browser.
 *
 *   <LocalTime value={row.createdAt} />
 *   <LocalTime value={row.createdAt} options={{ dateStyle: "medium" }} />
 */
export function LocalTime({
  value,
  options = { dateStyle: "medium", timeStyle: "short" },
  className,
}: {
  value: string | number | Date;
  options?: Intl.DateTimeFormatOptions;
  className?: string;
}) {
  const date = value instanceof Date ? value : new Date(value);
  const valid = !Number.isNaN(date.getTime());
  const [text, setText] = useState(() =>
    valid ? `${date.toLocaleString("en-GB", { ...options, timeZone: "UTC" })} UTC` : "",
  );
  useEffect(() => {
    if (valid) setText(date.toLocaleString(undefined, options));
    // Re-format when the instant changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid ? date.getTime() : null]);

  if (!valid) return null;
  return (
    <time dateTime={date.toISOString()} className={className}>
      {text}
    </time>
  );
}
