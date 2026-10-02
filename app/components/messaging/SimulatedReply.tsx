import { Form, useLocation } from "react-router";

import type { OutboxRow } from "~/db/messaging-schema";

import { Button, Input } from "../ui";

/**
 * Test mode: answer a simulated text as its recipient would (one button per
 * expected keyword, or any text). It goes through the same reply handling as a
 * real one. Shows nothing for live texts or ones already answered; render it
 * for admins only (POST /_app/sms/simulate refuses anyone else).
 */
export function SimulatedReply({ row }: { row: Pick<OutboxRow, "id" | "mode" | "expects"> & { repliedAt: Date | string | null } }) {
  const location = useLocation();
  if (row.mode !== "test" || !row.expects || row.repliedAt) return null;
  const back = location.pathname + location.search;
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <span className="text-xs text-gray-500">Simulate a reply:</span>
      {row.expects.map((keyword) => (
        <Form key={keyword} method="post" action="/_app/sms/simulate">
          <input type="hidden" name="outboxId" value={row.id} />
          <input type="hidden" name="redirectTo" value={back} />
          <input type="hidden" name="body" value={keyword} />
          <Button type="submit" size="sm" variant="outline">{keyword}</Button>
        </Form>
      ))}
      <Form method="post" action="/_app/sms/simulate" className="flex items-center gap-2">
        <input type="hidden" name="outboxId" value={row.id} />
        <input type="hidden" name="redirectTo" value={back} />
        <Input name="body" placeholder="Other reply…" aria-label="Simulated reply" className="h-8 w-40" required />
        <Button type="submit" size="sm" variant="ghost">Send</Button>
      </Form>
    </div>
  );
}
