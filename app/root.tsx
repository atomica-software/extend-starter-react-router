import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import { useEffect } from "react";

import type { Route } from "./+types/root";
import { czPublicUrl } from "./lib/cz.server";
import { installExtendLog, reportClientError } from "./lib/extend-log.client";
import { useThemeSync } from "./lib/extend-sdk";
// Figtree, Contactzilla's typeface, self-hosted (no external font request, nothing for a CSP to block).
import "@fontsource/figtree/400.css";
import "@fontsource/figtree/500.css";
import "@fontsource/figtree/600.css";
import "@fontsource/figtree/700.css";
import "./app.css";
import { buttonClasses } from "./components/ui";

export function loader() {
  // Exposed to the browser so the postMessage bridge can origin-check against
  // the Contactzilla parent window (see app/lib/extend-sdk.ts).
  return { czPublicUrl: czPublicUrl() };
}

export function Layout({ children }: { children: React.ReactNode }) {
  // Browser errors (console.error, uncaught errors, failed requests) go to the Extend app log,
  // where the admin and the Builder can see them. Installed once; lives in Layout so it also
  // runs when the root ErrorBoundary renders instead of App.
  useEffect(() => {
    installExtendLog();
  }, []);
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        {/* Tells Contactzilla which page is open, so its URL (refresh, back, shared links) follows the app. Keep it. */}
        <script src="/_cz/bridge.js" defer />
      </head>
      <body className="min-h-screen font-sans">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  useThemeSync();
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  useEffect(() => {
    // Server-side errors are already logged by handleError; this covers client-side render and
    // loader errors, plus error responses the user actually saw.
    if (isRouteErrorResponse(error)) {
      if (error.status !== 404) reportClientError(`${error.status} ${error.statusText}`, "Error page shown");
    } else {
      reportClientError(error, "Error page shown");
    }
  }, [error]);

  if (isRouteErrorResponse(error)) {
    title = error.status === 404 ? "Not found" : `Error ${error.status}`;
    details =
      typeof error.data === "string" && error.data ? error.data : error.statusText || details;
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{title}</h1>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{details}</p>
      <a href="/" className={buttonClasses({ variant: "secondary", className: "mt-4" })}>
        Back to start
      </a>
      {stack && (
        <pre className="mt-4 overflow-x-auto rounded-md border border-gray-200 bg-gray-50 p-4 text-xs dark:border-gray-800 dark:bg-gray-900">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
