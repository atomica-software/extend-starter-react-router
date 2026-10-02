/**
 * Text messages (app/lib/messaging.server.ts): what was sent, and what came back.
 * Exported from app/db/schema.ts. Keep these tables as they are: the helper
 * writes them. Your app's own tables point at them (e.g. an outbox id).
 */
import { sql } from "drizzle-orm";
import { bigint, bigserial, check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** One text the app sent, or would have sent in test mode, and the reply it got. */
export const smsOutbox = pgTable(
  "sms_outbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** "test": recorded only (status "simulated"); "live": sent through Twilio. */
    mode: text("mode").$type<"test" | "live">().notNull(),
    /** What the text is about, e.g. { kind: "shift", id: "42" }: your app's record. */
    threadKind: text("thread_kind").notNull(),
    threadId: text("thread_id").notNull(),
    contactId: text("contact_id"),
    /** E.164, e.g. +447700900123. */
    toNumber: text("to_number").notNull(),
    body: text("body").notNull(),
    status: text("status").$type<SmsStatus>().notNull(),
    /** Twilio's message SID (SM…), once sent. */
    providerSid: text("provider_sid"),
    error: text("error"),
    /** Reply keywords this text asks for (e.g. ["YES", "NO"]); null when it expects no reply. */
    expects: text("expects").array(),
    replyBody: text("reply_body"),
    replyKeyword: text("reply_keyword"),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("sms_outbox_provider_sid_key").on(t.providerSid),
    index("sms_outbox_thread_idx").on(t.threadKind, t.threadId),
    index("sms_outbox_open_idx").on(t.toNumber).where(sql`${t.expects} IS NOT NULL AND ${t.repliedAt} IS NULL`),
    check("sms_outbox_mode_check", sql`${t.mode} IN ('test', 'live')`),
  ],
);

/** Every text that came in (or was simulated), and which sent text it answered, if any. */
export const smsInbox = pgTable(
  "sms_inbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    mode: text("mode").$type<"test" | "live">().notNull(),
    fromNumber: text("from_number").notNull(),
    body: text("body").notNull(),
    /** The reply as a keyword (e.g. "YES"), when it is one the text it answered expects. */
    keyword: text("keyword"),
    /** The sent text it answered ("matched"), or that was open for it but didn't get a keyword it expects ("unrecognised"). */
    outboxId: bigint("outbox_id", { mode: "number" }).references(() => smsOutbox.id, { onDelete: "set null" }),
    /** matched | unrecognised | unmatched (no open text to that number) | ambiguous (several open threads). */
    status: text("status").$type<SmsInboxStatus>().notNull(),
    providerSid: text("provider_sid"),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("sms_inbox_provider_sid_key").on(t.providerSid)],
);

export type SmsStatus = "queued" | "sent" | "delivered" | "undelivered" | "failed" | "simulated";
export type SmsInboxStatus = "matched" | "unrecognised" | "unmatched" | "ambiguous";
export type OutboxRow = typeof smsOutbox.$inferSelect;
export type InboxRow = typeof smsInbox.$inferSelect;
