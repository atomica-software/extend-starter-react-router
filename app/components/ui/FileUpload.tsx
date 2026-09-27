import clsx from "clsx";
import { useRef, useState } from "react";
import { buttonClasses } from "./Button";

/**
 * Upload one or more files, with a progress bar for each. Files go straight
 * from the browser to Contactzilla's file storage (never through the app's
 * server), are scanned for malware, and are handed to `onUploaded` once
 * they're ready to use. Store each file's `id`; show it with `/files/<id>`.
 *
 *   <FileUpload accept="image/*" onUploaded={([f]) => setAvatarId(f.id)} />
 *   <FileUpload multiple label="Add attachments" onUploaded={files => …} />
 *
 * Accepted types: images (JPEG, PNG, GIF, WebP, AVIF), PDF, plain text and
 * CSV, up to 25 MB each.
 */

export interface UploadedFile {
  id: string;
  name: string;
  content_type: string;
  size_bytes: number;
}

type State = "starting" | "uploading" | "checking" | "ready" | "failed";

interface Item {
  key: string;
  name: string;
  size: number;
  state: State;
  progress: number;
  error?: string;
  file?: UploadedFile;
}

const CHECK_EVERY_MS = 1500;
const CHECK_FOR_MS = 3 * 60_000;

function bytes(n: number): string {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(body.message ?? `The upload was refused (${res.status}).`);
  return body;
}

/** The signed form, then the file, with progress (fetch can't report upload progress). */
function post(url: string, fields: Record<string, string>, file: File, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`The upload was refused (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error("The upload didn't get through. Check your connection and try again."));
    xhr.send(form);
  });
}

async function waitUntilChecked(id: string): Promise<UploadedFile> {
  const until = Date.now() + CHECK_FOR_MS;
  for (;;) {
    const { file } = await json<{ file: UploadedFile & { status: string; rejected_reason: string | null } }>(
      await fetch(`/_app/uploads?id=${encodeURIComponent(id)}`, { headers: { Accept: "application/json" } }),
    );
    if (file.status === "ready") return file;
    if (file.status === "rejected") throw new Error(file.rejected_reason ?? "This file was rejected.");
    if (Date.now() > until) throw new Error("Checking this file is taking too long. Try again later.");
    await new Promise((r) => setTimeout(r, CHECK_EVERY_MS));
  }
}

export function FileUpload({
  multiple = false,
  accept,
  label,
  onUploaded,
  className,
  disabled,
}: {
  multiple?: boolean;
  /** e.g. "image/*" or ".pdf,.csv" */
  accept?: string;
  label?: string;
  /** Called once with every file that finished (after each batch). */
  onUploaded?: (files: UploadedFile[]) => void;
  className?: string;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const update = (key: string, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const uploadOne = async (file: File, key: string): Promise<UploadedFile | null> => {
    try {
      const { file: started, upload } = await json<{ file: UploadedFile; upload: { url: string; fields: Record<string, string> } }>(
        await fetch("/_app/uploads", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ name: file.name, content_type: file.type || "application/octet-stream", size_bytes: file.size }),
        }),
      );
      update(key, { state: "uploading" });
      await post(upload.url, upload.fields, file, (progress) => update(key, { progress }));
      update(key, { state: "checking", progress: 100 });
      const ready = await waitUntilChecked(started.id);
      update(key, { state: "ready", file: ready });
      return ready;
    } catch (e) {
      update(key, { state: "failed", error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  };

  const start = async (files: FileList | File[]) => {
    const list = Array.from(files).slice(0, multiple ? 50 : 1);
    if (list.length === 0) return;
    const batch = list.map((f) => ({ file: f, key: `${Date.now()}-${Math.random()}` }));
    setItems((current) => [
      ...(multiple ? current : []),
      ...batch.map(({ file, key }) => ({ key, name: file.name, size: file.size, state: "starting" as State, progress: 0 })),
    ]);
    // Three at a time.
    const done: UploadedFile[] = [];
    const queue = [...batch];
    await Promise.all(
      Array.from({ length: Math.min(3, queue.length) }, async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const f = await uploadOne(next.file, next.key);
          if (f) done.push(f);
        }
      }),
    );
    if (done.length) onUploaded?.(done);
  };

  return (
    <div className={clsx("space-y-2", className)}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!disabled) void start(e.dataTransfer.files);
        }}
        className={clsx(
          "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm",
          over ? "border-pcgreen-300 bg-pcgreen-100/10" : "border-gray-300 dark:border-gray-700",
          disabled && "opacity-50",
        )}
      >
        <button
          type="button"
          disabled={disabled}
          onClick={() => input.current?.click()}
          className={buttonClasses({ size: "sm" })}
        >
          {label ?? (multiple ? "Choose files" : "Choose a file")}
        </button>
        <span className="text-xs text-gray-500">or drop {multiple ? "them" : "it"} here</span>
        <input
          ref={input}
          type="file"
          className="hidden"
          multiple={multiple}
          accept={accept}
          onChange={(e) => {
            if (e.target.files) void start(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.key} className="rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-gray-800" data-state={item.state}>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{item.name}</span>
                <span
                  className={clsx(
                    "shrink-0 text-xs",
                    item.state === "ready" ? "text-green-700" : item.state === "failed" ? "text-red-700" : "text-gray-500",
                  )}
                >
                  {item.state === "starting" && "Starting…"}
                  {item.state === "uploading" && `${item.progress}% of ${bytes(item.size)}`}
                  {item.state === "checking" && "Checking…"}
                  {item.state === "ready" && "Ready"}
                  {item.state === "failed" && "Failed"}
                </span>
              </div>
              {(item.state === "uploading" || item.state === "checking" || item.state === "starting") && (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-gray-100 dark:bg-gray-800">
                  <div
                    className={clsx("h-full rounded bg-pcgreen-300 transition-all", item.state === "checking" && "animate-pulse")}
                    style={{ width: `${item.state === "starting" ? 2 : item.progress}%` }}
                  />
                </div>
              )}
              {item.error && <p className="mt-1 text-xs text-red-700">{item.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
