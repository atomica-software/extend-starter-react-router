/**
 * Accounts people connected at other services (Google, Slack, Xero…) through
 * Extend Connect. Server-only.
 *
 *   const res = await connectFetch("google", viewer, "https://www.googleapis.com/calendar/v3/users/me/calendarList");
 *   const token = await getAccessToken("google", viewer);   // when a library wants the token itself
 *   const account = await connectedAccount("google", viewer); // { name, email } or null, for the UI
 *
 * Which account is used depends on the provider's mode (.extend/connect.json):
 * "user" uses the viewer's own account, "app" the app's shared one.
 *
 * Tokens live encrypted in the oauth_tokens table (app/db/schema.ts). This
 * file needs nothing Extend-specific except for refreshing, and even that falls
 * back to refreshing with the provider directly, so it works anywhere the app
 * is deployed with the same table and OAUTH_* variables.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";

import { getDb } from "../db/client.server";
import { oauthTokens } from "../db/schema";
import type { Viewer } from "./viewer.server";

type Owner = { ownerType: "user" | "app"; ownerId: string };
type Row = typeof oauthTokens.$inferSelect;

/** Nobody has connected this account yet (or it must be connected again). Show a connect button. */
export class ConnectNotConnectedError extends Error {
  constructor(
    readonly provider: string,
    readonly reason: "not_connected" | "reconnect_required" | "not_configured" = "not_connected",
    message?: string,
  ) {
    super(
      message ??
        (reason === "not_configured"
          ? `${provider} isn't set up. An admin can set it up in the Builder: Settings › Auth.`
          : reason === "reconnect_required"
            ? `The ${provider} account needs to be connected again.`
            : `No ${provider} account is connected.`),
    );
    this.name = "ConnectNotConnectedError";
  }
}

// ── What's configured (.extend/connect.json, managed by Extend) ─────────────

interface Manifest {
  auth_origin?: string;
  providers: { id: string; name: string; mode: "user" | "app"; scopes: string[] }[];
}

let manifestCache: { mtimeMs: number; value: Manifest } | null = null;

export function connectManifest(): Manifest {
  const path = join(process.cwd(), ".extend", "connect.json");
  try {
    const { mtimeMs } = statSync(path);
    if (manifestCache?.mtimeMs !== mtimeMs) {
      manifestCache = { mtimeMs, value: JSON.parse(readFileSync(path, "utf8")) as Manifest };
    }
    return manifestCache.value;
  } catch {
    return { providers: [] };
  }
}

function ownerFor(provider: string, viewer: Pick<Viewer, "id"> | null | undefined): Owner {
  const mode = connectManifest().providers.find((p) => p.id === provider)?.mode;
  if (mode === "app" || !viewer) return { ownerType: "app", ownerId: "app" };
  return { ownerType: "user", ownerId: String(viewer.id) };
}

// ── Encryption: v1.<base64url(iv ‖ tag ‖ ciphertext)>, AES-256-GCM ────────────

function tokenKey(): Buffer {
  const b64 = process.env.OAUTH_TOKEN_KEY;
  if (!b64) throw new Error("OAUTH_TOKEN_KEY is not set");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("OAUTH_TOKEN_KEY must be 32 bytes (base64)");
  return key;
}

export function decryptToken(blob: string): string {
  if (!blob.startsWith("v1.")) throw new Error("Unknown token format");
  const raw = Buffer.from(blob.slice(3), "base64url");
  const decipher = createDecipheriv("aes-256-gcm", tokenKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return "v1." + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url");
}

// ── Rows ─────────────────────────────────────────────────────────────────────

async function readRow(provider: string, owner: Owner): Promise<Row | null> {
  const rows = await getDb()
    .select()
    .from(oauthTokens)
    .where(
      and(
        eq(oauthTokens.provider, provider),
        eq(oauthTokens.ownerType, owner.ownerType),
        eq(oauthTokens.ownerId, owner.ownerId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

const REFRESH_SKEW_MS = 60_000;

function needsRefresh(row: Row): boolean {
  return !!row.expiresAt && row.expiresAt.getTime() - Date.now() < REFRESH_SKEW_MS;
}

/** Inside Extend, Connect refreshes (it holds the lock and the provider's quirks). */
async function refreshViaExtend(provider: string, owner: Owner, force: boolean): Promise<void> {
  const res = await fetch(`${process.env.EXTEND_CONNECT_URL}/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.EXTEND_CONNECT_TOKEN}`,
    },
    body: JSON.stringify({
      env: process.env.EXTEND_ENV,
      provider,
      owner_type: owner.ownerType,
      owner_id: owner.ownerId,
      force,
    }),
  });
  if (res.status === 409) throw new ConnectNotConnectedError(provider, "reconnect_required");
  if (res.status === 404) throw new ConnectNotConnectedError(provider);
  if (!res.ok) throw new Error(`Refreshing the ${provider} token failed (HTTP ${res.status})`);
}

/** Anywhere else: refresh with the provider directly, using OAUTH_<ID>_CLIENT_ID/SECRET. */
async function refreshDirectly(row: Row): Promise<void> {
  const id = row.provider.toUpperCase().replace(/-/g, "_");
  const clientId = process.env[`OAUTH_${id}_CLIENT_ID`];
  const clientSecret = process.env[`OAUTH_${id}_CLIENT_SECRET`];
  if (!row.refreshToken || !row.tokenUrl || !clientId || !clientSecret) {
    throw new ConnectNotConnectedError(row.provider, "reconnect_required");
  }
  const res = await fetch(row.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: decryptToken(row.refreshToken),
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof data.access_token !== "string") {
    throw new ConnectNotConnectedError(row.provider, "reconnect_required");
  }
  const expiresIn = Number(data.expires_in);
  await getDb()
    .update(oauthTokens)
    .set({
      accessToken: encryptToken(data.access_token),
      ...(typeof data.refresh_token === "string" ? { refreshToken: encryptToken(data.refresh_token) } : {}),
      expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null,
      updatedAt: new Date(),
    })
    .where(eq(oauthTokens.id, row.id));
}

async function refresh(row: Row, owner: Owner, force = false): Promise<Row> {
  if (process.env.EXTEND_CONNECT_URL && process.env.EXTEND_CONNECT_TOKEN) {
    await refreshViaExtend(row.provider, owner, force);
  } else {
    await refreshDirectly(row);
  }
  const fresh = await readRow(row.provider, owner);
  if (!fresh) throw new ConnectNotConnectedError(row.provider);
  return fresh;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * A current access token for the provider: the viewer's own account, or the
 * app's for providers in "app" mode (pass null in background jobs). Throws
 * ConnectNotConnectedError when there's no usable account.
 */
export async function getAccessToken(provider: string, viewer: Pick<Viewer, "id"> | null): Promise<string> {
  const owner = ownerFor(provider, viewer);
  let row = await readRow(provider, owner);
  if (!row) throw new ConnectNotConnectedError(provider);
  if (row.refreshError) throw new ConnectNotConnectedError(provider, "reconnect_required");
  if (needsRefresh(row)) row = await refresh(row, owner);
  return decryptToken(row.accessToken);
}

/** The connected account (for showing "Connected as …"), or null. Never the token. */
export async function connectedAccount(
  provider: string,
  viewer: Pick<Viewer, "id"> | null,
): Promise<{ name: string | null; email: string | null; needsReconnect: boolean; metadata: Record<string, unknown> } | null> {
  const row = await readRow(provider, ownerFor(provider, viewer));
  if (!row) return null;
  return { name: row.accountName, email: row.accountEmail, needsReconnect: !!row.refreshError, metadata: row.metadata };
}

/**
 * fetch() with the provider's token. Retries once with a refreshed token when
 * the provider answers 401.
 */
export async function connectFetch(
  provider: string,
  viewer: Pick<Viewer, "id"> | null,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const withToken = (token: string) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    return fetch(url, { ...init, headers });
  };
  const res = await withToken(await getAccessToken(provider, viewer));
  if (res.status !== 401) return res;

  const owner = ownerFor(provider, viewer);
  const row = await readRow(provider, owner);
  if (!row?.refreshToken) return res;
  const fresh = await refresh(row, owner, true);
  return withToken(decryptToken(fresh.accessToken));
}
