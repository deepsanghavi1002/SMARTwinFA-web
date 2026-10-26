/**
 * Creates a web user (or finds an existing one) and prints a one-time set-password link.
 * It is how the first platform admin of an installation gets in; after that, admins use the
 * Users screen. Run it inside the client's web container, which has the database settings:
 *
 *   docker exec <client>-web node scripts/auth-invite.mts pranavcomputers@gmail.com --url https://<client>.smartwinfa.com
 *
 * Options: --role platform_admin|company_admin|employee (default platform_admin)
 *          --operator <desktop login>   required for company_admin and employee
 *          --name "<display name>"   --email <address>   --url <public address>  (or SMARTWINFA_PUBLIC_URL)
 *
 * The link is printed here only: it is never logged or stored, and only its hash is kept.
 */
import { transaction } from "../lib/db.ts";
import { setPasswordLink } from "../lib/auth/request.ts";
import { isRole, type Role } from "../lib/auth/roles.ts";
import { ensureAuthSchema } from "../lib/auth/schema.ts";
import {
  activeOperatorLogin, audit, cleanDisplayName, cleanEmail, cleanLogin, createUser, findUserForLogin, issuePasswordToken, TOKEN_HOURS,
} from "../lib/auth/store.ts";

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const options: Record<string, string> = {};
const positional: string[] = [];
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (arg.startsWith("--")) {
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) fail(`${arg} needs a value`);
    options[arg.slice(2)] = value;
    index++;
  } else positional.push(arg);
}
const who = positional[0]?.trim();
if (!who || positional.length > 1) {
  fail("usage: node scripts/auth-invite.mts <user name or email> [--role R] [--operator LOGIN] [--name NAME] [--email EMAIL] [--url URL]");
}
const role: Role = options.role === undefined ? "platform_admin" : isRole(options.role) ? options.role : fail(`unknown role ${options.role}`);
const origin = (options.url ?? process.env.SMARTWINFA_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
if (!/^https?:\/\/[^/\s]+$/.test(origin)) fail("give the address users open, e.g. --url https://rishabh-plastic.smartwinfa.com");

try {
  await transaction(ensureAuthSchema, { timeoutMs: 15000 });
  const result = await transaction(async (client) => {
    const found = await findUserForLogin(client, who);
    let user = found?.user;
    if (user) {
      if (user.status === "disabled") throw new Error(`${user.login} is disabled; enable them on the Users screen first`);
      console.log(`${user.login} already exists (${user.role}, ${user.status}); issuing a new link.`);
    } else {
      const email = cleanEmail(options.email ?? (who.includes("@") ? who : ""));
      let operatorLogin: string | null = null;
      if (options.operator) {
        operatorLogin = await activeOperatorLogin(client, options.operator);
        if (!operatorLogin) throw new Error(`the operator ${options.operator} is not present in the company system database`);
      } else if (role !== "platform_admin") {
        throw new Error(`a ${role} must be linked to an operator: add --operator <desktop login>`);
      }
      user = await createUser(client, { login: cleanLogin(who), email, displayName: cleanDisplayName(options.name, who), role, operatorLogin }, null);
      await audit(client, null, "user.created", user.id, { role, operator: operatorLogin, by: "auth-invite" });
      console.log(`Created ${user.login} (${role}${operatorLogin ? `, operator ${operatorLogin}` : ""}).`);
    }
    const purpose = user.status === "invited" ? "invite" : "reset";
    const token = await issuePasswordToken(client, user.id, purpose, null);
    await audit(client, null, `link.${purpose}`, user.id, { by: "auth-invite" });
    return { link: setPasswordLink(origin, token), hours: TOKEN_HOURS[purpose] };
  }, { timeoutMs: 15000 });
  console.log(`\nSet-password link (works once, for ${result.hours} hours):\n\n  ${result.link}\n`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
