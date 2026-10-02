import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extendSignature, twilioSignature } from "../app/lib/extend-jobs.server";
import {
  countsAsSent,
  emptyTwiml,
  handleInboundSms,
  handleSmsStatus,
  keywordOf,
  memoryMessagingStore,
  messagingMode,
  sendSms,
  sentBefore,
  setMessagingStore,
  simulateReply,
} from "../app/lib/messaging.server";
import { action as twilioHook } from "../app/routes/_hooks.twilio-sms";

// Captured from Twilio (numbers and SIDs replaced): an incoming text, and a delivery report.
const INBOUND = "ToCountry=GB&ToState=&SmsMessageSid=SM2f0c6b8e5a1d4c3b9e7f6a5d4c3b2a10&NumMedia=0&ToCity=&FromZip=&SmsSid=SM2f0c6b8e5a1d4c3b9e7f6a5d4c3b2a10&FromState=&SmsStatus=received&FromCity=&Body=Ack&FromCountry=GB&To=%2B447700900000&ToZip=&NumSegments=1&MessageSid=SM2f0c6b8e5a1d4c3b9e7f6a5d4c3b2a10&AccountSid=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx&From=%2B447700900513&ApiVersion=2010-04-01";
const STATUS = (sid: string, status: string, extra = "") =>
  `SmsSid=${sid}&SmsStatus=${status}&MessageStatus=${status}&To=%2B447700900513&MessageSid=${sid}&AccountSid=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx&From=%2B447700900000&ApiVersion=2010-04-01${extra}`;

const TWILIO = {
  TWILIO_ACCOUNT_SID: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  TWILIO_AUTH_TOKEN: "twilio-token",
  TWILIO_FROM_NUMBER: "+447700900000",
};

let store: ReturnType<typeof memoryMessagingStore>;
const fetchMock = vi.fn<typeof fetch>();

function env(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v ?? "");
}

/** Twilio's answer to a send. */
function twilioAccepts(sid = "SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
  fetchMock.mockResolvedValueOnce(Response.json({ sid, status: "queued" }, { status: 201 }));
}

beforeEach(() => {
  store = memoryMessagingStore();
  setMessagingStore(store);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  env({ EXTEND_ENV: "preview", PREVIEW_SEND_REAL: undefined, TWILIO_ACCOUNT_SID: undefined, TWILIO_AUTH_TOKEN: undefined, TWILIO_FROM_NUMBER: undefined, EXTEND_WEBHOOK_URL_TWILIO_SMS: undefined });
});

afterEach(() => {
  setMessagingStore(null);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("messagingMode", () => {
  it("is live only with Twilio's secrets, on Live or on Preview with PREVIEW_SEND_REAL=1", () => {
    expect(messagingMode()).toBe("test");
    env(TWILIO);
    // Preview with the secrets set still never texts anyone (#44).
    expect(messagingMode()).toBe("test");
    env({ PREVIEW_SEND_REAL: "1" });
    expect(messagingMode()).toBe("live");
    env({ PREVIEW_SEND_REAL: undefined, EXTEND_ENV: "live" });
    expect(messagingMode()).toBe("live");
    env({ TWILIO_FROM_NUMBER: undefined });
    expect(messagingMode()).toBe("test");
    env({ ...TWILIO, EXTEND_ENV: undefined });
    expect(messagingMode()).toBe("test");
  });
});

describe("sendSms", () => {
  it("records a simulated text in test mode and sends nothing", async () => {
    const row = await sendSms({ to: "+44 7700 900513", body: "Can you cover?", thread: { kind: "shift", id: 7 }, contactId: "c-1", expects: ["yes", "No"] });
    expect(row).toMatchObject({ mode: "test", status: "simulated", toNumber: "+447700900513", threadKind: "shift", threadId: "7", contactId: "c-1", expects: ["YES", "NO"] });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(countsAsSent(row)).toBe(true);
  });

  it("sends through Twilio when live, with the status callback", async () => {
    env({ ...TWILIO, EXTEND_ENV: "live", EXTEND_WEBHOOK_URL_TWILIO_SMS: "https://hooks.example/live/twilio-sms/tok" });
    twilioAccepts("SM11111111111111111111111111111111");
    const row = await sendSms({ to: "+447700900513", body: "Hi", thread: { kind: "shift", id: "7" } });
    expect(row).toMatchObject({ mode: "live", status: "sent", providerSid: "SM11111111111111111111111111111111", error: null });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO.TWILIO_ACCOUNT_SID}/Messages.json`);
    const form = init!.body as URLSearchParams;
    expect(Object.fromEntries(form)).toEqual({ To: "+447700900513", From: "+447700900000", Body: "Hi", StatusCallback: "https://hooks.example/live/twilio-sms/tok" });
    expect((init!.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from(`${TWILIO.TWILIO_ACCOUNT_SID}:twilio-token`).toString("base64")}`);
  });

  it("records a failed send instead of throwing, and it doesn't count as sent", async () => {
    env({ ...TWILIO, EXTEND_ENV: "live" });
    fetchMock.mockResolvedValueOnce(Response.json({ code: 21211, message: "The 'To' number is not a valid phone number." }, { status: 400 }));
    const bad = await sendSms({ to: "+447700900513", body: "Hi", thread: { kind: "shift", id: 1 } });
    expect(bad).toMatchObject({ status: "failed", error: "Twilio 400 (21211): The 'To' number is not a valid phone number." });
    expect(countsAsSent(bad)).toBe(false);
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const down = await sendSms({ to: "+447700900513", body: "Hi", thread: { kind: "shift", id: 2 } });
    expect(down).toMatchObject({ status: "failed", error: "Couldn't reach Twilio: fetch failed" });
    // Recorded before sending: both are in the outbox.
    expect(store.outbox).toHaveLength(2);
  });

  it("refuses a national number without calling Twilio", async () => {
    env({ ...TWILIO, EXTEND_ENV: "live" });
    const row = await sendSms({ to: "07700 900513", body: "Hi", thread: { kind: "shift", id: 1 } });
    expect(row.status).toBe("failed");
    expect(row.error).toContain("E.164");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends for real after going live what test mode only simulated", async () => {
    const thread = { kind: "reminder", id: "doc-9:stage-1" };
    await sendSms({ to: "+447700900513", body: "Your certificate expires soon", thread });
    expect(await sentBefore(thread, "+447700900513")).toBe(true);

    env({ ...TWILIO, EXTEND_ENV: "live" });
    // The simulated text doesn't count any more, so the job sends it.
    expect(await sentBefore(thread, "+447700900513")).toBe(false);
    twilioAccepts();
    await sendSms({ to: "+447700900513", body: "Your certificate expires soon", thread });
    expect(await sentBefore(thread, "+447700900513")).toBe(true);
    // A delivered text counts too, and a failed one never.
    expect(countsAsSent({ mode: "live", status: "delivered" })).toBe(true);
    expect(countsAsSent({ mode: "live", status: "failed" })).toBe(false);
  });
});

describe("replies", () => {
  async function liveText(to: string, thread: { kind: string; id: string }, expects = ["ACK"], sid = `SM${String(store.outbox.length).padStart(32, "0")}`) {
    env({ ...TWILIO, EXTEND_ENV: "live" });
    twilioAccepts(sid);
    return sendSms({ to, body: "Outage at the depot: reply ACK", thread, expects });
  }

  it("records a captured Twilio reply (SmsStatus=received) against the open text", async () => {
    const sent = await liveText("+447700900513", { kind: "outage", id: "o-1" });
    const r = await handleInboundSms(new URLSearchParams(INBOUND));
    expect(r.keyword).toBe("ACK");
    expect(r.text).toBe("Ack");
    expect(r.row).toMatchObject({ id: sent.id, replyKeyword: "ACK", replyBody: "Ack" });
    expect(r.row?.repliedAt).toBeInstanceOf(Date);
    expect(r.inbound).toMatchObject({ status: "matched", outboxId: sent.id, fromNumber: "+447700900513", mode: "live" });
    // Twilio retries: the same MessageSid is recorded once.
    const again = await handleInboundSms(new URLSearchParams(INBOUND));
    expect(again.inbound.id).toBe(r.inbound.id);
    expect(store.inbox).toHaveLength(1);
  });

  it("takes only an exact keyword: a sentence starting with No isn't NO", async () => {
    const sent = await liveText("+447700900513", { kind: "callout", id: "c-1" }, ["YES", "NO"]);
    const sentence = new URLSearchParams(INBOUND);
    sentence.set("Body", "No problem, on my way");
    sentence.set("MessageSid", "SM3");
    const r = await handleInboundSms(sentence);
    expect(r).toMatchObject({ row: null, keyword: null });
    expect(r.inbound).toMatchObject({ status: "unrecognised", outboxId: sent.id });
    const yes = new URLSearchParams(INBOUND);
    yes.set("Body", " yes! ");
    yes.set("MessageSid", "SM4");
    expect((await handleInboundSms(yes)).row).toMatchObject({ id: sent.id, replyKeyword: "YES" });
    // Answered: a later text from the number matches nothing.
    const late = new URLSearchParams(INBOUND);
    late.set("Body", "NO");
    late.set("MessageSid", "SM5");
    expect((await handleInboundSms(late)).inbound.status).toBe("unmatched");
  });

  it("records an unexpected word as unrecognised and leaves the text open", async () => {
    const sent = await liveText("+447700900513", { kind: "callout", id: "c-2" }, ["YES", "NO"]);
    const form = new URLSearchParams(INBOUND);
    form.set("Body", "Who is this?");
    const r = await handleInboundSms(form);
    expect(r).toMatchObject({ row: null, keyword: null });
    expect(r.inbound).toMatchObject({ status: "unrecognised", outboxId: sent.id });
    expect(store.outbox.find((x) => x.id === sent.id)?.repliedAt).toBeNull();
  });

  it("doesn't guess between several open threads to the same number", async () => {
    await liveText("+447700900513", { kind: "outage", id: "o-1" });
    await liveText("+447700900513", { kind: "outage", id: "o-2" });
    const r = await handleInboundSms(new URLSearchParams(INBOUND));
    expect(r.row).toBeNull();
    expect(r.inbound.status).toBe("ambiguous");
    expect(store.outbox.every((x) => x.repliedAt === null)).toBe(true);
  });

  it("matches test-mode texts only to simulated replies, never to real ones", async () => {
    const row = await sendSms({ to: "+447700900513", body: "Reply ACK", thread: { kind: "outage", id: "o-1" }, expects: ["ACK"] });
    expect((await handleInboundSms(new URLSearchParams(INBOUND), { mode: "live" })).inbound.status).toBe("unmatched");
    const r = await simulateReply(row.id, "ack");
    expect(r.row).toMatchObject({ id: row.id, replyKeyword: "ACK" });
    expect(r.inbound).toMatchObject({ mode: "test", status: "matched", fromNumber: "+447700900513" });
  });

  it("refuses simulated replies once live", async () => {
    const row = await sendSms({ to: "+447700900513", body: "Reply ACK", thread: { kind: "o", id: "1" }, expects: ["ACK"] });
    env({ ...TWILIO, EXTEND_ENV: "live" });
    await expect(simulateReply(row.id, "ACK")).rejects.toThrow(/test mode only/);
  });

  it("reads keywords", () => {
    expect(keywordOf(" yes! ")).toBe("YES");
    expect(keywordOf("Y")).toBe("Y");
    expect(keywordOf("No problem,  on my way")).toBe("NO PROBLEM ON MY WAY");
    expect(keywordOf("")).toBe("");
  });
});

describe("delivery reports", () => {
  it("updates the status from Twilio's callback, never backwards", async () => {
    env({ ...TWILIO, EXTEND_ENV: "live" });
    twilioAccepts("SM22222222222222222222222222222222");
    const row = await sendSms({ to: "+447700900513", body: "Hi", thread: { kind: "t", id: 1 } });
    expect((await handleSmsStatus(new URLSearchParams(STATUS("SM22222222222222222222222222222222", "delivered"))))?.status).toBe("delivered");
    // A late "sent" doesn't undo "delivered".
    expect((await handleSmsStatus(new URLSearchParams(STATUS("SM22222222222222222222222222222222", "sent"))))?.status).toBe("delivered");
    expect(store.outbox.find((x) => x.id === row.id)?.status).toBe("delivered");
    expect(await handleSmsStatus(new URLSearchParams(STATUS("SMunknown", "delivered")))).toBeNull();
  });

  it("records an undelivered text with Twilio's error code", async () => {
    env({ ...TWILIO, EXTEND_ENV: "live" });
    twilioAccepts("SM33333333333333333333333333333333");
    await sendSms({ to: "+447700900513", body: "Hi", thread: { kind: "t", id: 1 } });
    const row = await handleSmsStatus(new URLSearchParams(STATUS("SM33333333333333333333333333333333", "undelivered", "&ErrorCode=30003")));
    expect(row).toMatchObject({ status: "undelivered", error: "Twilio error 30003" });
    expect(countsAsSent(row!)).toBe(false);
  });
});

describe("the twilio-sms webhook route", () => {
  const SECRET = "jobs-secret";
  let n = 0;
  const PUBLIC_URL = "https://hooks.abc.extend.example/live/twilio-sms/tok123";
  function delivery(body: string, headers: Record<string, string> = {}) {
    const nonce = `nonce-${String(++n).padStart(16, "0")}`;
    const ts = String(Math.floor(Date.now() / 1000));
    const signature = extendSignature(SECRET, { method: "POST", pathWithQuery: "/_hooks/twilio-sms", target: "webhook:twilio-sms", timestamp: ts, nonce, body });
    const request = new Request("http://app/_hooks/twilio-sms", {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded", "x-extend-timestamp": ts, "x-extend-nonce": nonce, "x-extend-signature-v2": signature, "x-extend-webhook": "twilio-sms", "x-extend-webhook-url": PUBLIC_URL, ...headers },
    });
    return twilioHook({ request, params: {}, context: {} } as unknown as Parameters<typeof twilioHook>[0]) as Promise<Response>;
  }

  beforeEach(() => env({ EXTEND_JOBS_SECRET: SECRET }));

  it("refuses a call Extend didn't sign", async () => {
    const res = (await twilioHook({ request: new Request("http://app/_hooks/twilio-sms", { method: "POST", body: INBOUND }), params: {}, context: {} } as unknown as Parameters<typeof twilioHook>[0])) as Response;
    expect(res.status).toBe(403);
  });

  it("records a reply and a delivery report, answering fresh empty TwiML each time", async () => {
    const row = await sendSms({ to: "+447700900513", body: "Reply ACK", thread: { kind: "outage", id: "o-1" }, expects: ["ACK"] });
    // In test mode, extend-webhook send --sample twilio-inbound reaches the test texts.
    const first = await delivery(INBOUND);
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("text/xml");
    expect(await first.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    expect(store.outbox.find((x) => x.id === row.id)?.replyKeyword).toBe("ACK");
    const second = await delivery(STATUS("SMnone", "delivered"));
    expect(await second.text()).toContain("<Response></Response>");
    expect(await emptyTwiml().text()).toContain("<Response>");
  });

  it("live, needs Twilio's signature over the webhook's public URL", async () => {
    env({ ...TWILIO, EXTEND_ENV: "live" });
    expect((await delivery(INBOUND)).status).toBe(403);
    expect((await delivery(INBOUND, { "x-twilio-signature": "wrong" })).status).toBe(403);
    const good = twilioSignature("twilio-token", PUBLIC_URL, new URLSearchParams(INBOUND));
    expect((await delivery(INBOUND, { "x-twilio-signature": good })).status).toBe(200);
  });

  it("in test mode, refuses a bad Twilio signature but lets an unsigned test delivery through", async () => {
    expect((await delivery(INBOUND, { "x-twilio-signature": "wrong" })).status).toBe(403);
    expect((await delivery(INBOUND)).status).toBe(200);
  });
});
