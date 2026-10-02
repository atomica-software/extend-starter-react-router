/**
 * Reading a contact's fields (no `.server`: components can import it too).
 *
 * The API gives a contact as `contact_data` rows, one per value, each with its
 * field's `contact_field.component_key` (Email, Phone, Label, Custom, Bio…),
 * a label (`contact_field_label.label_value`, e.g. Mobile) and, for custom
 * fields, `custom_label`. List rows (`listContacts`, `paginateContacts`) carry
 * the same rows as `getContact`, so there's no need to fetch each contact again.
 *
 * `readContact` groups them like the MCP `get-contact` tool shows them:
 *
 * ```ts
 * const { labels, custom, emails, phones, jobTitle, department, notes } = readContact(contact);
 * contactDisplayName(contact);     // "Ada Lovelace", or the company name
 * customField(contact, "Roles");   // the first value of the custom field "Roles"
 * contactEmail(contact);           // the first email address
 * samePhone(from, phone.e164);     // match an incoming number to a contact's
 * ```
 *
 * For a number to text, use `contactMobileE164()` from `~/lib/cz.server`: it
 * asks Contactzilla to normalise numbers the team doesn't format.
 */
import type { ContactData } from "@atomica-software/contactzilla";

/** A contact as the API returns it; only the parts read here. */
export interface ContactWithData {
  bio?: string | null;
  contact_data?: ContactDataRow[] | null;
}

export type ContactDataRow = Pick<ContactData, "field_value" | "custom_label" | "formatted_value" | "phone_meta"> & {
  contact_field?: { component_key: string } | null;
  contact_field_label?: { label_value: string } | null;
};

export interface LabelledValue {
  /** The row's label (Work, Home, Mobile…), or a custom field's name. */
  label?: string;
  value: string;
}

export interface ContactPhone extends LabelledValue {
  /** E.164 (+447700900123), when the team formats phone numbers. Otherwise use contactMobileE164(). */
  e164?: string;
  /** libphonenumber's type, when the team formats phone numbers: 0 fixed line, 1 mobile, 2 fixed line or mobile (US, Canada)… */
  type?: number;
  /** Whether it can take a text: by its type when known, otherwise by its label (Mobile, Cell…). */
  textable: boolean;
}

export interface ReadContact {
  /** The contact's labels (tags), e.g. ["VIP", "Volunteer"]. */
  labels: string[];
  /** Custom fields, in order; a field can appear more than once. */
  custom: Required<LabelledValue>[];
  emails: LabelledValue[];
  phones: ContactPhone[];
  addresses: LabelledValue[];
  urls: LabelledValue[];
  dates: LabelledValue[];
  companyName?: string;
  jobTitle?: string;
  department?: string;
  /** The contact's notes: its Bio rows (not `contact.bio`, which is usually empty). */
  notes?: string;
}

/** libphonenumber types that can't take a text: fixed line, toll free, premium rate, shared cost, pager, UAN, voicemail. */
const NOT_TEXTABLE_TYPES = new Set([0, 3, 4, 5, 8, 9, 10]);
const MOBILE_LABEL = /mobile|cell|iphone|sms|text|whatsapp/i;

/** Whether a phone row can take a text: by its type when Contactzilla knows it, else by its label. */
export function isTextable(type: number | null | undefined, label: string | undefined): boolean {
  if (typeof type === "number" && type >= 0) return !NOT_TEXTABLE_TYPES.has(type);
  return MOBILE_LABEL.test(label ?? "");
}

const value = (r: ContactDataRow) => (r.field_value ?? "").trim();
const labelOf = (r: ContactDataRow) => r.custom_label?.trim() || r.contact_field_label?.label_value?.trim() || undefined;

function rowsOf(c: ContactWithData, ...keys: string[]): ContactDataRow[] {
  return (c.contact_data ?? []).filter((r) => keys.includes(r.contact_field?.component_key ?? "") && value(r) !== "");
}

function labelled(rows: ContactDataRow[]): LabelledValue[] {
  return rows.map((r) => {
    const label = labelOf(r);
    return label ? { label, value: value(r) } : { value: value(r) };
  });
}

function first(c: ContactWithData, key: string): string | undefined {
  const row = rowsOf(c, key)[0];
  return row ? value(row) : undefined;
}

/** A contact's fields, grouped by kind, with the names MCP `get-contact` uses. */
export function readContact(c: ContactWithData): ReadContact {
  const notes = rowsOf(c, "Bio").map(value).join("\n\n") || c.bio?.trim() || undefined;
  const out: ReadContact = {
    labels: rowsOf(c, "Label").map(value),
    custom: rowsOf(c, "Custom", "CustomUnique").map((r) => ({ label: labelOf(r) ?? "", value: value(r) })),
    emails: labelled(rowsOf(c, "Email")),
    phones: rowsOf(c, "Phone").map((r) => {
      const label = labelOf(r);
      const e164 = r.phone_meta?.phone_e164 || undefined;
      const type = typeof r.phone_meta?.phone_type === "number" ? r.phone_meta.phone_type : undefined;
      return {
        ...(label ? { label } : {}),
        value: value(r),
        ...(e164 ? { e164 } : {}),
        ...(type !== undefined ? { type } : {}),
        textable: isTextable(type, label),
      };
    }),
    addresses: labelled(rowsOf(c, "Address")),
    urls: labelled(rowsOf(c, "URL")),
    dates: labelled(rowsOf(c, "Date")),
  };
  const companyName = first(c, "CompanyName");
  const jobTitle = first(c, "JobTitle");
  const department = first(c, "Department");
  if (companyName) out.companyName = companyName;
  if (jobTitle) out.jobTitle = jobTitle;
  if (department) out.department = department;
  if (notes) out.notes = notes;
  return out;
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

const sameLabel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The first value of a custom field (its name matched ignoring case), or undefined. */
export function customField(c: ContactWithData, label: string): string | undefined {
  return customFields(c, label)[0];
}

/** Every value of a custom field: a contact can have the same custom field more than once. */
export function customFields(c: ContactWithData, label: string): string[] {
  return readContact(c).custom.filter((f) => sameLabel(f.label, label)).map((f) => f.value);
}

/** The contact's first email address, or one with a given label (e.g. "Work"), or undefined. */
export function contactEmail(c: ContactWithData, label?: string): string | undefined {
  const emails = readContact(c).emails;
  return (label ? emails.find((e) => e.label && sameLabel(e.label, label)) : emails[0])?.value;
}

/** `+44 7700 900123` → `+447700900123`; `00 44…` → `+44…`. Only digits and a leading +. */
export function normalisePhone(phone: string | null | undefined): string {
  const s = (phone ?? "").trim().replace(/^00/, "+");
  return (s.startsWith("+") ? "+" : "") + s.replace(/\D/g, "");
}

/**
 * Whether two numbers are the same, compared as E.164 (an SMS reply's `From`
 * against a contact's `e164`). Both must be international (+…): national
 * numbers are ambiguous, so normalise them with contactMobileE164() first.
 */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalisePhone(a);
  const y = normalisePhone(b);
  return x.startsWith("+") && x.length > 4 && x === y;
}
