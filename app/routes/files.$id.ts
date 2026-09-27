/**
 * /files/<id>: shows (or with ?download=1, downloads) an uploaded file. Use it
 * wherever a file appears, e.g. <img src={`/files/${id}`} />. It checks the
 * viewer is signed in to the app, then redirects to a link valid for an hour,
 * so links in pages never expire and never leave the app.
 *
 * To limit a file to some viewers (e.g. its uploader), look up the file id in
 * your own table here and check before redirecting.
 */
import { data, redirect } from "react-router";
import { FilesError, getFile } from "~/lib/files.server";
import { requireViewer } from "~/lib/viewer.server";
import type { Route } from "./+types/files.$id";

export async function loader({ request, params }: Route.LoaderArgs) {
  requireViewer(request);
  const download = new URL(request.url).searchParams.get("download") === "1";
  try {
    const { file, url } = await getFile(params.id, { url: download ? "download" : "inline" });
    if (file.status !== "ready" || !url) {
      return data(
        { error: file.status === "rejected" ? "rejected" : "not_ready", message: file.rejected_reason ?? "This file isn't ready yet." },
        file.status === "rejected" ? 410 : 409,
      );
    }
    return redirect(url, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (e) {
    if (e instanceof FilesError) return data({ error: e.code, message: e.message }, e.status === 404 ? 404 : e.status);
    throw e;
  }
}
