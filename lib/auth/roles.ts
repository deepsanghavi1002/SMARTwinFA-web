/**
 * Who may manage whom.
 *
 * platform_admin  SMARTwinFA's own staff: every user on this installation, and may work as any operator.
 * company_admin   the client's administrator: adds, disables and resets the client's own users.
 * employee        works in the books as the operator they are linked to; manages no one.
 */

export const ROLES = ["platform_admin", "company_admin", "employee"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  platform_admin: "Platform admin",
  company_admin: "Company admin",
  employee: "Employee",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function canManageUsers(role: Role): boolean {
  return role === "platform_admin" || role === "company_admin";
}

/** Whether `actor` may create a user with `role`, or change or reset a user who has it. */
export function canManageRole(actor: Role, role: Role): boolean {
  if (actor === "platform_admin") return true;
  if (actor === "company_admin") return role !== "platform_admin";
  return false;
}

/** The roles `actor` may hand out, in the order a form offers them. */
export function assignableRoles(actor: Role): Role[] {
  return ROLES.filter((role) => canManageRole(actor, role));
}

/** A platform admin chooses the operator per session; everyone else always works as their own. */
export function choosesOperator(role: Role): boolean {
  return role === "platform_admin";
}
