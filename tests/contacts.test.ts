import { describe, expect, it } from "vitest";

import { contactEmail, customField, customFields, isTextable, normalisePhone, readContact, samePhone, type ContactDataRow } from "../app/lib/contacts";

/** A contact_data row as the API returns it (list rows and getContact alike). */
function row(key: string, value: string, extra: Partial<ContactDataRow> & { label?: string } = {}): ContactDataRow {
  const { label, ...rest } = extra;
  return {
    field_value: value,
    custom_label: null,
    contact_field: { component_key: key },
    contact_field_label: label ? { label_value: label } : null,
    ...rest,
  };
}

const contact = {
  bio: null,
  contact_data: [
    row("FirstName", "Ada"),
    row("JobTitle", "Ward manager"),
    row("Department", "Cardiology"),
    row("Label", "VIP"),
    row("Label", "Volunteer"),
    row("Custom", "Nurse", { custom_label: "Roles" }),
    row("Custom", "First aider", { custom_label: "Roles" }),
    row("CustomUnique", "EMP-001", { custom_label: "Employee ID" }),
    row("Custom", "  ", { custom_label: "Empty" }),
    row("Email", "ada@home.example", { label: "Home" }),
    row("Email", "ada@work.example", { label: "Work" }),
    row("Bio", "Prefers texts after 6pm."),
    row("Bio", "Allergic to penicillin."),
  ],
};

describe("readContact", () => {
  it("groups rows like MCP get-contact", () => {
    const c = readContact(contact);
    expect(c.labels).toEqual(["VIP", "Volunteer"]);
    expect(c.jobTitle).toBe("Ward manager");
    expect(c.department).toBe("Cardiology");
    expect(c.emails).toEqual([
      { label: "Home", value: "ada@home.example" },
      { label: "Work", value: "ada@work.example" },
    ]);
    expect(c.custom).toEqual([
      { label: "Roles", value: "Nurse" },
      { label: "Roles", value: "First aider" },
      { label: "Employee ID", value: "EMP-001" },
    ]);
    expect(c.phones).toEqual([]);
    expect(c.companyName).toBeUndefined();
  });

  it("reads notes from the Bio rows, not contact.bio", () => {
    expect(readContact(contact).notes).toBe("Prefers texts after 6pm.\n\nAllergic to penicillin.");
    expect(readContact({ bio: "Old bio", contact_data: [] }).notes).toBe("Old bio");
    expect(readContact({ bio: null, contact_data: [] }).notes).toBeUndefined();
  });

  it("copes with a contact without contact_data", () => {
    expect(readContact({})).toMatchObject({ labels: [], custom: [], emails: [], phones: [] });
  });
});

describe("customField and contactEmail", () => {
  it("reads repeated custom fields, ignoring case", () => {
    expect(customField(contact, "roles")).toBe("Nurse");
    expect(customFields(contact, "Roles")).toEqual(["Nurse", "First aider"]);
    expect(customField(contact, "Employee ID")).toBe("EMP-001");
    expect(customField(contact, "Empty")).toBeUndefined();
    expect(customField(contact, "Nope")).toBeUndefined();
  });

  it("gives the first email, or the one with a label", () => {
    expect(contactEmail(contact)).toBe("ada@home.example");
    expect(contactEmail(contact, "work")).toBe("ada@work.example");
    expect(contactEmail(contact, "Other")).toBeUndefined();
    expect(contactEmail({ contact_data: [] })).toBeUndefined();
  });
});

describe("phones", () => {
  it("takes the E.164 and type from phone_meta when the team formats numbers", () => {
    const [landline, mobile] = readContact({
      contact_data: [
        row("Phone", "020 7946 0000", { label: "Work", phone_meta: { phone_country: "GB", phone_e164: "+442079460000", phone_type: 0 } }),
        row("Phone", "07700 900123", { label: "Home", formatted_value: "07700 900123", phone_meta: { phone_country: "GB", phone_e164: "+447700900123", phone_type: 1 } }),
      ],
    }).phones;
    expect(landline).toEqual({ label: "Work", value: "020 7946 0000", e164: "+442079460000", type: 0, textable: false });
    // The type wins over a label that says otherwise.
    expect(mobile).toEqual({ label: "Home", value: "07700 900123", e164: "+447700900123", type: 1, textable: true });
  });

  it("counts a US number of type 2 (fixed line or mobile) as textable", () => {
    const [us] = readContact({
      contact_data: [row("Phone", "(212) 555-0123", { label: "Work", phone_meta: { phone_country: "US", phone_e164: "+12125550123", phone_type: 2 } })],
    }).phones;
    expect(us?.textable).toBe(true);
  });

  it("decides by the label without phone_meta (a national number on a default team)", () => {
    const phones = readContact({
      contact_data: [row("Phone", "01632 960000", { label: "Home" }), row("Phone", "07700 900513", { label: "Mobile" }), row("Phone", "555 0100")],
    }).phones;
    expect(phones).toEqual([
      { label: "Home", value: "01632 960000", textable: false },
      { label: "Mobile", value: "07700 900513", textable: true },
      { value: "555 0100", textable: false },
    ]);
  });

  it("knows which types and labels take texts", () => {
    for (const t of [1, 2, 6, 7]) expect(isTextable(t, "Home")).toBe(true);
    for (const t of [0, 3, 4, 5, 8, 9, 10]) expect(isTextable(t, "Mobile")).toBe(false);
    for (const l of ["Mobile", "cell", "iPhone", "Work mobile"]) expect(isTextable(undefined, l)).toBe(true);
    for (const l of ["Home", "Work", "Fax", undefined]) expect(isTextable(-1, l)).toBe(false);
  });

  it("compares numbers as E.164", () => {
    expect(normalisePhone(" +44 (7700) 900-123 ")).toBe("+447700900123");
    expect(normalisePhone("0044 7700 900123")).toBe("+447700900123");
    expect(samePhone("+447700900123", "+44 7700 900123")).toBe(true);
    expect(samePhone("+447700900123", "+447700900124")).toBe(false);
    // National numbers are ambiguous: never a match.
    expect(samePhone("07700900123", "07700900123")).toBe(false);
    // Not just the last digits: a different country is a different number.
    expect(samePhone("+447700900123", "+337700900123")).toBe(false);
    expect(samePhone(undefined, null)).toBe(false);
  });
});
