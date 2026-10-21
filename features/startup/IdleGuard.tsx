"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { companyLicence } from "../../lib/company-license";

/**
 * Idle handling for the main menu.
 *
 * Auto-logoff (Main_Menu_New Timer1_Tick): for the licences that have it, no mouse or key for AUTO_LOGOFF seconds ends the session, and the
 * operator is back at the login (the desktop closes the program). Every other licence gets the screen saver: after SAVER_AFTER_SECONDS idle
 * (or the Lock button) a full-screen clock covers the work, which stays open behind it, and the operator's password brings it back.
 */

/** Seconds of no activity before the desktop logs the operator off, by licence (0: the licence has no auto-logoff). */
export function autoLogoffSeconds(licence: number): number {
  if ([5, 9, 89, 90].includes(licence)) return 300;
  if ([65, 66, 67, 72, 77].includes(licence)) return 60;
  if ([17, 53, 60].includes(licence)) return 180;
  return 0;
}

const SAVER_AFTER_SECONDS = 600;

export function IdleGuard({ companyGroup, loginName, locked, onLock, onUnlock, onLogoff }: {
  companyGroup: string | null;
  loginName: string;
  locked: boolean;
  onLock: () => void;
  onUnlock: () => void;
  onLogoff: () => void;
}) {
  const logoffAfter = autoLogoffSeconds(companyLicence(companyGroup));
  const last = useRef(0);
  const lockedNow = useRef(locked);
  useEffect(() => { lockedNow.current = locked; }, [locked]);

  useEffect(() => {
    last.current = Date.now();
    const touch = () => { if (!lockedNow.current) last.current = Date.now(); };
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    for (const name of events) window.addEventListener(name, touch, { capture: true, passive: true });
    const timer = window.setInterval(() => {
      const idle = (Date.now() - last.current) / 1000;
      if (logoffAfter > 0) { if (idle >= logoffAfter) onLogoff(); }
      else if (!lockedNow.current && idle >= SAVER_AFTER_SECONDS) { last.current = Date.now(); onLock(); }
    }, 1000);
    return () => {
      for (const name of events) window.removeEventListener(name, touch, { capture: true });
      window.clearInterval(timer);
    };
  }, [logoffAfter, onLock, onLogoff]);

  if (!locked) return null;
  return <ScreenSaver loginName={loginName} onUnlock={() => { last.current = Date.now(); onUnlock(); }} onLogoff={onLogoff} />;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** The cover: a clock that drifts about the screen, and the password box that lifts it. */
function ScreenSaver({ loginName, onUnlock, onLogoff }: { loginName: string; onUnlock: () => void; onLogoff: () => void }) {
  const [now, setNow] = useState(() => new Date());
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  const cover = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  // The work behind the cover must not keep the keyboard.
  useEffect(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    cover.current?.focus();
  }, []);
  useEffect(() => { if (asking) box.current?.focus(); }, [asking]);

  const unlock = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/unlock", { method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", body: JSON.stringify({ loginName, password }) });
      const body = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok) throw new Error(body.error || "The password could not be checked");
      if (body.ok) { setPassword(""); onUnlock(); return; }
      setError("Incorrect User Password... Enter Again");
      setPassword("");
      box.current?.focus();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The password could not be checked");
    } finally {
      setBusy(false);
    }
  }, [busy, loginName, password, onUnlock]);

  // The clock drifts: a new place every half minute (so the cover never keeps one image on the screen).
  const slot = Math.floor(now.getTime() / 30000);
  const left = 10 + ((slot * 37) % 55);
  const top = 12 + ((slot * 53) % 55);
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the whole cover wakes to the password box on any click or key
    <div ref={cover} className="saver" role="dialog" aria-modal="true" aria-label="Screen locked" tabIndex={-1}
      onPointerDown={() => setAsking(true)} onKeyDown={(event) => { if (!asking && event.key !== "Tab") setAsking(true); }}>
      {!asking && (
        <div className="saver-clock" style={{ left: `${left}%`, top: `${top}%` }}>
          <b>{pad(now.getHours())}:{pad(now.getMinutes())}</b>
          <span>{now.toLocaleDateString(undefined, { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</span>
          <small>Locked — click or press a key</small>
        </div>
      )}
      {asking && (
        <form className="saver-box" onPointerDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); void unlock(); }}>
          <strong>SMARTwinFA is locked</strong>
          <span>User: {loginName}</span>
          <input ref={box} type="password" autoComplete="current-password" aria-label="Password" placeholder="Password" value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} />
          {error && <p role="alert">{error}</p>}
          <div>
            <button type="submit" className="mp-btn mp-btn-green" disabled={busy}>Unlock</button>
            <button type="button" className="mp-btn mp-btn-red" disabled={busy} onClick={onLogoff} title="Log out (unsaved work is lost)">Log out</button>
          </div>
        </form>
      )}
    </div>
  );
}
