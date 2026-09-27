import { useEffect, useState, type ReactNode } from "react";
import { useRevalidator } from "react-router";

import { connect, disconnect, loadConnect, type ConnectOptions } from "../lib/connect.client";
import { Button, type ButtonProps } from "./ui";

/**
 * "Connect Google" / "Connected as ada@example.com · Disconnect".
 *
 * Pass what the loader knows (connectedAccount() from ~/lib/connect.server);
 * after connecting or disconnecting, the page's loaders run again.
 *
 *   <ConnectButton provider="google" label="Google" account={loaderData.google} />
 *
 * `params` adds parameters to the provider's sign-in page for this button, e.g.
 * a "Use a different account" button with params={{ prompt: "login" }}.
 */
export function ConnectButton({
  provider,
  label,
  account,
  canDisconnect = true,
  size = "md",
  params,
  children,
}: {
  provider: string;
  /** The service's name, e.g. "Google". */
  label: string;
  account: { name: string | null; email: string | null; needsReconnect?: boolean } | null;
  canDisconnect?: boolean;
  size?: ButtonProps["size"];
  /** Extra sign-in parameters for this button (they win over the admin's). */
  params?: ConnectOptions["params"];
  /** Replaces the "Connect …" label. */
  children?: ReactNode;
}) {
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the SDK up front so the click opens the popup without being blocked.
  useEffect(() => {
    loadConnect().catch(() => undefined);
  }, []);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await revalidator.revalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  if (account && !account.needsReconnect) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-700 dark:text-gray-300">
          Connected to {label} as <strong>{account.email ?? account.name ?? "your account"}</strong>
        </span>
        {canDisconnect && (
          <Button variant="ghost" size="sm" loading={busy} onClick={() => run(() => disconnect(provider))}>
            Disconnect
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Button size={size} loading={busy} onClick={() => run(() => connect(provider, { params }))}>
        {children ?? (account?.needsReconnect ? `Reconnect ${label}` : `Connect ${label}`)}
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
