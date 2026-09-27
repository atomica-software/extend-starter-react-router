/**
 * Starts uploads for the browser (FileUpload posts here), and reports a
 * file's status while it's checked. Signed-in viewers only.
 */
import { data } from "react-router";
import { createUpload, FilesError, getFile } from "~/lib/files.server";
import { requireViewer } from "~/lib/viewer.server";
import type { Route } from "./+types/_app.uploads";

export async function action({ request }: Route.ActionArgs) {
  const viewer = requireViewer(request);
  const body = (await request.json().catch(() => null)) as { name?: unknown; content_type?: unknown; size_bytes?: unknown } | null;
  if (!body || typeof body.name !== "string" || typeof body.content_type !== "string" || typeof body.size_bytes !== "number") {
    return data({ error: "invalid_request", message: "name, content_type and size_bytes are required" }, 422);
  }
  try {
    return await createUpload({ name: body.name, contentType: body.content_type, size: body.size_bytes, viewer });
  } catch (e) {
    if (e instanceof FilesError) return data({ error: e.code, message: e.message }, e.status);
    throw e;
  }
}

export async function loader({ request }: Route.LoaderArgs) {
  requireViewer(request);
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return data({ error: "invalid_request", message: "id is required" }, 422);
  try {
    return await getFile(id);
  } catch (e) {
    if (e instanceof FilesError) return data({ error: e.code, message: e.message }, e.status);
    throw e;
  }
}
