import type { OutboxRow } from "~/db/messaging-schema";

import { Badge, type BadgeTone, LocalTime } from "../ui";
import { SimulatedReply } from "./SimulatedReply";

export type OutboxItem = Pick<OutboxRow, "id" | "mode" | "toNumber" | "body" | "status" | "error" | "expects" | "replyBody" | "replyKeyword"> & {
  createdAt: Date | string;
  repliedAt: Date | string | null;
};

const STATUS: Record<OutboxRow["status"], { label: string; tone: BadgeTone }> = {
  queued: { label: "Queued", tone: "gray" },
  sent: { label: "Sent", tone: "blue" },
  delivered: { label: "Delivered", tone: "green" },
  undelivered: { label: "Not delivered", tone: "red" },
  failed: { label: "Failed", tone: "red" },
  // Test mode: recorded, never sent. Say so, so nobody counts it as texted.
  simulated: { label: "Simulated (not sent)", tone: "amber" },
};

/**
 * The texts the app sent (listOutbox() in the loader), with their delivery and
 * replies. Pass `simulate` (admins, test mode) to answer test texts in place.
 */
export function Outbox({ rows, simulate = false, empty = "No texts yet." }: { rows: OutboxItem[]; simulate?: boolean; empty?: string }) {
  if (!rows.length) return <p className="text-sm text-gray-500 dark:text-gray-400">{empty}</p>;
  return (
    <ul className="divide-y divide-gray-200 text-sm dark:divide-gray-800">
      {rows.map((row) => {
        const s = STATUS[row.status];
        return (
          <li key={row.id} className="space-y-1 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{row.toNumber}</span>
              <Badge tone={s.tone}>{s.label}</Badge>
              <span className="text-xs text-gray-500">
                <LocalTime value={new Date(row.createdAt).toISOString()} options={{ dateStyle: "medium", timeStyle: "short" }} />
              </span>
            </div>
            <p className="whitespace-pre-wrap text-gray-700 dark:text-gray-300">{row.body}</p>
            {row.error && <p className="text-xs text-red-700 dark:text-red-300">{row.error}</p>}
            {row.repliedAt ? (
              <p className="text-gray-700 dark:text-gray-300">
                Reply: <Badge tone="green">{row.replyKeyword}</Badge> {row.replyBody !== row.replyKeyword && <span>“{row.replyBody}”</span>}
              </p>
            ) : (
              row.expects && <p className="text-xs text-gray-500">{`Waiting for a reply (${row.expects.join(" / ")})`}</p>
            )}
            {simulate && <SimulatedReply row={row} />}
          </li>
        );
      })}
    </ul>
  );
}
