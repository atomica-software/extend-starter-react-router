// Resource route: POST /_app/log ← batches from the browser reporter (app/lib/extend-log.client.ts).
// Writes each record as an `[extend-log]` line with source "client". Always answers 204 for
// well-formed batches; it never needs the viewer's identity. Records posted by a page the
// Builder loaded (extend-screenshot's browser, which signs X-Extend-Builder) are its own test
// traffic: origin "builder".
import { MAX_BODY_BYTES, parseBatch } from "~/lib/client-log.server";
import { isBuilderRequest } from "~/lib/extend-origin.server";
import { writeRecord } from "~/lib/log.server";

import type { Route } from "./+types/_app.log";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const len = Number(request.headers.get("content-length") ?? "0");
  if (len > MAX_BODY_BYTES) return Response.json({ error: "body too large" }, { status: 413 });
  const result = parseBatch(await request.text());
  if (typeof result === "string") return Response.json({ error: result }, { status: 400 });
  const builder = isBuilderRequest(request.headers);
  for (const rec of result) writeRecord(builder ? { ...rec, origin: "builder" } : rec);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
