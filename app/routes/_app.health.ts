// Resource route (no default export): GET /_app/health → {"status":"ok"}
export function loader() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
