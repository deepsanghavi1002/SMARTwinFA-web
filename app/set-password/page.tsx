"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Opened from an invitation or reset link: /set-password#token=…  The token is read from the
 * fragment, which the browser never sends to a server, then dropped from the address bar so it
 * is not left in the history. Setting the password signs the user in and opens the app.
 */

type Link = { valid: boolean; purpose?: "invite" | "reset"; login?: string; displayName?: string; error?: string };

export default function SetPasswordPage() {
  const token = useRef("");
  const [link, setLink] = useState<Link | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const found = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token") ?? "";
    window.history.replaceState(null, "", window.location.pathname);
    token.current = found;
    const check: Promise<Link> = found
      ? fetch("/api/auth/set-password", { headers: { "x-set-password-token": found }, cache: "no-store" }).then((response) => response.json() as Promise<Link>)
      : Promise.resolve({ valid: false, error: "This link is incomplete. Open the full link you were sent." });
    check
      .catch((): Link => ({ valid: false, error: "The link could not be checked right now" }))
      .then(setLink);
  }, []);

  const save = async () => {
    if (saving) return;
    if (password !== confirm) { setError("The two passwords are not the same"); return; }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token.current, password }),
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(body.error || "The password could not be set"); return; }
      window.location.replace("/");
    } catch {
      setError("The password could not be set right now");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="startup-desktop">
      <section className="login-window" aria-label="Set your password">
        <div className="startup-title">Smart-WinFA</div>
        <div className="login-panel">
          <h1>{link?.purpose === "reset" ? "Choose a new password" : "Set your password"}</h1>
          {!link && <p role="status">Checking the link…</p>}
          {link && !link.valid && <p className="login-error" role="alert">{link.error}</p>}
          {link?.valid && (
            <form className="set-password-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
              <p>Welcome, {link.displayName}. You will sign in as <strong>{link.login}</strong>.</p>
              <input type="text" name="username" autoComplete="username" value={link.login ?? ""} readOnly hidden />
              <label>New password:<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
              <label>Again:<input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
              <small>At least 10 characters. A short sentence is easy to remember and hard to guess.</small>
              <p className="login-error" role="alert">{error}</p>
              <button className="login-button" type="submit" disabled={saving}><span>➜</span> Save and sign in</button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
