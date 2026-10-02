// POST /_app/sms/simulate ← <SimulatedReply>: an admin answers a test-mode text
// as its recipient would. Only in test mode; never sends anything.
import { redirect } from "react-router";

import { messagingMode, simulateReply } from "~/lib/messaging.server";
import { isAdmin, requireViewer } from "~/lib/viewer.server";

import type { Route } from "./+types/_app.sms.simulate";

export async function action({ request }: Route.ActionArgs) {
  const viewer = requireViewer(request);
  if (!isAdmin(viewer)) return new Response("Only admins can simulate replies", { status: 403 });
  if (messagingMode() !== "test") return new Response("Simulated replies are for test mode only", { status: 409 });
  const form = await request.formData();
  const outboxId = Number(form.get("outboxId"));
  const body = String(form.get("body") ?? "").trim();
  if (!Number.isInteger(outboxId) || outboxId <= 0 || !body) return new Response("outboxId and body are required", { status: 422 });
  await simulateReply(outboxId, body);
  const back = String(form.get("redirectTo") ?? "/");
  return redirect(back.startsWith("/") && !back.startsWith("//") ? back : "/");
}
