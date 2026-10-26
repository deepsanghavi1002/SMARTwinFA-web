import { canManageUsers, choosesOperator, type Role } from "./roles.ts";
import type { AuthUser } from "./store.ts";

/** What the browser is told about a signed-in user: never the password hash, lock state or session. */
export type PublicUser = Readonly<{
  id: number;
  login: string;
  email: string | null;
  displayName: string;
  role: Role;
  canManageUsers: boolean;
  choosesOperator: boolean;
}>;

export function publicUser(user: AuthUser): PublicUser {
  return {
    id: user.id,
    login: user.login,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    canManageUsers: canManageUsers(user.role),
    choosesOperator: choosesOperator(user.role),
  };
}
