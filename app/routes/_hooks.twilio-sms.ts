// Webhook: POST /_hooks/twilio-sms ← Twilio, through Extend (extend.json:
// {"webhooks": [{"name": "twilio-sms", "path": "/_hooks/twilio-sms"}]}).
// Twilio posts here for replies to the app's texts (they have a Body) and for
// delivery reports (they don't). Both are recorded by app/lib/messaging.server.ts;
// react to a reply where marked below.
import { verifyExtendCall, verifyTwilioSignature } from "~/lib/extend-jobs.server";
import { log } from "~/lib/log.server";
import { emptyTwiml, handleInboundSms, handleSmsStatus, messagingMode } from "~/lib/messaging.server";

import type { Route } from "./+types/_hooks.twilio-sms";

export async function action({ request }: Route.ActionArgs) {
  const call = await verifyExtendCall(request);
  if (!call) return new Response("Forbidden", { status: 403 });
  const form = new URLSearchParams(call.body);

  // Twilio's own signature (TWILIO_AUTH_TOKEN, over the webhook's public URL). Live it's
  // required. In test mode an unsigned test delivery (extend-webhook send) is let through;
  // it can only answer simulated texts.
  if (!verifyTwilioSignature(request, call) && (messagingMode() === "live" || request.headers.has("x-twilio-signature"))) {
    log.warn("Twilio webhook refused: no valid Twilio signature");
    return new Response("Forbidden", { status: 403 });
  }

  if (form.has("Body")) {
    const { row, keyword } = await handleInboundSms(form);
    if (row && keyword) {
      // A reply to one of the app's texts: row.threadKind/threadId say what it was about,
      // keyword is one it expected (e.g. "YES"). Update the app's own records here.
    }
  } else {
    await handleSmsStatus(form);
  }
  return emptyTwiml();
}
