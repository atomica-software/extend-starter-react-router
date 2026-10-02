import { type RouteConfig, index, route } from "@react-router/dev/routes";

// Explicit route config. `/` (index) is the app's main screen: build the app in
// routes/_index.tsx, replacing the starter's demo page. Add further pages only when
// the app needs them, each linked from it, e.g.
//   route("requests/:id", "routes/requests.$id.tsx"),
export default [
  index("routes/_index.tsx"),
  // Health check used by the Extend app runner (manifest "health").
  route("_app/health", "routes/_app.health.ts"),
  // Browser error reports (app/lib/extend-log.client.ts → the Extend app log).
  route("_app/log", "routes/_app.log.ts"),
  // Uploads (app/components/ui/FileUpload.tsx posts here) and serving files (app/lib/files.server.ts).
  route("_app/uploads", "routes/_app.uploads.ts"),
  route("files/:id", "routes/files.$id.ts"),
  // Text messages (app/lib/messaging.server.ts): Twilio's webhook, and test-mode replies.
  route("_hooks/twilio-sms", "routes/_hooks.twilio-sms.ts"),
  route("_app/sms/simulate", "routes/_app.sms.simulate.ts"),
] satisfies RouteConfig;
