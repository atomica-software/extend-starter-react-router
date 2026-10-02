/**
 * Text messages (SMS) through Twilio, with an outbox: every text is recorded
 * before it's sent, replies are matched to the text they answer, and nothing
 * is really sent until the app is live.
 *
 * ```ts
 * import { sendSms, countsAsSent, sentBefore } from "~/lib/messaging.server";
 *
 * const to = await contactMobileE164(viewer, contact);          // ~/lib/cz.server
 * if (to && !(await sentBefore({ kind: "shift", id: shift.id }, to))) {
 *   const row = await sendSms({ to, body: "Can you cover Saturday? Reply YES or NO", thread: { kind: "shift", id: shift.id }, contactId: contact.id, expects: ["YES", "NO"] });
 *   if (!countsAsSent(row)) log.warn("Text not sent", { outbox: row.id, error: row.error });
 * }
 * ```
 *
 * Replies and delivery reports reach app/routes/_hooks.twilio-sms.ts (the
 * `twilio-sms` webhook in extend.json), which records them; handle a reply there.
 *
 * Modes (messagingMode()):
 * - **test**: nothing leaves the app. Texts are recorded as "simulated", and
 *   simulateReply() (or <SimulatedReply>) stands in for a person answering.
 * - **live**: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER are set
 *   (App secrets, Settings › Env) AND this is Live (EXTEND_ENV=live), or
 *   Preview with PREVIEW_SEND_REAL=1. Preview never texts real people otherwise,
 *   even with the secrets set.
 *
 * Replies and delivery reports both arrive at the `twilio-sms` webhook; sendSms
 * passes its URL (EXTEND_WEBHOOK_URL_TWILIO_SMS, from Extend) as StatusCallback.
 */
import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull, isNotNull, sql } from "drizzle-orm";

import { getDb } from "../db/client.server";
import { smsInbox, smsOutbox, type InboxRow, type OutboxRow, type SmsStatus } from "../db/messaging-schema";
import { normalisePhone } from "./contacts";
import { log } from "./log.server";

export type { InboxRow, OutboxRow, SmsStatus } from "../db/messaging-schema";
export type MessagingMode = "test" | "live";

/** What a text is about: your app's record, e.g. { kind: "shift", id: "42" }. */
export interface Thread {
  kind: string;
  id: string | number;
}

export function messagingMode(): MessagingMode {
  const e = process.env;
  const configured = Boolean(e.TWILIO_ACCOUNT_SID && e.TWILIO_AUTH_TOKEN && e.TWILIO_FROM_NUMBER);
  const allowed = e.EXTEND_ENV === "live" || (e.EXTEND_ENV === "preview" && e.PREVIEW_SEND_REAL === "1");
  return configured && allowed ? "live" : "test";
}

/**
 * Whether a text counts as sent in the current mode. In test mode simulated
 * texts count; once live only real ones do, so everything test mode "sent" is
 * sent for real after the switch.
 */
export function countsAsSent(row: Pick<OutboxRow, "status" | "mode">, mode: MessagingMode = messagingMode()): boolean {
  if (row.status === "sent" || row.status === "delivered") return row.mode === "live";
  return mode === "test" && row.status === "simulated";
}

// ── storage ──────────────────────────────────────────────────────────────────

type NewOutbox = Omit<OutboxRow, "id" | "createdAt" | "updatedAt" | "providerSid" | "error" | "replyBody" | "replyKeyword" | "repliedAt">;
type NewInbox = Omit<InboxRow, "id" | "receivedAt">;

/** Where texts are kept: Postgres (the default), or memory in tests (memoryMessagingStore()). */
export interface MessagingStore {
  insertOutbox(row: NewOutbox): Promise<OutboxRow>;
  updateOutbox(id: number, patch: Partial<Pick<OutboxRow, "status" | "providerSid" | "error">>): Promise<OutboxRow | null>;
  getOutbox(id: number): Promise<OutboxRow | null>;
  outboxBySid(sid: string): Promise<OutboxRow | null>;
  listOutbox(filter: { thread?: Thread; to?: string; limit?: number }): Promise<OutboxRow[]>;
  /** Texts to `to` in `mode` that expect a reply and haven't had one. */
  openFor(mode: MessagingMode, to: string): Promise<OutboxRow[]>;
  /** Records the reply only if the text hasn't had one yet (null otherwise). */
  recordReply(id: number, reply: { body: string; keyword: string }): Promise<OutboxRow | null>;
  insertInbox(row: NewInbox): Promise<InboxRow>;
  inboxBySid(sid: string): Promise<InboxRow | null>;
  listInbox(filter: { limit?: number }): Promise<InboxRow[]>;
}

function postgresStore(): MessagingStore {
  const db = () => getDb();
  const one = <T>(rows: T[]) => rows[0] ?? null;
  return {
    insertOutbox: async (row) => one(await db().insert(smsOutbox).values(row).returning())!,
    updateOutbox: async (id, patch) =>
      one(await db().update(smsOutbox).set({ ...patch, updatedAt: new Date() }).where(eq(smsOutbox.id, id)).returning()),
    getOutbox: async (id) => one(await db().select().from(smsOutbox).where(eq(smsOutbox.id, id))),
    outboxBySid: async (sid) => one(await db().select().from(smsOutbox).where(eq(smsOutbox.providerSid, sid))),
    listOutbox: async ({ thread, to, limit = 100 }) =>
      db()
        .select()
        .from(smsOutbox)
        .where(
          and(
            thread ? and(eq(smsOutbox.threadKind, thread.kind), eq(smsOutbox.threadId, String(thread.id))) : undefined,
            to ? eq(smsOutbox.toNumber, to) : undefined,
          ),
        )
        .orderBy(desc(smsOutbox.id))
        .limit(limit),
    openFor: async (mode, to) =>
      db()
        .select()
        .from(smsOutbox)
        .where(
          and(
            eq(smsOutbox.mode, mode),
            eq(smsOutbox.toNumber, to),
            isNotNull(smsOutbox.expects),
            isNull(smsOutbox.repliedAt),
            sql`${smsOutbox.status} NOT IN ('failed', 'undelivered')`,
          ),
        )
        .orderBy(desc(smsOutbox.id)),
    recordReply: async (id, reply) =>
      one(
        await db()
          .update(smsOutbox)
          .set({ replyBody: reply.body, replyKeyword: reply.keyword, repliedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(smsOutbox.id, id), isNull(smsOutbox.repliedAt)))
          .returning(),
      ),
    insertInbox: async (row) => one(await db().insert(smsInbox).values(row).returning())!,
    inboxBySid: async (sid) => one(await db().select().from(smsInbox).where(eq(smsInbox.providerSid, sid))),
    listInbox: async ({ limit = 100 }) => db().select().from(smsInbox).orderBy(desc(smsInbox.id)).limit(limit),
  };
}

/** An in-memory store, for tests: `setMessagingStore(memoryMessagingStore())`. */
export function memoryMessagingStore(): MessagingStore & { outbox: OutboxRow[]; inbox: InboxRow[] } {
  const outbox: OutboxRow[] = [];
  const inbox: InboxRow[] = [];
  const copy = <T>(r: T | undefined) => (r ? { ...r } : null);
  return {
    outbox,
    inbox,
    async insertOutbox(row) {
      const now = new Date();
      const r: OutboxRow = { ...row, id: outbox.length + 1, providerSid: null, error: null, replyBody: null, replyKeyword: null, repliedAt: null, createdAt: now, updatedAt: now };
      outbox.push(r);
      return { ...r };
    },
    async updateOutbox(id, patch) {
      const r = outbox.find((x) => x.id === id);
      if (r) Object.assign(r, patch, { updatedAt: new Date() });
      return copy(r);
    },
    getOutbox: async (id) => copy(outbox.find((x) => x.id === id)),
    outboxBySid: async (sid) => copy(outbox.find((x) => x.providerSid === sid)),
    async listOutbox({ thread, to, limit = 100 }) {
      return outbox
        .filter((r) => (!thread || (r.threadKind === thread.kind && r.threadId === String(thread.id))) && (!to || r.toNumber === to))
        .reverse()
        .slice(0, limit)
        .map((r) => ({ ...r }));
    },
    async openFor(mode, to) {
      return outbox
        .filter((r) => r.mode === mode && r.toNumber === to && r.expects !== null && r.repliedAt === null && r.status !== "failed" && r.status !== "undelivered")
        .reverse()
        .map((r) => ({ ...r }));
    },
    async recordReply(id, reply) {
      const r = outbox.find((x) => x.id === id && x.repliedAt === null);
      if (!r) return null;
      Object.assign(r, { replyBody: reply.body, replyKeyword: reply.keyword, repliedAt: new Date(), updatedAt: new Date() });
      return { ...r };
    },
    async insertInbox(row) {
      const r: InboxRow = { ...row, id: inbox.length + 1, receivedAt: new Date() };
      inbox.push(r);
      return { ...r };
    },
    inboxBySid: async (sid) => copy(inbox.find((x) => x.providerSid === sid)),
    listInbox: async ({ limit = 100 }) => [...inbox].reverse().slice(0, limit).map((r) => ({ ...r })),
  };
}

let store: MessagingStore | null = null;
const st = () => (store ??= postgresStore());

/** Swap the store (tests); null goes back to Postgres. */
export function setMessagingStore(s: MessagingStore | null): void {
  store = s;
}

// ── sending ──────────────────────────────────────────────────────────────────

export interface SendSmsOptions {
  /** E.164 (from contactMobileE164()). */
  to: string;
  body: string;
  thread: Thread;
  contactId?: string;
  /** Reply keywords this text asks for, e.g. ["YES", "NO"]. Replies are matched to it only then. */
  expects?: string[];
}

/**
 * Records the text, then sends it (live) or marks it "simulated" (test).
 * Never throws for a failed send: the row says "failed", with the error.
 */
export async function sendSms(o: SendSmsOptions): Promise<OutboxRow> {
  const mode = messagingMode();
  const to = normalisePhone(o.to);
  const expects = o.expects?.length ? o.expects.map(keywordOf).filter(Boolean) : null;
  const row = await st().insertOutbox({
    mode,
    threadKind: o.thread.kind,
    threadId: String(o.thread.id),
    contactId: o.contactId ?? null,
    toNumber: to,
    body: o.body,
    status: "queued",
    expects,
  });
  if (!/^\+[1-9]\d{6,14}$/.test(to)) {
    return (await st().updateOutbox(row.id, { status: "failed", error: "Not an international (E.164) number; use contactMobileE164()." }))!;
  }
  if (mode === "test") return (await st().updateOutbox(row.id, { status: "simulated" }))!;

  const e = process.env;
  const form = new URLSearchParams({ To: to, From: e.TWILIO_FROM_NUMBER!, Body: o.body });
  // Delivery reports come to the same webhook as replies (Extend gives the app its URL).
  if (e.EXTEND_WEBHOOK_URL_TWILIO_SMS) form.set("StatusCallback", e.EXTEND_WEBHOOK_URL_TWILIO_SMS);
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(e.TWILIO_ACCOUNT_SID!)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${e.TWILIO_ACCOUNT_SID}:${e.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
    if (!res.ok || !data.sid) {
      const error = `Twilio ${res.status}${data.code ? ` (${data.code})` : ""}: ${data.message ?? "no message"}`;
      log.warn("SMS not sent", { outbox: row.id, status: res.status, code: data.code });
      return (await st().updateOutbox(row.id, { status: "failed", error }))!;
    }
    log.info("SMS sent", { outbox: row.id, thread: `${o.thread.kind}:${o.thread.id}` });
    return (await st().updateOutbox(row.id, { status: "sent", providerSid: data.sid }))!;
  } catch (error) {
    log.warn("SMS not sent", { outbox: row.id, error });
    return (await st().updateOutbox(row.id, { status: "failed", error: `Couldn't reach Twilio: ${error instanceof Error ? error.message : String(error)}` }))!;
  }
}

/** Whether `thread` already has a text to `to` that counts as sent in this mode (so don't send it again). */
export async function sentBefore(thread: Thread, to: string): Promise<boolean> {
  return (await st().listOutbox({ thread, to: normalisePhone(to) })).some((r) => countsAsSent(r));
}

/** The texts of a thread (or all of them), newest first: for <Outbox>. */
export function listOutbox(filter: { thread?: Thread; limit?: number } = {}): Promise<OutboxRow[]> {
  return st().listOutbox(filter);
}

/** Texts that came in, newest first, including ones that matched nothing (status unmatched / ambiguous): show these to an admin. */
export function listInbox(filter: { limit?: number } = {}): Promise<InboxRow[]> {
  return st().listInbox(filter);
}

// ── receiving ────────────────────────────────────────────────────────────────

/**
 * A reply as a keyword: the whole text, upper-cased, without punctuation or
 * extra spaces ("yes!" → "YES", "No problem, on my way" → "NO PROBLEM ON MY
 * WAY"). Only an exact match counts, so a sentence that happens to start with
 * "No" is never taken for NO; it's recorded as unrecognised for a person to read.
 */
export function keywordOf(text: string): string {
  return text.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().replace(/\s+/g, " ").toUpperCase();
}

export interface InboundResult {
  /** The sent text this reply answered, now with replyKeyword and repliedAt; null if none. */
  row: OutboxRow | null;
  inbound: InboxRow;
  /** The reply as a keyword, when it's one the text expects; else null. */
  keyword: string | null;
  text: string;
}

/**
 * Records an incoming text (Twilio's form fields: From, Body, MessageSid…) and
 * matches it to the one open text to that number that expects a reply, by
 * exact keyword (keywordOf). Several open threads for the number: recorded as "ambiguous"
 * for an admin, not guessed. A Twilio retry (same MessageSid) is recorded once.
 */
export async function handleInboundSms(form: URLSearchParams, options: { mode?: MessagingMode } = {}): Promise<InboundResult> {
  const mode = options.mode ?? messagingMode();
  const from = normalisePhone(form.get("From"));
  const text = (form.get("Body") ?? "").trim();
  const sid = form.get("MessageSid") || form.get("SmsMessageSid") || null;
  if (sid) {
    const seen = await st().inboxBySid(sid);
    if (seen) {
      const row = seen.outboxId !== null ? await st().getOutbox(seen.outboxId) : null;
      return { row: seen.status === "matched" ? row : null, inbound: seen, keyword: seen.status === "matched" ? seen.keyword : null, text: seen.body };
    }
  }
  const word = keywordOf(text);
  const open = await st().openFor(mode, from);
  const record = (status: InboxRow["status"], outboxId: number | null, keyword: string | null) =>
    st().insertInbox({ mode, fromNumber: from, body: text, keyword, outboxId, status, providerSid: sid });

  if (open.length > 1) {
    log.warn("SMS reply matches several open texts", { open: open.length });
    return { row: null, inbound: await record("ambiguous", null, null), keyword: null, text };
  }
  const candidate = open[0];
  if (!candidate) return { row: null, inbound: await record("unmatched", null, null), keyword: null, text };
  if (!candidate.expects?.includes(word)) {
    return { row: null, inbound: await record("unrecognised", candidate.id, null), keyword: null, text };
  }
  const row = await st().recordReply(candidate.id, { body: text, keyword: word });
  if (!row) return { row: null, inbound: await record("unmatched", candidate.id, null), keyword: null, text };
  log.info("SMS reply recorded", { outbox: row.id, keyword: word });
  return { row, inbound: await record("matched", row.id, word), keyword: word, text };
}

const STATUS_RANK: Record<SmsStatus, number> = { queued: 0, simulated: 0, sent: 1, delivered: 2, undelivered: 3, failed: 3 };

/**
 * A Twilio delivery report (MessageSid, MessageStatus, ErrorCode): updates the
 * text's status. Reports can arrive out of order, so a status never goes back.
 */
export async function handleSmsStatus(form: URLSearchParams): Promise<OutboxRow | null> {
  const sid = form.get("MessageSid") || form.get("SmsSid");
  const reported = (form.get("MessageStatus") || form.get("SmsStatus") || "").toLowerCase();
  if (!sid) return null;
  const row = await st().outboxBySid(sid);
  if (!row) return null;
  const status: SmsStatus | null =
    reported === "delivered" ? "delivered" : reported === "undelivered" ? "undelivered" : reported === "failed" ? "failed" : ["sent", "queued", "accepted", "sending"].includes(reported) ? "sent" : null;
  if (!status || STATUS_RANK[status] <= STATUS_RANK[row.status]) return row;
  const code = form.get("ErrorCode");
  return st().updateOutbox(row.id, { status, ...(code ? { error: `Twilio error ${code}` } : {}) });
}

/**
 * Test mode only: a reply from the text's recipient, as Twilio would deliver
 * it, through handleInboundSms(), so the app's reply handling is what's tested.
 */
export async function simulateReply(outboxId: number, body: string): Promise<InboundResult> {
  if (messagingMode() !== "test") throw new Error("simulateReply works in test mode only");
  const row = await st().getOutbox(outboxId);
  if (!row) throw new Error(`No text ${outboxId} in the outbox`);
  return handleInboundSms(twilioInboundForm({ from: row.toNumber, body }), { mode: "test" });
}

/** The form Twilio posts for an incoming text (the fields apps read; values like a real one). */
export function twilioInboundForm(o: { from: string; body: string; to?: string; sid?: string }): URLSearchParams {
  const sid = o.sid ?? `SM${randomBytes(16).toString("hex")}`;
  return new URLSearchParams({
    ToCountry: "GB",
    SmsMessageSid: sid,
    NumMedia: "0",
    SmsSid: sid,
    SmsStatus: "received",
    Body: o.body,
    To: o.to ?? process.env.TWILIO_FROM_NUMBER ?? "+447700900000",
    NumSegments: "1",
    MessageSid: sid,
    AccountSid: process.env.TWILIO_ACCOUNT_SID || "AC00000000000000000000000000000000",
    From: o.from,
    ApiVersion: "2010-04-01",
  });
}

/** An empty TwiML answer (no auto-reply). A new Response each time: a body can be read only once. */
export function emptyTwiml(): Response {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { headers: { "Content-Type": "text/xml" } });
}
