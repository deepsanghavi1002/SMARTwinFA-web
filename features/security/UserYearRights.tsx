"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStartupSelection } from "../startup/StartupGate";
import { useWindowActive, useWindowCloser } from "../ui/activeWindow";
import { Icon } from "../ui/Icon";
import { messageBox } from "../ui/MessageBox";
import type { YearUser } from "../../lib/user-year-rights";

/**
 * Setup > Security > User Year Rights (Utility_User_Year_Rights.cs): pick a user and tick the financial years the user may open.
 */

async function yearCall<T>(selection: { companyId: string | number; yearKey: number; loginName: string }, menuShortName: string, action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch("/api/user-year-rights", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ action, menuShortName, session: { companyId: Number(selection.companyId), yearKey: selection.yearKey, loginName: selection.loginName }, ...payload }),
  });
  const body = await response.json() as T & { error?: string };
  if (!response.ok || body.error) throw new Error(body.error || `Request ${action} failed`);
  return body;
}

export function UserYearRights({ menuShortName, title, onClose }: { menuShortName: string; title: string; onClose: () => void }) {
  const selection = useStartupSelection();
  const active = useWindowActive();
  const [users, setUsers] = useState<YearUser[]>([]);
  const [userNo, setUserNo] = useState(0);
  const [years, setYears] = useState<string[] | null>(null);
  const [allowed, setAllowed] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState("Loading");
  const [cursor, setCursor] = useState(0);
  const combo = useRef<HTMLSelectElement>(null);

  const say = useCallback((text: string, heading = title) => messageBox.alert(text, heading), [title]);
  const ask = useCallback((text: string, heading: string, defaultButton: "Yes" | "No" = "No") => messageBox.ask(text, heading, ["Yes", "No"], { defaultButton }), []);

  useEffect(() => {
    if (!selection) return;
    let live = true;
    yearCall<{ users: YearUser[] }>(selection, menuShortName, "users")
      .then((result) => { if (live) { setUsers(result.users); setBusy(""); } })
      .catch((error: unknown) => { if (live) { setBusy(""); void say(error instanceof Error ? error.message : String(error), "INTERNAL PROGRAM FAILURE"); } });
    return () => { live = false; };
  }, [selection, menuShortName, say]);

  const chooseUser = async (value: number) => {
    setUserNo(value);
    if (!selection || value <= 0) { setYears(null); return; }
    setBusy("Loading");
    try {
      const result = await yearCall<{ years: string[]; allowed: string[] }>(selection, menuShortName, "load", { userNo: value });
      setYears(result.years);
      setAllowed(new Set(result.allowed));
      setCursor(0);
    } catch (error) {
      setYears(null);
      await say(error instanceof Error ? error.message : String(error), "INTERNAL PROGRAM FAILURE");
    } finally {
      setBusy("");
    }
  };

  const clear = () => { setYears(null); setUserNo(0); setAllowed(new Set()); requestAnimationFrame(() => combo.current?.focus()); };

  const quit = useCallback(async () => {
    if ((await ask("Are You Sure Want To Quit ?", "User Year Rights Quit")) === "Yes") onClose();
  }, [ask, onClose]);
  useWindowCloser(quit);

  const update = async () => {
    if (!years || !selection) return;
    if ((await ask("Are You Sure Want To Update User Year Rights ?", "User Year Rights Update")) !== "Yes") return;
    setBusy("Saving");
    try {
      await yearCall(selection, menuShortName, "save", { userNo, years: years.filter((year) => allowed.has(year)) });
      clear();
      await say("Record Updated...", "User Year Rights Update");
    } catch (error) {
      await say(error instanceof Error ? error.message : String(error), "INTERNAL PROGRAM FAILURE");
    } finally {
      setBusy("");
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!active.current || event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector(".msgbox-backdrop")) return;
      event.preventDefault();
      void quit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, quit]);

  const tick = (year: string, value: boolean) => setAllowed((current) => { const next = new Set(current); if (value) next.add(year); else next.delete(year); return next; });
  const every = years ?? [];
  const allTicked = every.length > 0 && every.every((year) => allowed.has(year));
  const someTicked = every.some((year) => allowed.has(year));

  return (
    <div className="mp-screen sec-screen" role="region" aria-label={title}>
      <div className="mp-combos sec-combos">
        <label className="sec-combo"><span>SELECT USER »»</span>
          <select ref={combo} value={userNo} disabled={years !== null || busy !== ""} onChange={(event) => void chooseUser(Number(event.target.value))} autoFocus>
            <option value={0}>— select —</option>
            {users.map((user) => <option key={user.no} value={user.no}>{user.name}</option>)}
          </select>
        </label>
        {busy !== "" && <span className="mp-busy">{busy}…</span>}
        <span className="mp-heading">{title.toUpperCase()}</span>
      </div>
      <div className="sec-body">
        {years === null ? (
          <p className="sec-empty">Select a user to choose the years the user may open.</p>
        ) : (
          <table className="sec-grid">
            <thead>
              <tr>
                <th>Year</th>
                <th><label className="sec-all" title="Tick or untick every year"><input type="checkbox" checked={allTicked} ref={(box) => { if (box) box.indeterminate = someTicked && !allTicked; }} onChange={(event) => setAllowed(event.target.checked ? new Set(every) : new Set())} /> Allow</label></th>
              </tr>
            </thead>
            <tbody>
              {years.map((year, index) => (
                <tr key={year} className={`${index % 2 ? "sec-alt" : ""} ${index === cursor ? "sec-current" : ""}`} onMouseDown={() => setCursor(index)}>
                  <td className="sec-name">{year}</td>
                  <td className="sec-check"><input type="checkbox" aria-label={`Allow ${year}`} checked={allowed.has(year)} onChange={(event) => tick(year, event.target.checked)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="mp-buttons sec-buttons">
        <button type="button" className="mp-btn mp-btn-green" disabled={years === null || busy !== ""} onClick={() => void update()}><Icon name="save" />Update</button>
        <button type="button" className="mp-btn mp-btn-red" disabled={years === null || busy !== ""} onClick={clear}><Icon name="cancel" />Cancel</button>
        <button type="button" className="mp-btn mp-btn-red" onClick={() => void quit()}><Icon name="quit" />Quit</button>
      </div>
    </div>
  );
}
