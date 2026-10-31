import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import { clearedSessionCookie, crossSiteWrite, readCookie, requestIsHttps, SESSION_COOKIE, sessionCookie } from "../lib/auth/cookies.ts";
import { hashPassword, passwordProblem, verifyPassword } from "../lib/auth/password.ts";
import { isPublicApi } from "../lib/auth/paths.ts";
import { publicOrigin, setPasswordLink } from "../lib/auth/request.ts";
import { assignableRoles, canManageRole, canManageUsers, choosesOperator, isRole } from "../lib/auth/roles.ts";
import { AUTH_DDL } from "../lib/auth/schema.ts";
import { AuthInputError, cleanDisplayName, cleanEmail, cleanLogin } from "../lib/auth/store.ts";
import { looksLikeToken, randomToken, tokenHash } from "../lib/auth/tokens.ts";

test("a password hash verifies the same password and nothing else", async () => {
  const stored = await hashPassword("correct horse battery");
  assert.match(stored, /^pbkdf2-sha256\$100000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.equal(await verifyPassword("correct horse battery", stored), true);
  assert.equal(await verifyPassword("correct horse batterY", stored), false);
  assert.notEqual(await hashPassword("correct horse battery"), stored, "every hash has its own salt");
});

test("an unreadable or foreign stored hash never verifies and never throws", async () => {
  for (const stored of [null, undefined, "", "plain", "md5$1$a$b", "pbkdf2-sha256$x$a$b", "pbkdf2-sha256$999999$AAAA$AAAA", "pbkdf2-sha256$1000$%%%$%%%"]) {
    assert.equal(await verifyPassword("anything", stored), false, String(stored));
  }
});

test("weak passwords are refused with a reason", () => {
  assert.match(passwordProblem("short", "ram") ?? "", /at least 10/);
  assert.match(passwordProblem("aaaaaaaaaaaa", "ram") ?? "", /too few different/);
  assert.match(passwordProblem("Rameshkumar1", "rameshkumar1") ?? "", /user name/);
  assert.equal(passwordProblem("monsoon in mumbai 2026", "ramesh"), null);
});

test("tokens are random, URL-safe, and stored only as a SHA-256", async () => {
  const one = randomToken();
  const two = randomToken();
  assert.notEqual(one, two);
  assert.equal(looksLikeToken(one), true);
  for (const bad of ["", "short", "has space in it but long enough", "x".repeat(101), 42, null]) assert.equal(looksLikeToken(bad), false);
  const hash = await tokenHash(one);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(await tokenHash(one), hash);
});

test("the session cookie is HttpOnly and SameSite=Lax, and Secure over HTTPS", () => {
  const plain = sessionCookie("tok", false);
  assert.match(plain, new RegExp(`^${SESSION_COOKIE}=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=\\d+$`));
  assert.match(sessionCookie("tok", true), /; Secure$/);
  assert.match(clearedSessionCookie(true), /Max-Age=0; Secure$/);
  assert.equal(readCookie("a=1; swfa_session=abc; b=2", SESSION_COOKIE), "abc");
  assert.equal(readCookie("xswfa_session=abc", SESSION_COOKIE), null);
  assert.equal(readCookie(null, SESSION_COOKIE), null);
  // Behind Cloudflare Tunnel the app hears HTTP; the forwarded protocol is what the browser used.
  assert.equal(requestIsHttps(new Request("http://rishabh-web:3000/", { headers: { "x-forwarded-proto": "https" } })), true);
  assert.equal(requestIsHttps(new Request("http://localhost:4101/")), false);
});

test("a write naming another origin is cross-site; reads and same-site writes are not", () => {
  const at = (method: string, origin?: string) => new Request("http://app.example/api/x", { method, headers: origin ? { origin } : {} });
  assert.equal(crossSiteWrite(at("POST", "https://evil.example")), true);
  assert.equal(crossSiteWrite(at("POST", "http://app.example")), false);
  assert.equal(crossSiteWrite(at("POST")), false);
  assert.equal(crossSiteWrite(at("GET", "https://evil.example")), false);
});

test("only the sign-in calls, health and the browser error report are public", () => {
  assert.equal(isPublicApi("/api/health", "GET"), true);
  assert.equal(isPublicApi("/api/auth/login", "POST"), true);
  assert.equal(isPublicApi("/api/auth/login/", "POST"), true);
  assert.equal(isPublicApi("/api/auth/login", "GET"), false);
  assert.equal(isPublicApi("/api/auth/set-password", "GET"), true);
  assert.equal(isPublicApi("/api/client-log", "POST"), true);
  assert.equal(isPublicApi("/api/client-log", "GET"), false);
  for (const path of ["/api/auth/me", "/api/auth/users", "/api/auth/operator", "/api/operators", "/api/companies", "/api/master-program", "/api/legacy/startup", "/api/db/test"]) {
    assert.equal(isPublicApi(path, "GET"), false, path);
    assert.equal(isPublicApi(path, "POST"), false, path);
  }
});

test("roles: platform admins manage everyone, company admins everyone but platform admins, employees no one", () => {
  assert.equal(isRole("company_admin"), true);
  assert.equal(isRole("root"), false);
  assert.deepEqual(assignableRoles("platform_admin"), ["platform_admin", "company_admin", "employee"]);
  assert.deepEqual(assignableRoles("company_admin"), ["company_admin", "employee"]);
  assert.deepEqual(assignableRoles("employee"), []);
  assert.equal(canManageRole("company_admin", "platform_admin"), false);
  assert.equal(canManageUsers("employee"), false);
  assert.equal(choosesOperator("platform_admin"), true);
  assert.equal(choosesOperator("company_admin"), false);
});

test("user names, emails and names are checked before they reach the database", () => {
  assert.equal(cleanLogin("  RAMESH "), "RAMESH");
  assert.equal(cleanLogin("pranavcomputers@gmail.com"), "pranavcomputers@gmail.com");
  for (const bad of ["ab", "has space", "semi;colon", "", 7]) assert.throws(() => cleanLogin(bad), AuthInputError);
  assert.equal(cleanEmail(" PranavComputers@Gmail.com "), "pranavcomputers@gmail.com");
  assert.equal(cleanEmail(""), null);
  assert.throws(() => cleanEmail("not-an-email"), AuthInputError);
  assert.equal(cleanDisplayName("  Ramesh   Kumar ", "x"), "Ramesh Kumar");
  assert.equal(cleanDisplayName("", "RAMESH"), "RAMESH");
});

test("set-password links carry the token in the fragment, never the query", () => {
  assert.equal(setPasswordLink("https://rishabh-plastic.smartwinfa.com", "abc"), "https://rishabh-plastic.smartwinfa.com/set-password#token=abc");
  const previous = process.env.SMARTWINFA_PUBLIC_URL;
  delete process.env.SMARTWINFA_PUBLIC_URL;
  try {
    const request = new Request("http://rishabh-web:3000/api/auth/users", { headers: { host: "rishabh-plastic.smartwinfa.com", "x-forwarded-proto": "https" } });
    assert.equal(publicOrigin(request), "https://rishabh-plastic.smartwinfa.com");
    process.env.SMARTWINFA_PUBLIC_URL = "https://books.example.com/";
    assert.equal(publicOrigin(request), "https://books.example.com");
  } finally {
    if (previous === undefined) delete process.env.SMARTWINFA_PUBLIC_URL;
    else process.env.SMARTWINFA_PUBLIC_URL = previous;
  }
});

test("the auth tables can be created again and again", () => {
  for (const statement of AUTH_DDL) assert.match(statement, /IF NOT EXISTS/, statement.slice(0, 60));
  assert.ok(AUTH_DDL.some((statement) => /app_user_login_key ON web_auth\.app_user \(lower\(login\)\)/.test(statement)), "user names are unique without regard to case");
});

function routes(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = `${directory}/${name}`;
    return statSync(path).isDirectory() ? routes(path) : name === "route.ts" ? [path] : [];
  });
}

test("no route trusts an operator named by the browser, or the old development switch", () => {
  const all = routes(new URL("../app/api", import.meta.url).pathname);
  assert.ok(all.length > 30);
  for (const path of all) {
    const code = readFileSync(path, "utf8");
    assert.doesNotMatch(code, /body\.session\.loginName|body\??\.loginName|searchParams\.get\("login"\)/, path);
    assert.doesNotMatch(code, /trustedDevelopmentEnabled|SMARTWINFA_SKIP_LOGIN/, path);
    if (/SessionKey = \{/.test(code)) assert.match(code, /loginName: operator/, path);
  }
  const middleware = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
  assert.match(middleware, /matcher: \["\/api\/:path\*"\]/);
});
