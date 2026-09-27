/**
 * Browser-side bridge between this app (running in an iframe) and the
 * Contactzilla parent window. Messages are `{ v: 1, type, payload, id }` and are
 * strictly origin-checked in both directions: we only post to, and only accept
 * messages from, the origin of CZ_PUBLIC_URL (exposed by the root loader).
 *
 * The parent honours a small allow-list and never changes data on request, so
 * this is for navigation/UX only:
 *
 *   openContact({ addressBook, uuid })  → cz.openContact
 *   toast({ message, level })           → cz.toast
 *   resize({ height })                  → cz.resize
 *   onTheme(cb)                         ← cz.theme { mode }
 *
 * Every call is a no-op on the server and when the app is not inside an iframe.
 */
import { useEffect, useMemo } from "react";
import { useRouteLoaderData } from "react-router";

export const PROTOCOL_VERSION = 1 as const;

export type ThemeMode = "light" | "dark";
export type ToastLevel = "info" | "success" | "warning" | "error";

export interface BridgeMessage<P = unknown> {
  v: typeof PROTOCOL_VERSION;
  type: string;
  payload: P;
  id: string;
}

export interface ExtendSdk {
  /** True when running in a browser inside an iframe with a valid parent origin. */
  readonly embedded: boolean;
  readonly parentOrigin: string | null;
  openContact(args: { addressBook: string; uuid: string }): void;
  toast(args: { message: string; level?: ToastLevel }): void;
  resize(args: { height: number }): void;
  /** Subscribe to theme changes from Contactzilla. Returns an unsubscribe function. */
  onTheme(cb: (mode: ThemeMode) => void): () => void;
}

function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function inIframe(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin access to window.top throws: we are framed.
    return true;
  }
}

function newId(): string {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && "randomUUID" in c) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const noopSdk: ExtendSdk = {
  embedded: false,
  parentOrigin: null,
  openContact() {},
  toast() {},
  resize() {},
  onTheme() {
    return () => {};
  },
};

/** Create the bridge for a given Contactzilla public URL (e.g. "https://contactzilla.app"). */
export function initExtendSdk(czPublicUrl: string | null | undefined): ExtendSdk {
  const parentOrigin = originOf(czPublicUrl);
  if (!parentOrigin || !inIframe()) return { ...noopSdk, parentOrigin };

  function send<P>(type: string, payload: P): void {
    const message: BridgeMessage<P> = { v: PROTOCOL_VERSION, type, payload, id: newId() };
    window.parent.postMessage(message, parentOrigin as string);
  }

  return {
    embedded: true,
    parentOrigin,
    openContact({ addressBook, uuid }) {
      send("cz.openContact", { addressBook, uuid });
    },
    toast({ message, level = "info" }) {
      send("cz.toast", { message, level });
    },
    resize({ height }) {
      send("cz.resize", { height: Math.max(0, Math.round(height)) });
    },
    onTheme(cb) {
      const listener = (event: MessageEvent) => {
        if (event.origin !== parentOrigin) return;
        if (event.source !== window.parent) return;
        const data = event.data as Partial<BridgeMessage<{ mode?: unknown }>> | null;
        if (!data || data.v !== PROTOCOL_VERSION || data.type !== "cz.theme") return;
        const mode = data.payload?.mode;
        if (mode === "light" || mode === "dark") cb(mode);
      };
      window.addEventListener("message", listener);
      return () => window.removeEventListener("message", listener);
    },
  };
}

/** Shape of the root loader data this SDK relies on. */
export interface RootLoaderData {
  czPublicUrl: string;
}

/** React hook: the bridge configured from the root loader's `czPublicUrl`. */
export function useExtendSdk(): ExtendSdk {
  const data = useRouteLoaderData("root") as RootLoaderData | undefined;
  const czPublicUrl = data?.czPublicUrl;
  // initExtendSdk is cheap, but memoise so identities stay stable across renders.
  return useMemo(
    () => (typeof window === "undefined" ? noopSdk : initExtendSdk(czPublicUrl)),
    [czPublicUrl],
  );
}

/**
 * Keeps `<html class="dark">` in sync with Contactzilla's theme. Rendered once
 * in root.tsx; Tailwind's `dark:` variant keys off that class.
 */
export function useThemeSync(): void {
  const sdk = useExtendSdk();
  useEffect(
    () =>
      sdk.onTheme((mode) => {
        document.documentElement.classList.toggle("dark", mode === "dark");
        document.documentElement.style.colorScheme = mode;
      }),
    [sdk],
  );
}
