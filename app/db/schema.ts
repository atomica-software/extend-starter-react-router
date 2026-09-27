/**
 * Drizzle schema for this app's own Postgres database (DATABASE_URL).
 *
 * To add a table:
 *
 *   import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
 *
 *   export const notes = pgTable("notes", {
 *     id: serial("id").primaryKey(),
 *     contactUuid: text("contact_uuid").notNull(),
 *     body: text("body").notNull(),
 *     createdBy: text("created_by").notNull(), // viewer.id
 *     createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
 *   });
 *
 * Then run `npm run db:generate` to create a migration in app/db/migrations and
 * `npm run db:migrate` to apply it. Commit the generated migration files.
 * Never edit a migration that has already been applied; generate a new one.
 */
import { sql } from "drizzle-orm";
import { bigserial, check, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * Accounts people connected at other services (Google, Slack, Xero…), written
 * by Extend Connect (see CLAUDE.md, "Signing in to other services"). Keep this
 * table as it is: Connect writes it. Read tokens with app/lib/connect.server.ts.
 */
export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    provider: text("provider").notNull(),
    ownerType: text("owner_type").notNull(),
    ownerId: text("owner_id").notNull(),
    accountId: text("account_id"),
    accountName: text("account_name"),
    accountEmail: text("account_email"),
    scopes: text("scopes").array().notNull().default(sql`'{}'`),
    tokenType: text("token_type").notNull().default("Bearer"),
    /** Encrypted: v1.<base64url(iv ‖ tag ‖ ciphertext)>, AES-256-GCM under OAUTH_TOKEN_KEY. */
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    tokenUrl: text("token_url"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    refreshError: text("refresh_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique("oauth_tokens_provider_owner_type_owner_id_key").on(t.provider, t.ownerType, t.ownerId),
    check("oauth_tokens_owner_type_check", sql`${t.ownerType} IN ('user', 'app')`),
  ],
);
