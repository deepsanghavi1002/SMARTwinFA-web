/**
 * What an emailed report may be and who may get it (docs/SCHEDULED-REPORTS-PLAN.md). Pure: no database, no network.
 */
import type { Role } from "../auth/roles.ts";

/** The reports that can be emailed, by report_key: 6 Trial Balance. A report is added only after it is checked: some move or change data. */
export const EMAIL_REPORT_KEYS: ReadonlySet<number> = new Set([6]);

export type MailFormat = "pdf" | "xlsx";
export const MAIL_TYPES: Readonly<Record<MailFormat, string>> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export const MAX_RECIPIENTS = 10;
export const MAX_ATTEMPTS = 3;

/** A message the user is meant to read: a refused request or a failed job. */
export class MailRefusal extends Error {
  constructor(message: string) { super(message); this.name = "MailRefusal"; }
}

export function cleanFormat(value: unknown): MailFormat {
  if (value === "pdf" || value === "xlsx") return value;
  throw new MailRefusal("Choose PDF or Excel");
}

const EMAIL = /^[^\s@,;<>"()]{1,64}@[^\s@,;<>"()]{1,190}\.[^\s@,;<>"()]{2,24}$/;

export function cleanAddress(value: unknown): string {
  const address = String(value ?? "").trim().toLowerCase();
  if (!EMAIL.test(address)) throw new MailRefusal(`"${address.slice(0, 80)}" is not a valid email address`);
  return address;
}

/** Addresses as typed (a list, or text split on commas, semicolons and spaces), each once. */
export function cleanRecipients(value: unknown): string[] {
  const parts = (Array.isArray(value) ? value.map((entry) => String(entry ?? "")) : String(value ?? "").split(/[\s,;]+/)).filter((part) => part.trim() !== "");
  const list = [...new Set(parts.map(cleanAddress))];
  if (list.length === 0) throw new MailRefusal("Enter at least one email address");
  if (list.length > MAX_RECIPIENTS) throw new MailRefusal(`At most ${MAX_RECIPIENTS} recipients are allowed`);
  return list;
}

/** The user's own saved address is allowed; every other one must be on the admin's list. */
export function recipientRefusal(recipients: readonly string[], ownEmail: string | null, approved: readonly string[]): string {
  const allowed = new Set([...approved, ...(ownEmail ? [ownEmail] : [])].map((address) => address.trim().toLowerCase()));
  const refused = recipients.filter((address) => !allowed.has(address.toLowerCase()));
  return refused.length === 0 ? "" : `Not approved for report email: ${refused.join(", ")}. Ask the admin to approve the address.`;
}

/** Who keeps the approved list. A company admin is not tied to companies in web_auth, so only the platform admin does. */
export const canApproveRecipients = (role: Role) => role === "platform_admin";

export type RightsFacts = Readonly<{
  /** The web user as stored now; null when the user is gone. */
  user: Readonly<{ status: string; role: string; operatorLogin: string | null }> | null;
  /** The operator the schedule was made as. */
  operator: string;
  yearAllowed: boolean;
  companyAllowed: boolean;
  menuVisible: boolean;
  exportRight: boolean;
  reportKey: number;
  /** The module password's fingerprint now and when the schedule was made ("" when there is none). */
  passwordNow: string;
  passwordThen: string;
}>;

/** Why this report may not be sent; "" when it may. */
export function rightsRefusal(facts: RightsFacts): string {
  const { user } = facts;
  if (!user || user.status !== "active") return "The user who set up this report is not active";
  // The platform admin chooses the operator at sign-in; everyone else works only as their own.
  if (user.role !== "platform_admin" && (user.operatorLogin ?? "").trim().toUpperCase() !== facts.operator.trim().toUpperCase()) return "The user is no longer linked to this operator";
  if (!facts.yearAllowed) return "The operator may not open this accounting year";
  if (!facts.companyAllowed) return "The operator may not open this company";
  if (!facts.menuVisible) return "The report is not in this company's menu";
  if (!EMAIL_REPORT_KEYS.has(facts.reportKey)) return "Only the Trial Balance can be emailed at present";
  if (!facts.exportRight) return "Export rights are not available for this user";
  if (facts.passwordNow !== "" && facts.passwordNow !== facts.passwordThen) return "The module password was set or changed. Open Email for this view and press Send Now again";
  return "";
}

/** A saved view's selection and Group By, refused when the emailed file could not match the view. */
export function viewSelection(payload: unknown): unknown {
  const view = (payload ?? {}) as { selection?: unknown; groupBy?: unknown };
  if (!view.selection || typeof view.selection !== "object") throw new MailRefusal("The saved view has no selection");
  if (Array.isArray(view.groupBy) && view.groupBy.length > 0) throw new MailRefusal("This view uses Group By, which emailed reports do not support yet. Save a view without Group By.");
  return view.selection;
}
