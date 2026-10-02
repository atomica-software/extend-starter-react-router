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
import { ContactzillaValidationError } from "@atomica-software/contactzilla";
import type { AddressBook, ContactzillaClient } from "@atomica-software/contactzilla";
import { isTextable, readContact, type ContactWithData } from "./contacts";

/** Moved to ./contacts (components can import that); still exported here for existing code. */
export { contactDisplayName } from "./contacts";
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
 * Who a helper acts for: the viewer (in loaders and actions), or just the team
 * (in jobs and webhooks, where there's no viewer and calls are made as the app).
 */
export type ActingFor = Pick<Viewer, "id" | "team"> | { team: string };

const clientFor = (who: ActingFor) => cz("id" in who ? who : null);

/** A link to a contact's page in Contactzilla (open it with target="_top", or useExtendSdk().openContact). */
export function contactUrl(who: { team: string }, addressBook: string, contactId: string): string {
  const e = encodeURIComponent;
  return `${czHost()}/teams/${e(who.team)}/address-books/${e(addressBook)}/contacts/${e(contactId)}`;
}

/**
 * The address books this app is available in (Settings › General › Address
 * books in the Builder console), of those the viewer can see. Use these instead
 * of hard-coding slugs or taking the first book: an admin can change them at
 * any time, and a team can have several.
 *
 * Contactzilla marks each book with `in_app` for the app's own calls; an older
 * Contactzilla doesn't, and then every book the viewer can see counts.
 */
export async function appAddressBooks(who: ActingFor): Promise<AddressBook[]> {
  const { data } = await clientFor(who).listAddressBooks({ team: who.team });
  return data.filter((b) => (b as AddressBook & { in_app?: boolean }).in_app !== false);
}

/** phone/details number types that can take a text. */
const TEXTABLE_NUMBER_TYPES = new Set(["Mobile", "Fixed line or mobile", "VoIP", "Personal number"]);
const TEAM_COUNTRY_TTL_MS = 10 * 60_000;
const teamCountries = new Map<string, { country: string | null; at: number }>();

/** The country the team assumes for national numbers (Team settings), cached for a few minutes. */
async function teamPhoneCountry(who: ActingFor): Promise<string | undefined> {
  const hit = teamCountries.get(who.team);
  if (hit && Date.now() - hit.at < TEAM_COUNTRY_TTL_MS) return hit.country ?? undefined;
  const team = await clientFor(who).getTeam({ team: who.team });
  const country = team.phone_number_country ?? null;
  teamCountries.set(who.team, { country, at: Date.now() });
  return country ?? undefined;
}

/**
 * The number to text a contact on, in E.164 (+447700900123), or undefined if
 * it has none. Mobiles first: a landline is skipped unless `allowLandline`.
 *
 * Numbers the team formats come with their E.164 and type already; others are
 * normalised by Contactzilla (POST phone/details), reading national numbers
 * (07700 900123) as the team's country, or `country` (ISO 3166-1, e.g. "GB").
 * US and Canadian numbers can't be told apart from landlines, so they count as
 * textable. Store the result with what you send, and match replies to it with
 * samePhone().
 */
export async function contactMobileE164(
  who: ActingFor,
  contact: ContactWithData,
  options: { country?: string; allowLandline?: boolean } = {},
): Promise<string | undefined> {
  const phones = readContact(contact).phones;
  const ordered = [...phones.filter((p) => p.textable), ...phones.filter((p) => !p.textable)];
  let country: string | undefined | null = options.country ?? null;
  for (const phone of ordered) {
    if (phone.e164 && (phone.textable || options.allowLandline)) return phone.e164;
    if (phone.e164 && phone.type !== undefined && phone.type >= 0) continue; // known, and not a mobile
    if (country === null) country = await teamPhoneCountry(who).catch(() => undefined);
    try {
      const details = await clientFor(who).getPhoneDetails({ body: { phone: phone.e164 ?? phone.value, ...(country ? { country } : {}) } });
      const e164 = details.formats.e164;
      if (!e164) continue;
      const type = details.number_type ?? "Unknown";
      const textable = TEXTABLE_NUMBER_TYPES.has(type) || (type === "Unknown" && isTextable(undefined, phone.label));
      if (textable || options.allowLandline) return e164;
    } catch (error) {
      if (error instanceof ContactzillaValidationError) continue; // not a valid number
      throw error;
    }
  }
  return undefined;
}

/**
 * The Contactzilla the app is embedded in (CZ_PUBLIC_URL), whose origin the postMessage
 * bridge talks to. Stacks from before it was passed to apps have the same URL as
 * CZ_API_HOST only.
 */
export function czPublicUrl(): string {
  return process.env.CZ_PUBLIC_URL || process.env.CZ_API_HOST || "https://contactzilla.app";
}
