"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStartupSelection } from "../startup/StartupGate";
import { useWindowActive, useWindowCloser } from "../ui/activeWindow";
import { Icon } from "../ui/Icon";
import { messageBox } from "../ui/MessageBox";
import type { SecurityRow, SecurityUser } from "../../lib/security-rights";

/** The seven rights of a row, in the order the server keeps them (lib/security-rights.ts). */
const RIGHTS = ["Allow", "Add", "Edit", "Delete", "View", "Print", "Export"] as const;

/**
 * Setup > Security > Menu Book Rights (Setup_Security.cs): pick a user, and every menu and book of the program is a row with Allow, Add,
 * Edit, Delete, View, Print and Export, each with its own password (nine characters at most; a saved password shows as ********* and is
 * changed by typing over it). "Copy New User Name" saves the rights shown to a new user who has none yet. Save asks, then writes every row.
 */

const MASK = "*********";
const NONE = 0;

type PasswordCell = { typed: string | null; had: boolean };
type GridRow = SecurityRow & { rightsNow: boolean[]; passwordNow: PasswordCell[] };

async function securityCall<T>(selection: { companyId: string | number; yearKey: number; loginName: string }, menuShortName: string, action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch("/api/security-rights", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ action, menuShortName, session: { companyId: Number(selection.companyId), yearKey: selection.yearKey, loginName: selection.loginName }, ...payload }),
  });
  const body = await response.json() as T & { error?: string };
  if (!response.ok || body.error) throw new Error(body.error || `Security request ${action} failed`);
  return body;
}

export function SecurityRights({ menuShortName, title, onClose }: { menuShortName: string; title: string; onClose: () => void }) {
  const selection = useStartupSelection();
  const active = useWindowActive();
  const [users, setUsers] = useState<SecurityUser[]>([]);
  const [userNo, setUserNo] = useState(0);
  const [copyNo, setCopyNo] = useState(NONE);
  const [rows, setRows] = useState<GridRow[] | null>(null);
  const [busy, setBusy] = useState("Loading");
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const combo = useRef<HTMLSelectElement>(null);

  const say = useCallback((text: string, heading = title) => messageBox.alert(text, heading), [title]);
  const ask = useCallback((text: string, heading: string, buttons: ("Yes" | "No" | "Cancel")[], defaultButton?: "Yes" | "No" | "Cancel") => messageBox.ask(text, heading, buttons, { defaultButton }), []);

  useEffect(() => {
    if (!selection) return;
    let live = true;
    securityCall<{ users: SecurityUser[] }>(selection, menuShortName, "users")
      .then((result) => { if (live) { setUsers(result.users); setBusy(""); } })
      .catch((error: unknown) => { if (live) { setBusy(""); void say(error instanceof Error ? error.message : String(error), "INTERNAL PROGRAM FAILURE"); } });
    return () => { live = false; };
  }, [selection, menuShortName, say]);

  const chooseUser = async (value: number) => {
    setUserNo(value);
    setCopyNo(NONE);
    if (!selection || value <= 0) { setRows(null); return; }
    setBusy("Loading");
    try {
      const result = await securityCall<{ rows: SecurityRow[] }>(selection, menuShortName, "rows", { userNo: value });
      setRows(result.rows.map((row) => ({ ...row, rightsNow: [...row.rights], passwordNow: row.passwords.map((had) => ({ typed: null, had })) })));
      setCursor(0);
    } catch (error) {
      setRows(null);
      await say(error instanceof Error ? error.message : String(error), "INTERNAL PROGRAM FAILURE");
    } finally {
      setBusy("");
    }
  };

  const clear = () => { setRows(null); setUserNo(0); setCopyNo(NONE); requestAnimationFrame(() => combo.current?.focus()); };

  const quit = useCallback(async () => {
    if ((await ask("Are You Sure Want TO Quit Security Entry ?", "Security Entry Quit", ["Yes", "No"], "No")) === "Yes") onClose();
  }, [ask, onClose]);
  useWindowCloser(quit);

  const cancel = async () => {
    if ((await ask("Are You Sure Want TO Cancel Security Entry ?", "Security Entry Cancel", ["Yes", "No"], "No")) === "Yes") clear();
  };

  const save = async () => {
    if (!rows || !selection) return;
    const answer = await ask("Do you want to save the changes ?", "Security Save", ["Yes", "No", "Cancel"]);
    if (answer === "No") { clear(); return; }
    if (answer !== "Yes") return;
    const tooLong = rows.find((row) => row.passwordNow.some((cell) => cell.typed !== null && cell.typed !== MASK && cell.typed.trim().length > 9));
    if (tooLong) { await say("Maximum Length of Column Must be 9 Charector", "Maximum Length"); return; }
    setBusy("Saving");
    try {
      const result = await securityCall<{ ok: boolean; message: string }>(selection, menuShortName, "save", {
        userNo,
        copyToNo: copyNo,
        rows: rows.map((row) => ({
          heading: row.heading,
          module: row.module,
          key: row.key,
          rights: row.rightsNow,
          typed: row.passwordNow.map((cell) => (cell.typed === null || cell.typed === MASK ? "" : cell.typed.trim())),
          keep: row.passwordNow.map((cell) => cell.typed === null || cell.typed === MASK ? cell.had : false),
        })),
      });
      if (!result.ok) { await say(result.message, "Copy Rights!!"); return; }
      clear();
      await say("Security rights saved", "Security Save");
    } catch (error) {
      await say(error instanceof Error ? error.message : String(error), "INTERNAL PROGRAM FAILURE");
    } finally {
      setBusy("");
    }
  };

  // Esc returns to the main menu (asked), in the window in front only.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!active.current || event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector(".msgbox-backdrop")) return;
      event.preventDefault();
      void ask("Returning To Main Menu ?", "Return", ["Yes", "No"]).then((answer) => { if (answer === "Yes") onClose(); });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, ask, onClose]);

  const setRight = (index: number, at: number, value: boolean) => setRows((current) => current && current.map((row, i) => (i === index ? { ...row, rightsNow: row.rightsNow.map((old, j) => (j === at ? value : old)) } : row)));
  const setPassword = (index: number, at: number, value: string) => setRows((current) => current && current.map((row, i) => (i === index ? { ...row, passwordNow: row.passwordNow.map((old, j) => (j === at ? { ...old, typed: value } : old)) } : row)));
  /** Ticks (or unticks) one right of every row, or with `at` null every right of every row. */
  const tickAll = (at: number | null, value: boolean) => setRows((current) => current && current.map((row) => ({ ...row, rightsNow: row.rightsNow.map((old, j) => (at === null || j === at ? value : old)) })));
  const columnState = (at: number) => { const ticked = (rows ?? []).filter((row) => row.rightsNow[at]).length; return ticked === 0 ? "none" : ticked === (rows ?? []).length ? "all" : "some"; };
  const everyTicked = rows !== null && rows.length > 0 && rows.every((row) => row.rightsNow.every(Boolean));
  const others = useMemo(() => users.filter((user) => user.no !== userNo), [users, userNo]);

  return (
    <div className="mp-screen sec-screen" ref={root} role="region" aria-label={title}>
      <div className="mp-combos sec-combos">
        <label className="sec-combo"><span>USER NAME</span>
          <select ref={combo} value={userNo} disabled={rows !== null || busy !== ""} onChange={(event) => void chooseUser(Number(event.target.value))} autoFocus>
            <option value={0}>— select —</option>
            {users.map((user) => <option key={user.no} value={user.no}>{user.name}</option>)}
          </select>
        </label>
        <label className="sec-combo"><span>COPY NEW USER NAME</span>
          <select value={copyNo} disabled={rows === null || busy !== ""} onChange={(event) => setCopyNo(Number(event.target.value))} title="Save the rights shown to this user, who must have none yet">
            <option value={NONE}>(none)</option>
            {others.map((user) => <option key={user.no} value={user.no}>{user.name}</option>)}
          </select>
        </label>
        <button type="button" className="mp-btn mp-btn-blue" disabled={rows === null || busy !== ""} onClick={() => tickAll(null, !everyTicked)} title="Tick every right of every menu and book, or take all the ticks off">{everyTicked ? "Untick All" : "Tick All"}</button>
        {busy !== "" && <span className="mp-busy">{busy}…</span>}
        <span className="mp-heading">{title.toUpperCase()}</span>
      </div>
      <div className="sec-body">
        {rows === null ? (
          <p className="sec-empty">Select a user name to see and change the rights of every menu and book.</p>
        ) : (
          <table className="sec-grid">
            <thead>
              <tr>
                <th>Heading</th><th>Name</th>
                {RIGHTS.map((right) => <th key={right} colSpan={2}>{right}</th>)}
              </tr>
              <tr className="sec-sub"><th /><th />{RIGHTS.map((right, at) => [<th key={`${right}a`} className="sec-all"><label title={`Tick or untick ${right} for every row`}><input type="checkbox" aria-label={`Tick every ${right}`} title={`Tick or untick ${right} for every row`} checked={columnState(at) === "all"} ref={(box) => { if (box) box.indeterminate = columnState(at) === "some"; }} onChange={(event) => tickAll(at, event.target.checked)} /> All</label></th>, <th key={`${right}p`}>Password</th>])}</tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.module + index} className={`${index % 2 ? "sec-alt" : ""} ${index === cursor ? "sec-current" : ""} ${row.heading === "Book" ? "sec-book" : ""}`} onMouseDown={() => setCursor(index)}>
                  <td>{row.heading}</td>
                  <td className="sec-name" title={row.module}>{row.name}</td>
                  {RIGHTS.map((right, at) => {
                    const cell = row.passwordNow[at];
                    const shown = cell.typed !== null ? cell.typed : cell.had ? MASK : "";
                    return [
                      <td key={`${right}c`} className="sec-check"><input type="checkbox" aria-label={`${right} ${row.name}`} checked={row.rightsNow[at]} onChange={(event) => setRight(index, at, event.target.checked)} /></td>,
                      <td key={`${right}p`} className="sec-pass"><input type="text" autoComplete="off" aria-label={`${right} password ${row.name}`} value={shown} maxLength={shown === MASK ? undefined : 9}
                        onFocus={(event) => { if (shown === MASK) event.currentTarget.select(); }}
                        onChange={(event) => { const next = event.target.value; setPassword(index, at, next.length > 9 && next !== MASK ? next.slice(0, 9) : next); }} /></td>,
                    ];
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="mp-buttons sec-buttons">
        <button type="button" className="mp-btn mp-btn-green" disabled={rows === null || busy !== ""} onClick={() => void save()}><Icon name="save" />Save</button>
        <button type="button" className="mp-btn mp-btn-red" disabled={rows === null || busy !== ""} onClick={() => void cancel()}><Icon name="cancel" />Cancel</button>
        <button type="button" className="mp-btn mp-btn-red" onClick={() => void quit()}><Icon name="quit" />Quit</button>
      </div>
    </div>
  );
}
