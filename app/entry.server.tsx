// Server entry: React Router's default Node entry, plus `handleError`, which sends every
// uncaught loader/action/render error to the Extend app log (see app/lib/log.server.ts).
import { PassThrough } from "node:stream";

import type { EntryContext, HandleErrorFunction } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isRouteErrorResponse, ServerRouter } from "react-router";
import { isbot } from "isbot";
import type { RenderToPipeableStreamOptions } from "react-dom/server";
import { renderToPipeableStream } from "react-dom/server";

import { isBuilderRequest } from "./lib/extend-origin.server";
import { buildRecord, log, writeRecord, type LogFields, type LogLevel } from "./lib/log.server";

export const streamTimeout = 5_000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
) {
  // https://httpwg.org/specs/rfc9110.html#HEAD
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders,
    });
  }

  return new Promise((resolve, reject) => {
    let shellRendered = false;
    let userAgent = request.headers.get("user-agent");

    // Ensure requests from bots and SPA Mode renders wait for all content to load before responding
    // https://react.dev/reference/react-dom/server/renderToPipeableStream#waiting-for-all-content-to-load-for-crawlers-and-static-generation
    let readyOption: keyof RenderToPipeableStreamOptions =
      (userAgent && isbot(userAgent)) || routerContext.isSpaMode
        ? "onAllReady"
        : "onShellReady";

    // Abort the rendering stream after the `streamTimeout` so it has time to
    // flush down the rejected boundaries
    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => abort(),
      streamTimeout + 1000,
    );

    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={routerContext} url={request.url} />,
      {
        [readyOption]() {
          shellRendered = true;
          const body = new PassThrough({
            final(callback) {
              // Clear the timeout to prevent retaining the closure and memory leak
              clearTimeout(timeoutId);
              timeoutId = undefined;
              callback();
            },
          });
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");

          pipe(body);

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          // Log streaming rendering errors from inside the shell.  Don't log
          // errors encountered during initial shell rendering since they'll
          // reject and get logged in handleDocumentRequest.
          if (shellRendered) {
            log.error("Streaming render failed", { error, url: request.url });
          }
        },
      },
    );
  });
}

export const handleError: HandleErrorFunction = (error, { request }) => {
  // Aborted requests (the user navigated away) are not errors.
  if (request.signal.aborted) return;
  const fields = { url: request.url };
  const method = request.method.toUpperCase();
  // The Builder's own test requests (extend-preview, extend-screenshot): their records say so,
  // so Contactzilla doesn't show them as the app failing for a viewer (#48).
  const builder = isBuilderRequest(request.headers);
  const write = (level: LogLevel, message: string, f: LogFields) => {
    if (!builder) return log[level](message, f);
    try {
      writeRecord({ ...buildRecord(level, message, f), origin: "builder" });
    } catch {
      // Logging must never break the request.
    }
  };
  if (isRouteErrorResponse(error)) {
    // React Router wraps some internal errors (e.g. "No route matches URL") in a response.
    const inner = (error as { error?: unknown }).error;
    if (error.status === 404) {
      // Unknown URLs (favicon probes, typos): keep them in the log file, don't alert.
      write("info", `${method} ${error.status} ${error.statusText || "Not Found"}`, fields);
      return;
    }
    if (error.status === 405 && builder) {
      // A test request to a route without an action (often an index route's, which is at ?index).
      write("info", `${method} 405 Method Not Allowed: no action here (an index route's action is at ?index)`, fields);
      return;
    }
    write("error", `Unhandled server error in ${method} (${error.status})`, { ...fields, error: inner ?? error.data });
    return;
  }
  write("error", `Unhandled server error in ${method}`, { ...fields, error });
};
