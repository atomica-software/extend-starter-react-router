/**
 * Browser side of Extend Connect: opens the provider's sign-in in a popup
 * (providers refuse to show inside Contactzilla's iframe) and reports the
 * result. It loads /_connect/sdk.js, which Extend serves on the app's host.
 */

export interface ConnectStatus {
  provider: string;
  mode: "user" | "app";
  connected: boolean;
  account: { id: string | null; name: string | null; email: string | null } | null;
  expires_at: string | null;
  error: string | null;
}

export interface ConnectOptions {
  /** Where the provider sends the user back to if the popup was blocked. */
  returnPath?: string;
  /**
   * Extra parameters for the provider's sign-in page, for this sign-in only,
   * e.g. { prompt: "login" } to force the password or { login_hint: email }.
   * They're added to the admin's (Settings › Auth) and win over them.
   */
  params?: Record<string, string>;
}

interface Sdk {
  connect(provider: string, options?: ConnectOptions): Promise<ConnectStatus>;
  status(provider: string): Promise<ConnectStatus>;
  disconnect(provider: string): Promise<{ disconnected: boolean }>;
}

declare global {
  interface Window {
    ExtendConnect?: Sdk;
  }
}

let loading: Promise<Sdk> | null = null;

/** Loads the SDK once. Call it early (e.g. on mount) so the click can open the popup straight away. */
export function loadConnect(): Promise<Sdk> {
  if (window.ExtendConnect) return Promise.resolve(window.ExtendConnect);
  loading ??= new Promise<Sdk>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/_connect/sdk.js";
    script.async = true;
    script.onload = () => (window.ExtendConnect ? resolve(window.ExtendConnect) : reject(new Error("Connect didn't load")));
    script.onerror = () => {
      loading = null;
      reject(new Error("Couldn't load Connect"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Starts connecting. Must run inside the click handler, before any other
 * await, so the browser allows the popup: load the SDK beforehand with loadConnect().
 */
export function connect(provider: string, options?: ConnectOptions): Promise<ConnectStatus> {
  if (!window.ExtendConnect) return loadConnect().then((sdk) => sdk.connect(provider, options));
  return window.ExtendConnect.connect(provider, options);
}

export async function disconnect(provider: string): Promise<void> {
  await (await loadConnect()).disconnect(provider);
}
