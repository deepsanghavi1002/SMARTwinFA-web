"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Users of this installation (app/api/auth/users). An admin adds a user, or onboards one of the
 * desktop's operators, and passes the set-password link on: no email is sent from here.
 */

type Role = "platform_admin" | "company_admin" | "employee";
type User = { id: number; login: string; email: string | null; displayName: string; role: Role; status: "invited" | "active" | "disabled"; operatorLogin: string | null; lastLoginAt: string | null };
type Operator = { loginName: string; displayName: string; userType: string | null; linkedUsers: string[] };
type Listing = { users: User[]; roles: Role[]; operators: Operator[]; me: number };
type Issued = { user: User; link: string; purpose: "invite" | "reset"; expiresHours: number };

const ROLE_LABELS: Record<Role, string> = { platform_admin: "Platform admin", company_admin: "Company admin", employee: "Employee" };
const STATUS_LABELS: Record<User["status"], string> = { invited: "Invited", active: "Active", disabled: "Disabled" };

async function call(body: Record<string, unknown>) {
  const response = await fetch("/api/auth/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({})) as Partial<Issued> & { error?: string };
  if (!response.ok) throw new Error(result.error || "The change could not be saved");
  return result;
}

function when(value: string | null) {
  return value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "never";
}

export default function UsersPage() {
  const [listing, setListing] = useState<Listing | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<Issued | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ login: "", displayName: "", email: "", role: "employee" as Role, operatorLogin: "" });
  const [onboardRole, setOnboardRole] = useState<Record<string, Role>>({});
  const [onboardEmail, setOnboardEmail] = useState<Record<string, string>>({});
  /** Bumped after every change, so the list reads again. */
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/users", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as Listing & { error?: string };
        if (response.status === 401) { setLoadError("Your session has ended. Sign in again."); return; }
        if (!response.ok) { setLoadError(body.error || "The users could not be read"); return; }
        setListing(body);
        setDraft((current) => ({ ...current, role: body.roles.includes(current.role) ? current.role : body.roles[body.roles.length - 1] }));
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setLoadError("The users could not be read right now");
      });
    return () => controller.abort();
  }, [version]);

  const run = async (body: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await call(body);
      if (result.link && result.user && result.purpose && result.expiresHours) {
        setIssued(result as Issued);
        setCopied(false);
      }
      setVersion((current) => current + 1);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The change could not be saved");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!issued) return;
    try { await navigator.clipboard.writeText(issued.link); setCopied(true); } catch { setCopied(false); }
  };

  if (loadError) {
    return <main className="user-admin"><h1>Users</h1><p className="user-admin-error" role="alert">{loadError}</p><Link href="/">Back to sign-in</Link></main>;
  }
  if (!listing) return <main className="user-admin"><p role="status">Loading users…</p></main>;

  const unlinked = listing.operators.filter((operator) => !operator.linkedUsers.length);
  const needsOperator = draft.role !== "platform_admin";

  return (
    <main className="user-admin">
      <header>
        <h1>Users</h1>
        <Link href="/">Back to SMARTwinFA</Link>
      </header>
      <p className="user-admin-note">
        Each user works in the books as a desktop operator: that operator&apos;s company, year and menu rights apply.
        New users get a one-time link to choose their password. Send it to them yourself, for example by email or WhatsApp.
      </p>

      {error && <p className="user-admin-error" role="alert">{error}</p>}
      {issued && (
        <section className="user-admin-link" aria-live="polite">
          <strong>{issued.purpose === "invite" ? "Invitation" : "Password reset"} link for {issued.user.displayName} ({issued.user.login})</strong>
          <div><input readOnly value={issued.link} onFocus={(event) => event.target.select()} /><button type="button" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button></div>
          <small>It works once, for {issued.expiresHours} hours. A new link replaces this one.</small>
        </section>
      )}

      <section>
        <h2>All users</h2>
        <div className="user-admin-table">
          <table>
            <thead><tr><th>User name</th><th>Name</th><th>Email</th><th>Role</th><th>Operator</th><th>Status</th><th>Last sign-in</th><th /></tr></thead>
            <tbody>
              {listing.users.map((user) => {
                const self = user.id === listing.me;
                const manageable = listing.roles.includes(user.role);
                return (
                  <tr key={user.id} className={user.status === "disabled" ? "disabled" : undefined}>
                    <td>{user.login}{self ? " (you)" : ""}</td>
                    <td>{user.displayName}</td>
                    <td>{user.email ?? ""}</td>
                    <td>
                      {manageable && !self ? (
                        <select value={user.role} disabled={busy} onChange={(event) => void run({ action: "update", userId: user.id, role: event.target.value })}>
                          {listing.roles.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                        </select>
                      ) : ROLE_LABELS[user.role]}
                    </td>
                    <td>
                      {manageable ? (
                        <select value={user.operatorLogin ?? ""} disabled={busy} onChange={(event) => void run({ action: "update", userId: user.id, operatorLogin: event.target.value })}>
                          {user.role === "platform_admin" ? <option value="">(chooses at sign-in)</option> : !user.operatorLogin && <option value="">(none)</option>}
                          {listing.operators.map((operator) => <option key={operator.loginName} value={operator.loginName}>{operator.loginName}</option>)}
                        </select>
                      ) : user.operatorLogin ?? ""}
                    </td>
                    <td>{STATUS_LABELS[user.status]}</td>
                    <td>{when(user.lastLoginAt)}</td>
                    <td className="actions">
                      {manageable && user.status !== "disabled" && <button type="button" disabled={busy} onClick={() => void run({ action: "link", userId: user.id })}>{user.status === "invited" ? "New invite link" : "Reset password"}</button>}
                      {manageable && !self && <button type="button" disabled={busy} onClick={() => void run({ action: user.status === "disabled" ? "enable" : "disable", userId: user.id })}>{user.status === "disabled" ? "Enable" : "Disable"}</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Add a user</h2>
        <form className="user-admin-form" onSubmit={async (event) => {
          event.preventDefault();
          if (await run({ action: "create", ...draft, operatorLogin: needsOperator ? draft.operatorLogin : draft.operatorLogin || undefined })) {
            setDraft({ login: "", displayName: "", email: "", role: draft.role, operatorLogin: "" });
          }
        }}>
          <label>User name<input required value={draft.login} onChange={(event) => setDraft({ ...draft, login: event.target.value })} placeholder="e.g. RAMESH or ramesh@company.com" /></label>
          <label>Name<input value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} placeholder="Shown in the app" /></label>
          <label>Email<input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} placeholder="optional; can be used to sign in" /></label>
          <label>Role
            <select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as Role })}>
              {listing.roles.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
            </select>
          </label>
          <label>Works as operator
            <select required={needsOperator} value={draft.operatorLogin} onChange={(event) => setDraft({ ...draft, operatorLogin: event.target.value })}>
              <option value="">{needsOperator ? "Choose…" : "(chooses at sign-in)"}</option>
              {listing.operators.map((operator) => <option key={operator.loginName} value={operator.loginName}>{operator.loginName} {operator.displayName !== operator.loginName ? `(${operator.displayName})` : ""}</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy}>Add and get link</button>
        </form>
      </section>

      <section>
        <h2>Bring in desktop operators</h2>
        <p className="user-admin-note">Operators from the old SMARTwinFA with no web user yet. Onboarding keeps their user name and rights; they set a new password from the link.</p>
        {!unlinked.length ? <p>Every operator has a web user.</p> : (
          <div className="user-admin-table">
            <table>
              <thead><tr><th>Operator</th><th>Name</th><th>Type</th><th>Email</th><th>Role</th><th /></tr></thead>
              <tbody>
                {unlinked.map((operator) => (
                  <tr key={operator.loginName}>
                    <td>{operator.loginName}</td>
                    <td>{operator.displayName}</td>
                    <td>{operator.userType ?? ""}</td>
                    <td><input type="email" placeholder="optional" value={onboardEmail[operator.loginName] ?? ""} onChange={(event) => setOnboardEmail({ ...onboardEmail, [operator.loginName]: event.target.value })} /></td>
                    <td>
                      <select value={onboardRole[operator.loginName] ?? "employee"} onChange={(event) => setOnboardRole({ ...onboardRole, [operator.loginName]: event.target.value as Role })}>
                        {listing.roles.filter((role) => role !== "platform_admin").map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                      </select>
                    </td>
                    <td className="actions">
                      <button type="button" disabled={busy} onClick={() => void run({ action: "onboard", operatorLogin: operator.loginName, role: onboardRole[operator.loginName] ?? "employee", email: onboardEmail[operator.loginName] ?? "" })}>Onboard and get link</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
