import type { Client } from "pg";
import { transaction } from "@/lib/db";
import { readOperators } from "@/lib/company-menu";
import { publicOrigin, setPasswordLink, currentUser, signInRequired } from "@/lib/auth/request";
import { assignableRoles, canManageRole, canManageUsers, isRole, type Role } from "@/lib/auth/roles";
import {
  activeOperatorLogin, audit, AuthInputError, cleanDisplayName, cleanEmail, cleanLogin, createUser, findUserById,
  issuePasswordToken, listUsers, revokeUserSessions, TOKEN_HOURS, updateUser, type AuthUser, type SessionUser,
} from "@/lib/auth/store";

/**
 * User administration for platform and company admins.
 *
 * GET   the users, the roles this admin may hand out, and the legacy operators (with who is linked to each).
 * POST  { action: "create", login, email?, displayName?, role, operatorLogin? }  a new user and their set-password link
 *       { action: "onboard", operatorLogin, email?, role? }                     a web user for an existing desktop operator
 *       { action: "link", userId }                                              a fresh set-password link (invite or reset)
 *       { action: "disable" | "enable", userId }
 *       { action: "update", userId, role?, operatorLogin?, displayName?, email? }
 *
 * No email is sent: the admin passes the link on. A company admin never sees or touches a platform admin.
 */

const headers = { "cache-control": "no-store" };

type Body = Readonly<{
  action?: unknown; userId?: unknown; login?: unknown; email?: unknown; displayName?: unknown; role?: unknown; operatorLogin?: unknown;
}>;

class Refusal extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = "Refusal"; }
}

function visibleTo(actor: SessionUser, user: AuthUser) {
  return canManageRole(actor.role, user.role) || user.id === actor.id;
}

/** A role-holder below platform admin works in the books, so they must be linked to an operator that exists. */
async function operatorFor(client: Client, role: Role, value: unknown): Promise<string | null> {
  const wanted = typeof value === "string" ? value.trim() : "";
  if (!wanted) {
    if (role === "platform_admin") return null;
    throw new Refusal("Link the user to an operator: the operator's rights decide what they may open");
  }
  const found = await activeOperatorLogin(client, wanted);
  if (!found) throw new Refusal(`The operator ${wanted} is not present in the company system database`);
  return found;
}

async function managedUser(client: Client, actor: SessionUser, value: unknown): Promise<AuthUser> {
  const id = Number(value);
  const user = Number.isInteger(id) ? await findUserById(client, id) : null;
  if (!user || !visibleTo(actor, user)) throw new Refusal("The user was not found", 404);
  if (!canManageRole(actor.role, user.role)) throw new Refusal("You may not change this user", 403);
  return user;
}

async function linkFor(client: Client, actor: SessionUser, user: AuthUser, origin: string) {
  const purpose = user.status === "invited" ? "invite" : "reset";
  const token = await issuePasswordToken(client, user.id, purpose, actor.id);
  await audit(client, actor.id, `link.${purpose}`, user.id);
  return { link: setPasswordLink(origin, token), purpose, expiresHours: TOKEN_HOURS[purpose] };
}

export async function GET(request: Request) {
  try {
    const actor = await currentUser(request);
    if (!actor) return signInRequired(headers);
    if (!canManageUsers(actor.role)) return Response.json({ error: "Only an administrator manages users" }, { status: 403, headers });
    const users = (await transaction(listUsers, { readOnlyWork: true, timeoutMs: 5000 })).filter((user) => visibleTo(actor, user));
    const linked = new Map<string, string[]>();
    for (const user of users) {
      if (!user.operatorLogin) continue;
      const key = user.operatorLogin.toUpperCase();
      linked.set(key, [...(linked.get(key) ?? []), user.login]);
    }
    const operators = (await readOperators()).map((operator) => ({ ...operator, linkedUsers: linked.get(operator.loginName.toUpperCase()) ?? [] }));
    return Response.json({ users, roles: assignableRoles(actor.role), operators, me: actor.id }, { headers });
  } catch (error) {
    console.error("User list error:", error instanceof Error ? error.message : error);
    return Response.json({ error: "The users could not be read right now" }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return Response.json({ error: "The request body is not JSON" }, { status: 400, headers });
  }
  try {
    const actor = await currentUser(request);
    if (!actor) return signInRequired(headers);
    if (!canManageUsers(actor.role)) return Response.json({ error: "Only an administrator manages users" }, { status: 403, headers });
    const origin = publicOrigin(request);

    const result = await transaction(async (client) => {
      switch (body?.action) {
        case "create":
        case "onboard": {
          const role: Role = body.action === "onboard" && body.role === undefined ? "employee" : isRole(body.role) ? body.role : (() => { throw new Refusal("Choose a role"); })();
          if (!canManageRole(actor.role, role)) throw new Refusal("You may not create a user with this role", 403);
          const operatorLogin = await operatorFor(client, role, body.operatorLogin);
          // Onboarding keeps the desktop's user name, so people sign in with the name they already know.
          const login = cleanLogin(body.action === "onboard" ? operatorLogin : body.login);
          const operatorName = operatorLogin ? (await readOperators()).find((operator) => operator.loginName === operatorLogin)?.displayName : undefined;
          const user = await createUser(client, {
            login,
            email: cleanEmail(body.email),
            displayName: cleanDisplayName(body.displayName, operatorName ?? login),
            role,
            operatorLogin,
          }, actor.id);
          await audit(client, actor.id, body.action === "onboard" ? "user.onboarded" : "user.created", user.id, { role, operator: operatorLogin });
          return { user, ...await linkFor(client, actor, user, origin) };
        }
        case "link": {
          const user = await managedUser(client, actor, body.userId);
          if (user.status === "disabled") throw new Refusal("Enable the user before sending a new link");
          return { user, ...await linkFor(client, actor, user, origin) };
        }
        case "disable":
        case "enable": {
          const user = await managedUser(client, actor, body.userId);
          if (user.id === actor.id) throw new Refusal("You cannot disable or enable yourself");
          const changed = await updateUser(client, user.id, { status: body.action === "disable" ? "disabled" : "active" });
          if (body.action === "disable") await revokeUserSessions(client, user.id);
          await audit(client, actor.id, `user.${body.action}d`, user.id);
          return { user: changed };
        }
        case "update": {
          const user = await managedUser(client, actor, body.userId);
          const role = body.role === undefined ? user.role : isRole(body.role) ? body.role : (() => { throw new Refusal("Unknown role"); })();
          if (role !== user.role && user.id === actor.id) throw new Refusal("You cannot change your own role");
          if (!canManageRole(actor.role, role)) throw new Refusal("You may not give this role", 403);
          const operatorLogin = body.operatorLogin === undefined && role === user.role
            ? undefined
            : await operatorFor(client, role, body.operatorLogin === undefined ? user.operatorLogin : body.operatorLogin);
          const changed = await updateUser(client, user.id, {
            role,
            operatorLogin,
            displayName: body.displayName === undefined ? undefined : cleanDisplayName(body.displayName, user.displayName),
            email: body.email === undefined ? undefined : cleanEmail(body.email),
          });
          // A new role or operator changes what the user may open: their open sessions start again.
          if (role !== user.role || (operatorLogin !== undefined && operatorLogin !== user.operatorLogin)) await revokeUserSessions(client, user.id);
          await audit(client, actor.id, "user.updated", user.id, { role, operator: changed.operatorLogin });
          return { user: changed };
        }
        default:
          throw new Refusal("Unknown action");
      }
    }, { timeoutMs: 10000 });
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof Refusal) return Response.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof AuthInputError) return Response.json({ error: error.message }, { status: 400, headers });
    console.error("User change error:", error instanceof Error ? error.message : error);
    return Response.json({ error: "The change could not be saved right now" }, { status: 503, headers });
  }
}
