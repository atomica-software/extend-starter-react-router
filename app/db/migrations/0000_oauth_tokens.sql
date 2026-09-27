-- IF NOT EXISTS: Extend Connect may already have created this table (CONTRACTS §6.11).
CREATE TABLE IF NOT EXISTS "oauth_tokens" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" text NOT NULL,
	"account_id" text,
	"account_name" text,
	"account_email" text,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"token_type" text DEFAULT 'Bearer' NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp with time zone,
	"token_url" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"refresh_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_tokens_provider_owner_type_owner_id_key" UNIQUE("provider","owner_type","owner_id"),
	CONSTRAINT "oauth_tokens_owner_type_check" CHECK ("oauth_tokens"."owner_type" IN ('user', 'app'))
);
