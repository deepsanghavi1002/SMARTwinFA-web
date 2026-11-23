/**
 * Add Details (web only): the master and entry fields a report can take as extra columns. Types shared by the server (lib/report/details.ts,
 * which knows where each field lives) and the screen (features/report/AddDetailsPanel.tsx, useDetailColumns.ts).
 */

/** Where a field comes from: the account master, the product master, or the entry (voucher). */
export type DetailSection = "acc" | "prod" | "ent";

export const SECTION_NAME: Readonly<Record<DetailSection, string>> = { acc: "Account", prod: "Product", ent: "Entry" };

export type DetailField = Readonly<{
  /** "acc:addon:txt_area", "acc:col:address_1", "ent:col:narration" ... */
  id: string;
  section: DetailSection;
  /** Addon fields (the company's own) or other columns. */
  list: "addon" | "other";
  caption: string;
  /** The sub-group it is listed under, so a long list can be ticked a group at a time. */
  group: string;
  /** Names the report might already show it under (normalized): a field the report has is not offered again. */
  aliases: readonly string[];
  /** Numbers read to the right. */
  right?: boolean;
}>;

export type DetailIdentity = Readonly<{
  /** The report column that holds the account name (null: none). */
  account: string | null;
  /** The report column that holds the product name (null: none). */
  product: string | null;
}>;

export type DetailRequest = Readonly<{
  /** Field ids wanted. */
  fields: readonly string[];
  accountNames?: readonly string[];
  productNames?: readonly string[];
  ledKeys?: readonly number[];
}>;

/** key → field id → text; the keys are the account / product name as trimmed, or the led key. */
export type DetailValues = Readonly<{
  acc: Readonly<Record<string, Readonly<Record<string, string>>>>;
  prod: Readonly<Record<string, Readonly<Record<string, string>>>>;
  ent: Readonly<Record<string, Readonly<Record<string, string>>>>;
}>;

/** A name compared loosely: letters and digits only, lower case, single spaces ("Address 1", "ADDRESS_1" and "address 1" are one). */
export const normalName = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The name in a heading or subtotal cell: "** Subtotal For : A V S Sales Agency" is "A V S Sales Agency". */
export const plainName = (text: string): string => text.replace(/^\*+\s*Subtotal For\s*:\s*/i, "").replace(/^\*+\s*/, "").trim();
