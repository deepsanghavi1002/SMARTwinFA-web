"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStartupSelection } from "../startup/StartupGate";
import { useWindowActive, useWindowCloser } from "../ui/activeWindow";
import { Icon } from "../ui/Icon";
import { messageBox } from "../ui/MessageBox";
import type { DashboardRightRow, DashboardUser } from "../../lib/user-dashboard-rights";

/**
 * Setup > Security > User Dashboard Rights (Utility_User_Dashboard_Rights.cs): pick a user and tick the dashboard blocks the user sees, with a
 * display order and the five colours (kept as "R,G,B"; the swatch opens a colour picker, as the desktop's double click does).
 */

const COLOURS = [
  ["dashboardColor", "Dashboard Color"], ["cardColor", "Card Color"], ["chartColor", "Chart Color"], ["gridColor", "Grid Color"], ["headerColor", "Header Color"],
] as const;

/** "R,G,B" or "#rrggbb" to "#rrggbb" for the picker (dark grey when empty or unreadable, like the desktop). */
function toHex(text: string): string {
  const value = text.trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length === 3 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) return `#${parts.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
  return "#181b22";
}
const toRgb = (hex: string) => `${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)}`;

async function dashboardCall<T>(selection: { companyId: string | number; yearKey: number; loginName: string }, menuShortName: string, action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch("/api/user-dashboard-rights", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ action, menuShortName, session: { companyId: Number(selection.companyId), yearKey: selection.yearKey, loginName: selection.loginName }, ...payload }),
  });
  const body = await response.json() as T & { error?: string };
  if (!response.ok || body.error) throw new Error(body.error || `Request ${action} failed`);
  return body;
}

export function UserDashboardRights({ menuShortName, title, onClose }: { menuShortName: string; title: string; onClose: () => void }) {
  const selection = useStartupSelection();
  const active = useWindowActive();
  const [users, setUsers] = useState<DashboardUser[]>([]);
  const [userNo, setUserNo] = useState(0);
  const [rows, setRows] = useState<DashboardRightRow[] | null>(null);
  const [busy, setBusy] = useState("Loading");
  const [cursor, setCursor] = useState(0);
  const combo = useRef<HTMLSelectElement>(null);

  const say = useCallback((text: string, heading = title) => messageBox.alert(text, heading), [title]);
  const ask = useCallback((text: string, heading: string) => messageBox.ask(text, heading, ["Yes", "No"], { defaultButton: "No" }), []);

  useEffect(() => {
    if (!selection) return;
    let live = true;
    dashboardCall<{ users: DashboardUser[] }>(selection, menuShortName, "users")
      .then((result) => { if (live) { setUsers(result.users); setBusy(""); } })
      .catch((error: unknown) => { if (live) { setBusy(""); void say(error instanceof Error ? error.message : String(error), "INTERNAL PROGRAM FAILURE"); } });
    return () => { live = false; };
  }, [selection, menuShortName, say]);

  const chooseUser = async (value: number) => {
    setUserNo(value);
    if (!selection || value <= 0) { setRows(null); return; }
    setBusy("Loading");
    try {
      const result = await dashboardCall<{ rows: DashboardRightRow[] }>(selection, menuShortName, "load", { userNo: value });
      setRows(result.rows);
      setCursor(0);
    } catch (error) {
      setRows(null);
      await say(error instanceof Error ? error.message : String(error), "INTERNAL PROGRAM FAILURE");
    } finally {
      setBusy("");
    }
  };

  const clear = () => { setRows(null); setUserNo(0); requestAnimationFrame(() => combo.current?.focus()); };

  const quit = useCallback(async () => {
    if ((await ask("Are You Sure Want To Quit ?", "User Dashboard Rights Quit")) === "Yes") onClose();
  }, [ask, onClose]);
  useWindowCloser(quit);

  const update = async () => {
    if (!rows || !selection) return;
    if ((await ask("Are You Sure Want To Update User Dashboard Rights ?", "User Dashboard Rights Update")) !== "Yes") return;
    setBusy("Saving");
    try {
      await dashboardCall(selection, menuShortName, "save", { userNo, rows });
      clear();
      await say("Record Updated...", "User Dashboard Rights Update");
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

  const change = (index: number, patch: Partial<DashboardRightRow>) => setRows((current) => current && current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const allTicked = rows !== null && rows.length > 0 && rows.every((row) => row.allowed);
  const someTicked = rows !== null && rows.some((row) => row.allowed);

  return (
    <div className="mp-screen sec-screen" role="region" aria-label={title}>
      <div className="mp-combos sec-combos">
        <label className="sec-combo"><span>SELECT USER »»</span>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the screen opens with the cursor in this box, as the desktop's does */}
          <select ref={combo} value={userNo} disabled={rows !== null || busy !== ""} onChange={(event) => void chooseUser(Number(event.target.value))} autoFocus>
            <option value={0}>— select —</option>
            {users.map((user) => <option key={user.no} value={user.no}>{user.name}</option>)}
          </select>
        </label>
        {busy !== "" && <span className="mp-busy">{busy}…</span>}
        <span className="mp-heading">{title.toUpperCase()}</span>
      </div>
      <div className="sec-body">
        {rows === null ? (
          <p className="sec-empty">Select a user to choose the dashboard blocks the user sees.</p>
        ) : (
          <table className="sec-grid">
            <thead>
              <tr>
                <th>Name</th>
                <th><label className="sec-all" title="Tick or untick every dashboard block"><input type="checkbox" checked={allTicked} ref={(box) => { if (box) box.indeterminate = someTicked && !allTicked; }} onChange={(event) => setRows(rows.map((row) => ({ ...row, allowed: event.target.checked })))} /> Allowed</label></th>
                <th>Display Order</th>
                {COLOURS.map(([key, label]) => <th key={key}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.name} className={`${index % 2 ? "sec-alt" : ""} ${index === cursor ? "sec-current" : ""}`} onMouseDown={() => setCursor(index)}>
                  <td className="sec-name">{row.name}</td>
                  <td className="sec-check"><input type="checkbox" aria-label={`Allow ${row.name}`} checked={row.allowed} onChange={(event) => change(index, { allowed: event.target.checked })} /></td>
                  <td className="sec-pass"><input type="text" inputMode="numeric" autoComplete="off" aria-label={`Display order ${row.name}`} value={row.order} onChange={(event) => change(index, { order: event.target.value.replace(/\D/g, "").slice(0, 4) })} /></td>
                  {COLOURS.map(([key, label]) => {
                    const value = row[key];
                    return (
                      <td key={key} className="sec-pass">
                        <input type="color" aria-label={`${label} ${row.name}`} title="Pick a colour" value={toHex(value)} onChange={(event) => change(index, { [key]: toRgb(event.target.value) })} style={{ width: 28, height: 20, padding: 0, verticalAlign: "middle", marginRight: 4 }} />
                        <input type="text" autoComplete="off" aria-label={`${label} text ${row.name}`} value={value} onChange={(event) => change(index, { [key]: event.target.value })} style={{ width: 96 }} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="mp-buttons sec-buttons">
        <button type="button" className="mp-btn mp-btn-green" disabled={rows === null || busy !== ""} onClick={() => void update()}><Icon name="save" />Update</button>
        <button type="button" className="mp-btn mp-btn-red" disabled={rows === null || busy !== ""} onClick={clear}><Icon name="cancel" />Cancel</button>
        <button type="button" className="mp-btn mp-btn-red" onClick={() => void quit()}><Icon name="quit" />Quit</button>
      </div>
    </div>
  );
}
