"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStartupSelection } from "../startup/StartupGate";
import { useWindowActive, useWindowCloser } from "../ui/activeWindow";
import { Icon } from "../ui/Icon";
import { messageBox } from "../ui/MessageBox";
import type { CompanyRow, RightsUser } from "../../lib/user-company-rights";

/**
 * Setup > Security > User Company Rights (Utility_User_Company_Rights.cs): pick a user and tick the companies the user may open. The right is
 * kept by the company's group, so the companies of one group go together: ticking one ticks them all. A company with no group cannot be given.
 */

async function rightsCall<T>(selection: { companyId: string | number; yearKey: number; loginName: string }, menuShortName: string, action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch("/api/user-company-rights", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ action, menuShortName, session: { companyId: Number(selection.companyId), yearKey: selection.yearKey, loginName: selection.loginName }, ...payload }),
  });
  const body = await response.json() as T & { error?: string };
  if (!response.ok || body.error) throw new Error(body.error || `Request ${action} failed`);
  return body;
}

export function UserCompanyRights({ menuShortName, title, onClose }: { menuShortName: string; title: string; onClose: () => void }) {
  const selection = useStartupSelection();
  const active = useWindowActive();
  const [users, setUsers] = useState<RightsUser[]>([]);
  const [userNo, setUserNo] = useState(0);
  const [companies, setCompanies] = useState<CompanyRow[] | null>(null);
  /** The groups ticked. */
  const [groups, setGroups] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState("Loading");
  const [cursor, setCursor] = useState(0);
  const combo = useRef<HTMLSelectElement>(null);

  const say = useCallback((text: string, heading = title) => messageBox.alert(text, heading), [title]);
  const ask = useCallback((text: string, heading: string, defaultButton: "Yes" | "No" = "No") => messageBox.ask(text, heading, ["Yes", "No"], { defaultButton }), []);

  useEffect(() => {
    if (!selection) return;
    let live = true;
    rightsCall<{ users: RightsUser[] }>(selection, menuShortName, "users")
      .then((result) => { if (live) { setUsers(result.users); setBusy(""); } })
      .catch((error: unknown) => { if (live) { setBusy(""); void say(error instanceof Error ? error.message : String(error), "INTERNAL PROGRAM FAILURE"); } });
    return () => { live = false; };
  }, [selection, menuShortName, say]);

  const chooseUser = async (value: number) => {
    setUserNo(value);
    if (!selection || value <= 0) { setCompanies(null); return; }
    setBusy("Loading");
    try {
      const result = await rightsCall<{ companies: CompanyRow[]; groups: string[] }>(selection, menuShortName, "load", { userNo: value });
      setCompanies(result.companies);
      setGroups(new Set(result.groups));
      setCursor(0);
    } catch (error) {
      setCompanies(null);
      await say(error instanceof Error ? error.message : String(error), "INTERNAL PROGRAM FAILURE");
    } finally {
      setBusy("");
    }
  };

  const clear = () => { setCompanies(null); setUserNo(0); setGroups(new Set()); requestAnimationFrame(() => combo.current?.focus()); };

  const quit = useCallback(async () => {
    if ((await ask("Are You Sure Want To Quit ?", "User Company Rights Quit")) === "Yes") onClose();
  }, [ask, onClose]);
  useWindowCloser(quit);

  const update = async () => {
    if (!companies || !selection) return;
    if ((await ask("Are You Sure Want To Update User Company Rights ?", "User Company Rights Update")) !== "Yes") return;
    setBusy("Saving");
    try {
      // The groups in the order of the list, each once.
      const ordered = [...new Set(companies.filter((company) => company.group !== "" && groups.has(company.group)).map((company) => company.group))];
      await rightsCall(selection, menuShortName, "save", { userNo, groups: ordered });
      clear();
      await say("Record Updated...", "User Company Rights Update");
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

  const tick = (group: string, value: boolean) => setGroups((current) => { const next = new Set(current); if (value) next.add(group); else next.delete(group); return next; });
  const givable = (companies ?? []).filter((company) => company.group !== "");
  const everyGroup = [...new Set(givable.map((company) => company.group))];
  const allTicked = everyGroup.length > 0 && everyGroup.every((group) => groups.has(group));
  const someTicked = everyGroup.some((group) => groups.has(group));

  return (
    <div className="mp-screen sec-screen" role="region" aria-label={title}>
      <div className="mp-combos sec-combos">
        <label className="sec-combo"><span>SELECT USER »»</span>
          <select ref={combo} value={userNo} disabled={companies !== null || busy !== ""} onChange={(event) => void chooseUser(Number(event.target.value))} autoFocus>
            <option value={0}>— select —</option>
            {users.map((user) => <option key={user.no} value={user.no}>{user.name}</option>)}
          </select>
        </label>
        {busy !== "" && <span className="mp-busy">{busy}…</span>}
        <span className="mp-heading">{title.toUpperCase()}</span>
      </div>
      <div className="sec-body">
        {companies === null ? (
          <p className="sec-empty">Select a user to choose the companies the user may open.</p>
        ) : (
          <table className="sec-grid">
            <thead>
              <tr>
                <th>Name</th><th>Group Name</th>
                <th><label className="sec-all" title="Tick or untick every company that has a group"><input type="checkbox" checked={allTicked} ref={(box) => { if (box) box.indeterminate = someTicked && !allTicked; }} onChange={(event) => setGroups(event.target.checked ? new Set(everyGroup) : new Set())} /> Allow</label></th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company, index) => (
                <tr key={`${company.name}|${company.group}`} className={`${index % 2 ? "sec-alt" : ""} ${index === cursor ? "sec-current" : ""}`} onMouseDown={() => setCursor(index)}>
                  <td className="sec-name">{company.name}</td>
                  <td>{company.group}</td>
                  <td className="sec-check"><input type="checkbox" aria-label={`Allow ${company.name}`} disabled={company.group === ""} title={company.group === "" ? "A company with no group cannot be given" : undefined}
                    checked={company.group !== "" && groups.has(company.group)} onChange={(event) => tick(company.group, event.target.checked)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="mp-buttons sec-buttons">
        <button type="button" className="mp-btn mp-btn-green" disabled={companies === null || busy !== ""} onClick={() => void update()}><Icon name="save" />Update</button>
        <button type="button" className="mp-btn mp-btn-red" disabled={companies === null || busy !== ""} onClick={clear}><Icon name="cancel" />Cancel</button>
        <button type="button" className="mp-btn mp-btn-red" onClick={() => void quit()}><Icon name="quit" />Quit</button>
      </div>
    </div>
  );
}
