// The outbox on real Postgres, through the template's own migration: only with
// TEST_DATABASE_URL (a throwaway database; CI has one). Its sms_* tables are dropped
// and recreated.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const URL_ = process.env.TEST_DATABASE_URL;

describe.skipIf(!URL_)("messaging on Postgres", () => {
  let sql: postgres.Sql;
  let m: typeof import("../app/lib/messaging.server");

  beforeAll(async () => {
    sql = postgres(URL_!, { max: 1, onnotice: () => {} });
    await sql.unsafe("DROP TABLE IF EXISTS sms_inbox, sms_outbox CASCADE");
    const migration = readFileSync(join(__dirname, "../app/db/migrations/0001_messaging.sql"), "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) await sql.unsafe(statement);
    vi.stubEnv("DATABASE_URL", URL_!);
    m = await import("../app/lib/messaging.server");
    m.setMessagingStore(null);
  });

  beforeEach(async () => {
    await sql`TRUNCATE sms_inbox, sms_outbox RESTART IDENTITY`;
    vi.stubEnv("EXTEND_ENV", "preview");
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await sql?.end();
  });

  it("records, matches a reply once, and keeps threads apart", async () => {
    const thread = { kind: "shift", id: 7 };
    const row = await m.sendSms({ to: "+447700900513", body: "Cover Saturday? YES or NO", thread, contactId: "c-1", expects: ["YES", "NO"] });
    expect(row).toMatchObject({ mode: "test", status: "simulated", expects: ["YES", "NO"], toNumber: "+447700900513" });
    expect(await m.sentBefore(thread, "+44 7700 900513")).toBe(true);
    expect(await m.sentBefore({ kind: "shift", id: 8 }, "+447700900513")).toBe(false);

    const r = await m.simulateReply(row.id, "yes");
    expect(r.row).toMatchObject({ id: row.id, replyKeyword: "YES" });
    expect(r.row?.repliedAt).toBeInstanceOf(Date);
    // Answered: the same reply again matches nothing.
    expect((await m.simulateReply(row.id, "yes")).inbound.status).toBe("unmatched");
    expect((await m.listInbox()).map((i) => i.status)).toEqual(["unmatched", "matched"]);
    expect((await m.listOutbox({ thread })).map((o) => o.id)).toEqual([row.id]);
  });

  it("refuses to guess between two open threads, and records a Twilio retry once", async () => {
    await m.sendSms({ to: "+447700900513", body: "A", thread: { kind: "o", id: 1 }, expects: ["ACK"] });
    await m.sendSms({ to: "+447700900513", body: "B", thread: { kind: "o", id: 2 }, expects: ["ACK"] });
    const form = m.twilioInboundForm({ from: "+447700900513", body: "ACK", sid: "SMretry" });
    const first = await m.handleInboundSms(form, { mode: "test" });
    expect(first.inbound.status).toBe("ambiguous");
    const again = await m.handleInboundSms(form, { mode: "test" });
    expect(again.inbound.id).toBe(first.inbound.id);
    expect(await sql`SELECT count(*)::int AS n FROM sms_inbox`).toEqual([{ n: 1 }]);
  });

  it("follows Twilio's delivery reports", async () => {
    await sql`INSERT INTO sms_outbox (mode, thread_kind, thread_id, to_number, body, status, provider_sid) VALUES ('live', 't', '1', '+447700900513', 'Hi', 'sent', 'SMpg')`;
    const delivered = await m.handleSmsStatus(new URLSearchParams({ MessageSid: "SMpg", MessageStatus: "delivered" }));
    expect(delivered).toMatchObject({ status: "delivered" });
    expect(m.countsAsSent(delivered!, "live")).toBe(true);
  });
});
