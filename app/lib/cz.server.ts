/**
 * Contactzilla client (server-only: the .server.ts suffix keeps it out of the
 * browser bundle).
 *
 * This is the published client, @atomica-software/contactzilla, set up for an
 * Extend stack. Every API operation is a typed method generated from
 * Contactzilla's OpenAPI description, so arguments and responses are exactly
 * typed and a wrong field name is a compile error.
 *
 * Requests go to CZ_API_BASE (inside a stack: http://control:8080/cz), a proxy
 * that adds the stack's credentials itself, so never add an Authorization
 * header or store an API key. Pass the viewer so Contactzilla records who acted.
 *
 * ```ts
 * const { data: books } = await cz(viewer).listAddressBooks({ team: viewer.team });
 * const { results, count } = await cz(viewer).listContacts({ team: viewer.team, address_book: "customers", query: "smith" });
 * ```
 *
 * API reference: docs/contactzilla-api.md. The live OpenAPI document, the
 * source of truth when something doesn't match: `curl -s "$CZ_API_BASE/openapi.json"`
 * (public at `${CZ_API_HOST}/api/v1/openapi.json`).
 */
import { createExtendClient, contactzillaHost, ExtendNotConnectedError } from "@atomica-software/contactzilla/extend";
import type { ContactzillaClient } from "@atomica-software/contactzilla";
import type { Viewer } from "./viewer.server";

export {
  ContactzillaError as CzApiError,
  ContactzillaForbiddenError,
  ContactzillaNotFoundError,
  ContactzillaValidationError,
  paginateContacts,
} from "@atomica-software/contactzilla";
export type { AddressBook, Contact, ContactData, ContactzillaClient, Team } from "@atomica-software/contactzilla";

/** The stack has no valid Contactzilla connection. An admin must reconnect from the Builder console. */
export { ExtendNotConnectedError as CzNotConnectedError };

/** A client acting for `viewer`. Cheap: make one per request. */
export function cz(viewer?: Pick<Viewer, "id"> | null): ContactzillaClient {
  return createExtendClient({ viewer });
}

/** The Contactzilla this stack belongs to (CZ_API_HOST), for links to Contactzilla pages. */
export function czHost(): string {
  return contactzillaHost() ?? "";
}

/**
 * The Contactzilla the app is embedded in (CZ_PUBLIC_URL), whose origin the postMessage
 * bridge talks to. Stacks from before it was passed to apps have the same URL as
 * CZ_API_HOST only.
 */
export function czPublicUrl(): string {
  return process.env.CZ_PUBLIC_URL || process.env.CZ_API_HOST || "https://contactzilla.app";
}

/** A display name for a contact. */
export function contactDisplayName(contact: {
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
}): string {
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim();
  return name || contact.company_name || "(no name)";
}
