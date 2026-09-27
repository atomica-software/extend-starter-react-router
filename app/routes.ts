import { type RouteConfig, index, route } from "@react-router/dev/routes";

// Explicit route config: add new pages here, e.g.
//   route("contacts/:addressBook", "routes/contacts.tsx"),
export default [
  index("routes/_index.tsx"),
  // Health check used by the Extend app runner (manifest "health").
  route("_app/health", "routes/_app.health.ts"),
  // Browser error reports (app/lib/extend-log.client.ts → the Extend app log).
  route("_app/log", "routes/_app.log.ts"),
  // Uploads (app/components/ui/FileUpload.tsx posts here) and serving files (app/lib/files.server.ts).
  route("_app/uploads", "routes/_app.uploads.ts"),
  route("files/:id", "routes/files.$id.ts"),
] satisfies RouteConfig;
