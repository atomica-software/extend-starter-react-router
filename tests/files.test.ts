import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUpload, deleteFile, FilesError, getFile } from "../app/lib/files.server";

describe("files.server", () => {
  const calls: { url: string; init: RequestInit }[] = [];
  beforeEach(() => {
    calls.length = 0;
    process.env.EXTEND_ENV = "live";
    process.env.EXTEND_FILES_TOKEN = "tok";
    delete process.env.EXTEND_FILES_URL;
    process.env.EXTEND_CONNECT_URL = "http://control.x:8080/_connect";
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      if (url.includes("/nope")) return Response.json({ error: "not_found" }, { status: 404 });
      return Response.json({ file: { id: "f1", status: "ready" }, url: "https://s3/x", upload: { method: "POST", url: "https://s3", fields: {} } });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("asks control for an upload for this app's environment, with its token", async () => {
    await createUpload({ name: "a.png", contentType: "image/png", size: 10, viewer: { id: "7" } });
    expect(calls[0]!.url).toBe("http://control.x:8080/_files");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ env: "live", name: "a.png", content_type: "image/png", size_bytes: 10, user_id: 7 });
  });

  it("gets a link, deletes, and reports errors", async () => {
    await getFile("f1", { url: "download" });
    expect(calls[0]!.url).toBe("http://control.x:8080/_files/f1?env=live&download=1");
    await deleteFile("f1");
    expect(calls[1]!.init.method).toBe("DELETE");
    await expect(getFile("nope")).rejects.toBeInstanceOf(FilesError);
  });
});
