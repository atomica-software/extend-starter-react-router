/**
 * Files people upload through the app (images, PDFs…), kept in Contactzilla's
 * file storage, not on the server. Server-only.
 *
 *   const { file, upload } = await createUpload({ name, contentType, size, viewer });
 *   // …the browser posts the file to `upload` (FileUpload does this for you)
 *   const { file } = await getFile(id);                  // status: pending | ready | rejected
 *   const { url } = await getFile(id, { url: "inline" }); // a short-lived link, once ready
 *   await deleteFile(id);
 *
 * Every upload is scanned for malware and its real type checked before it's
 * `ready`; nothing can be read before then. Links expire after an hour: never
 * store them. Store the file id, and link to `/files/<id>` (the route in
 * app/routes/files.$id.ts), which checks the viewer and hands out a fresh link.
 */
import type { Viewer } from "./viewer.server";

export type FileStatus = "pending" | "ready" | "rejected";

export interface StoredFile {
  id: string;
  env: "preview" | "live";
  name: string;
  content_type: string;
  size_bytes: number;
  status: FileStatus;
  rejected_reason: string | null;
  uploaded_by_user_id: number | null;
  created_at: string;
}

/** A form for the browser to POST the file to (fields first, the file last). */
export interface UploadForm {
  method: "POST";
  url: string;
  fields: Record<string, string>;
  expires_at: string;
}

export class FilesError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function base(): string {
  const url = process.env.EXTEND_FILES_URL ?? process.env.EXTEND_CONNECT_URL?.replace(/\/_connect$/, "/_files");
  if (!url) throw new FilesError(503, "files_unavailable", "File uploads are only available when the app runs on Extend.");
  return url.replace(/\/$/, "");
}

function env(): "preview" | "live" {
  return process.env.EXTEND_ENV === "live" ? "live" : "preview";
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.EXTEND_FILES_TOKEN ?? ""}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string } & T;
  if (!res.ok) {
    throw new FilesError(res.status, json.error ?? "files_error", json.message ?? `File storage answered ${res.status}`);
  }
  return json;
}

/** Starts an upload. Limits: allowed types, 25 MB a file, 5 GB for the app. */
export async function createUpload(args: {
  name: string;
  contentType: string;
  size: number;
  viewer?: Pick<Viewer, "id"> | null;
}): Promise<{ file: StoredFile; upload: UploadForm }> {
  return call("POST", "", {
    env: env(),
    name: args.name,
    content_type: args.contentType,
    size_bytes: args.size,
    user_id: args.viewer?.id ? Number(args.viewer.id) : null,
  });
}

/** A file's status; with `url`, also a link valid for an hour once it's ready. */
export async function getFile(
  id: string,
  opts: { url?: "inline" | "download" } = {},
): Promise<{ file: StoredFile; url?: string; expires_at?: string }> {
  const q = opts.url === "download" ? "&download=1" : opts.url === "inline" ? "&inline=1" : "";
  return call("GET", `/${encodeURIComponent(id)}?env=${env()}${q}`);
}

/** Removes a file for good. */
export async function deleteFile(id: string): Promise<void> {
  await call("DELETE", `/${encodeURIComponent(id)}?env=${env()}`);
}
