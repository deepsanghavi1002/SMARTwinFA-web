"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStartupSelection } from "../startup/StartupGate";
import { useWindowCloser } from "../ui/activeWindow";
import { messageBox } from "../ui/MessageBox";

/**
 * PAYROLL (Phase 1): Payroll Setup, Pay Components and Staff Payroll Profile. Staff are never typed in: a profile is made for a ledger that
 * already exists in the Accounts, and its name and opening balance are read from there (lib/payroll/service.ts).
 */

export type Screen = "setup" | "components" | "staff" | "attendance" | "process" | "register" | "payslip" | "tagging" | "pending" | "journal" | "outstanding" | "banksheet" | "statutory" | "untagged";
export type Props = { menuShortName: string; title: string; onClose: () => void };

type Setup = {
  jvMode: "A" | "B" | "AB"; salaryExpCode: number | null; daysBasis: "CAL" | "FIX"; fixedDays: number;
  pfPct: number; pfEmpPct: number; pfCeiling: number; esiPct: number; esiEmpPct: number; esiCeiling: number; ptAmount: number; ptFromGross: number;
};
type Component = { id: number; name: string; type: "E" | "D"; calc: "F" | "P"; pf: boolean; esi: boolean; seq: number; system: boolean; active: boolean };
type Account = { code: number; name: string };
type StaffRow = { code: number; name: string; designation: string; department: string; joinDate: string; exitDate: string; active: boolean; pf: boolean; esi: boolean; pt: boolean; opening: number; fixedEarnings: number };
type Profile = {
  code: number; name: string; opening: number; designation: string; department: string; joinDate: string; exitDate: string; payBasis: "M" | "D";
  bankName: string; bankAcNo: string; bankIfsc: string; panNo: string; pfNo: string; uanNo: string; esiNo: string; pfOn: boolean; esiOn: boolean; ptOn: boolean; active: boolean; remark: string;
};

export const money = (value: number) => value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** The accounts keep a credit opening as a minus. */
const drCr = (value: number) => `${money(Math.abs(value))} ${value < 0 ? "Cr" : "Dr"}`;

/** A refusal the person walked away from (a password prompt answered Cancel): nothing to show. */
class Cancelled extends Error {}

export type Rights = { view: boolean; add: boolean; edit: boolean; delete: boolean; print: boolean; export: boolean };
const ALL_RIGHTS: Rights = { view: true, add: true, edit: true, delete: true, print: true, export: true };

/**
 * One screen's calls to /api/payroll. The server checks the operator's Menu Book Rights on every call; when the module (or an Add / Edit / Delete)
 * password is set it answers "needs", the password is asked here and the call is sent again. Every answer carries the rights, which the screen reads
 * to switch Print and Export off.
 */
export function usePayroll(screen: Screen, menuShortName: string, title: string, onClose: () => void) {
  const selection = useStartupSelection();
  const [rights, setRights] = useState<Rights>(ALL_RIGHTS);
  const modulePassword = useRef("");
  const asking = useRef<Promise<string | null> | null>(null);
  const closer = useRef(onClose);
  useEffect(() => { closer.current = onClose; }, [onClose]);

  const call = useCallback(async <T,>(action: string, data?: unknown): Promise<T> => {
    if (!selection) throw new Error("No company is selected");
    let actionPassword: string | undefined;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch("/api/payroll", {
        method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ screen, action, menuShortName, data, modulePassword: modulePassword.current, actionPassword, session: { companyId: Number(selection.companyId), yearKey: selection.yearKey, loginName: selection.loginName } }),
      });
      const body = await response.json() as T & { error?: string; needs?: string; rights?: Rights };
      if (body.rights) setRights(body.rights);
      if (response.ok) return body;
      if (body.needs && attempt < 3) {
        const message = (body.error ?? "").startsWith("Incorrect") ? body.error ?? "Enter Password" : "Enter Password";
        if (body.needs === "module-password") {
          // Two calls started together ask once.
          if (!asking.current) asking.current = messageBox.prompt(message, "Module Password", { password: true }).finally(() => { asking.current = null; });
          const typed = await asking.current;
          if (typed === null) { closer.current(); throw new Cancelled(); }
          modulePassword.current = typed;
        } else {
          const kind = body.needs.startsWith("add") ? "Add" : body.needs.startsWith("edit") ? "Edit" : "Delete";
          const typed = await messageBox.prompt(message, `${kind} Password`, { password: true });
          if (typed === null) throw new Cancelled();
          actionPassword = typed;
        }
        continue;
      }
      throw new Error(body.error || "The request failed");
    }
    throw new Error("The password was not accepted");
  }, [selection, screen, menuShortName]);
  const fail = useCallback((reason: unknown) => (reason instanceof Cancelled ? undefined : messageBox.alert(reason instanceof Error ? reason.message : "The request failed", title, "error")), [title]);
  const quit = useCallback(async () => { if (await messageBox.confirm("Are You Sure Want To Quit ?", `${title} Quit`)) onClose(); }, [onClose, title]);
  useWindowCloser(quit);
  return { call, fail, quit, ready: selection !== null, rights };
}

function AccountPicker({ label, search, onPick }: { label: string; search: (term: string) => Promise<Account[]>; onPick: (account: Account) => void }) {
  const [term, setTerm] = useState("");
  const [found, setFound] = useState<Account[]>([]);
  useEffect(() => {
    if (term.trim().length < 2) return;
    const timer = setTimeout(() => { search(term).then(setFound).catch(() => setFound([])); }, 250);
    return () => clearTimeout(timer);
  }, [term, search]);
  return (
    <div className="pr-picker">
      <label className="pr-field"><span>{label}</span>
        <input aria-label={label} placeholder="Type 2+ letters of the ledger name or its code" value={term} onChange={(event) => setTerm(event.target.value)} />
      </label>
      {term.trim().length >= 2 && found.length > 0 && (
        <ul className="pr-found" role="listbox">
          {found.map((account) => (
            <li key={account.code}><button type="button" onClick={() => { onPick(account); setTerm(""); setFound([]); }}>{account.name} <small>#{account.code}</small></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ setup */

export function PayrollSetup({ menuShortName, title, onClose }: Props) {
  const { call, fail, quit, ready } = usePayroll("setup", menuShortName, title, onClose);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [expName, setExpName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ready) return;
    call<{ setup: Setup; salaryExpName: string }>("get").then((body) => { setSetup(body.setup); setExpName(body.salaryExpName); }).catch(fail);
  }, [call, fail, ready]);

  const set = <K extends keyof Setup>(key: K, value: Setup[K]) => setSetup((current) => (current ? { ...current, [key]: value } : current));
  const numberField = (key: keyof Setup, label: string, suffix = "") => (
    <label className="pr-field"><span>{label}</span>
      <input type="number" step="any" min={0} value={setup ? String(setup[key] ?? "") : ""} onChange={(event) => set(key, Number(event.target.value) as never)} />{suffix && <em>{suffix}</em>}
    </label>
  );
  const save = async () => {
    if (!setup || busy) return;
    setBusy(true);
    try {
      const body = await call<{ setup: Setup; salaryExpName: string }>("save", setup);
      setSetup(body.setup); setExpName(body.salaryExpName);
      await messageBox.alert("Payroll setup saved.", title);
    } catch (reason) { await fail(reason); } finally { setBusy(false); }
  };

  if (!setup) return <div className="mp-screen te-screen pr-screen" role="region" aria-label={title}><p className="pr-note">Loading…</p></div>;
  return (
    <div className="mp-screen te-screen pr-screen" role="region" aria-label={title}>
      <div className="pr-grid">
        <fieldset><legend>Salary journal</legend>
          <label className="pr-field"><span>Journal mode</span>
            <select value={setup.jvMode} onChange={(event) => set("jvMode", event.target.value as Setup["jvMode"])}>
              <option value="AB">A or B (choose each month)</option><option value="A">A - create the salary JV</option><option value="B">B - map an existing JV</option>
            </select>
          </label>
          <AccountPicker label="Salary expense account" search={async (term) => (await call<{ accounts: Account[] }>("accounts", { term })).accounts}
            onPick={(account) => { set("salaryExpCode", account.code); setExpName(account.name); }} />
          <p className="pr-note">Debited when mode A creates the monthly JV: <b>{expName || (setup.salaryExpCode ? `#${setup.salaryExpCode}` : "not chosen")}</b></p>
        </fieldset>
        <fieldset><legend>Days in a month</legend>
          <label className="pr-field"><span>Basis</span>
            <select value={setup.daysBasis} onChange={(event) => set("daysBasis", event.target.value as Setup["daysBasis"])}>
              <option value="CAL">Calendar days of the month</option><option value="FIX">Fixed days</option>
            </select>
          </label>
          {setup.daysBasis === "FIX" && numberField("fixedDays", "Fixed days")}
        </fieldset>
        <fieldset><legend>Provident fund</legend>
          {numberField("pfPct", "Employee PF", "%")}{numberField("pfEmpPct", "Employer PF", "%")}{numberField("pfCeiling", "Wage ceiling", "₹")}
        </fieldset>
        <fieldset><legend>ESI</legend>
          {numberField("esiPct", "Employee ESI", "%")}{numberField("esiEmpPct", "Employer ESI", "%")}{numberField("esiCeiling", "Gross ceiling", "₹")}
        </fieldset>
        <fieldset><legend>Professional tax</legend>
          {numberField("ptAmount", "Monthly amount", "₹")}{numberField("ptFromGross", "Applies from gross of", "₹")}
        </fieldset>
      </div>
      <div className="pr-actions">
        <button type="button" className="pr-primary" disabled={busy} onClick={() => void save()}>Save</button>
        <button type="button" onClick={() => void quit()}>Quit</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- components */

const BLANK_COMPONENT: Component = { id: 0, name: "", type: "E", calc: "F", pf: false, esi: false, seq: 5, system: false, active: true };

export function PayrollComponents({ menuShortName, title, onClose }: Props) {
  const { call, fail, quit, ready } = usePayroll("components", menuShortName, title, onClose);
  const [rows, setRows] = useState<Component[]>([]);
  const [edit, setEdit] = useState<Component | null>(null);

  useEffect(() => {
    if (!ready) return;
    call<{ components: Component[] }>("list").then((body) => setRows(body.components)).catch(fail);
  }, [call, fail, ready]);

  const save = async () => {
    if (!edit) return;
    try {
      const body = await call<{ components: Component[] }>("save", { ...edit, id: edit.id || null });
      setRows(body.components); setEdit(null);
    } catch (reason) { await fail(reason); }
  };
  const patch = (change: Partial<Component>) => setEdit((current) => (current ? { ...current, ...change } : current));

  return (
    <div className="mp-screen te-screen pr-screen" role="region" aria-label={title}>
      <table className="pr-table">
        <thead><tr><th>Seq</th><th>Name</th><th>Type</th><th>Calculation</th><th>PF</th><th>ESI</th><th>Active</th><th /></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={row.active ? "" : "pr-off"}>
              <td>{row.seq}</td><td>{row.name}{row.system ? " (system)" : ""}</td><td>{row.type === "E" ? "Earning" : "Deduction"}</td>
              <td>{row.calc === "F" ? "Fixed amount" : "% of BASIC"}</td><td>{row.pf ? "Yes" : ""}</td><td>{row.esi ? "Yes" : ""}</td><td>{row.active ? "Yes" : "No"}</td>
              <td><button type="button" onClick={() => setEdit(row)}>Edit</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {edit && (
        <fieldset className="pr-edit"><legend>{edit.id ? `Edit ${edit.name}` : "New component"}</legend>
          <label className="pr-field"><span>Name</span><input maxLength={40} disabled={edit.system} value={edit.name} onChange={(event) => patch({ name: event.target.value.toUpperCase() })} /></label>
          <label className="pr-field"><span>Type</span>
            <select disabled={edit.system} value={edit.type} onChange={(event) => patch({ type: event.target.value as "E" | "D" })}><option value="E">Earning</option><option value="D">Deduction</option></select></label>
          <label className="pr-field"><span>Calculation</span>
            <select value={edit.calc} onChange={(event) => patch({ calc: event.target.value as "F" | "P" })}><option value="F">Fixed amount</option><option value="P">% of BASIC</option></select></label>
          <label className="pr-field"><span>Sequence</span><input type="number" min={0} max={999} value={edit.seq} onChange={(event) => patch({ seq: Number(event.target.value) })} /></label>
          {edit.type === "E" && <label className="pr-check"><input type="checkbox" checked={edit.pf} onChange={(event) => patch({ pf: event.target.checked })} /> Counts for PF</label>}
          {edit.type === "E" && <label className="pr-check"><input type="checkbox" checked={edit.esi} onChange={(event) => patch({ esi: event.target.checked })} /> Counts for ESI</label>}
          <label className="pr-check"><input type="checkbox" checked={edit.active} disabled={edit.system} onChange={(event) => patch({ active: event.target.checked })} /> Active</label>
          <div className="pr-actions"><button type="button" className="pr-primary" onClick={() => void save()}>Save</button><button type="button" onClick={() => setEdit(null)}>Cancel</button></div>
        </fieldset>
      )}
      <div className="pr-actions">
        <button type="button" onClick={() => setEdit({ ...BLANK_COMPONENT })}>Add component</button>
        <button type="button" onClick={() => void quit()}>Quit</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ staff */

const today = () => new Date().toISOString().slice(0, 10);
const BLANK_PROFILE = (account: Account): Profile => ({
  code: account.code, name: account.name, opening: 0, designation: "", department: "", joinDate: "", exitDate: "", payBasis: "M",
  bankName: "", bankAcNo: "", bankIfsc: "", panNo: "", pfNo: "", uanNo: "", esiNo: "", pfOn: false, esiOn: false, ptOn: false, active: true, remark: "",
});

export function PayrollStaff({ menuShortName, title, onClose }: Props) {
  const { call, fail, quit, ready } = usePayroll("staff", menuShortName, title, onClose);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [components, setComponents] = useState<Component[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [effectiveFrom, setEffectiveFrom] = useState(today());
  const [history, setHistory] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => { setStaff((await call<{ staff: StaffRow[] }>("list")).staff); }, [call]);
  useEffect(() => {
    if (!ready) return;
    Promise.all([call<{ staff: StaffRow[] }>("list").then((body) => setStaff(body.staff)), call<{ components: Component[] }>("components").then((body) => setComponents(body.components))]).catch(fail);
  }, [call, fail, ready]);

  const active = useMemo(() => components.filter((component) => component.active), [components]);
  const open = (data: { profile: Profile; structure: { componentId: number; amount: number }[]; effectiveFrom: string; history: string[] }) => {
    setProfile(data.profile); setHistory(data.history);
    setAmounts(Object.fromEntries(data.structure.map((row) => [row.componentId, String(row.amount)])));
    setEffectiveFrom(data.effectiveFrom || data.profile.joinDate || today());
  };
  const load = async (code: number) => { try { open(await call("get", { code })); } catch (reason) { await fail(reason); } };
  const enrol = (account: Account) => { setProfile(BLANK_PROFILE(account)); setAmounts({}); setHistory([]); setEffectiveFrom(today()); };
  const patch = (change: Partial<Profile>) => setProfile((current) => (current ? { ...current, ...change } : current));

  const save = async () => {
    if (!profile || busy) return;
    const structure = active.filter((component) => (amounts[component.id] ?? "").trim() !== "").map((component) => ({ componentId: component.id, amount: Number(amounts[component.id]) }));
    setBusy(true);
    try {
      open(await call("save", { ...profile, structure, effectiveFrom }));
      await reload();
      await messageBox.alert("Staff payroll profile saved.", title);
    } catch (reason) { await fail(reason); } finally { setBusy(false); }
  };

  const text = (key: keyof Profile, label: string, max: number) => (
    <label className="pr-field"><span>{label}</span>
      <input maxLength={max} value={profile ? String(profile[key] ?? "") : ""} onChange={(event) => patch({ [key]: event.target.value } as Partial<Profile>)} /></label>
  );

  return (
    <div className="mp-screen te-screen pr-screen pr-staff" role="region" aria-label={title}>
      <div className="pr-left">
        <AccountPicker label="Enrol a ledger" search={async (term) => (await call<{ accounts: Account[] }>("accounts", { term })).accounts} onPick={enrol} />
        <table className="pr-table">
          <thead><tr><th>Staff (from Accounts)</th><th>Designation</th><th>Fixed pay</th><th>Opening</th></tr></thead>
          <tbody>
            {staff.map((row) => (
              <tr key={row.code} className={`${row.active ? "" : "pr-off"} ${profile?.code === row.code ? "pr-pick" : ""}`} onClick={() => void load(row.code)}>
                <td>{row.name} <small>#{row.code}</small></td><td>{row.designation}</td><td className="pr-num">{money(row.fixedEarnings)}</td><td className="pr-num">{drCr(row.opening)}</td>
              </tr>
            ))}
            {staff.length === 0 && <tr><td colSpan={4} className="pr-note">No staff enrolled yet. Search a ledger above to enrol it.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="pr-right">
        {!profile ? <p className="pr-note">Pick a staff member, or enrol a ledger.</p> : (
          <>
            <h3 className="pr-head">{profile.name} <small>#{profile.code} · Opening {drCr(profile.opening)}</small></h3>
            <div className="pr-grid">
              <fieldset><legend>Job</legend>
                {text("designation", "Designation", 60)}{text("department", "Department", 60)}
                <label className="pr-field"><span>Joining date</span><input type="date" value={profile.joinDate} onChange={(event) => patch({ joinDate: event.target.value })} /></label>
                <label className="pr-field"><span>Exit date</span><input type="date" value={profile.exitDate} onChange={(event) => patch({ exitDate: event.target.value })} /></label>
                <label className="pr-field"><span>Pay basis</span>
                  <select value={profile.payBasis} onChange={(event) => patch({ payBasis: event.target.value as "M" | "D" })}><option value="M">Monthly</option><option value="D">Daily</option></select></label>
                <label className="pr-check"><input type="checkbox" checked={profile.active} onChange={(event) => patch({ active: event.target.checked })} /> Active</label>
              </fieldset>
              <fieldset><legend>Bank and statutory</legend>
                {text("bankName", "Bank", 60)}{text("bankAcNo", "Account no", 30)}{text("bankIfsc", "IFSC", 15)}{text("panNo", "PAN", 15)}
                {text("pfNo", "PF no", 30)}{text("uanNo", "UAN", 20)}{text("esiNo", "ESI no", 30)}
                <label className="pr-check"><input type="checkbox" checked={profile.pfOn} onChange={(event) => patch({ pfOn: event.target.checked })} /> PF applies</label>
                <label className="pr-check"><input type="checkbox" checked={profile.esiOn} onChange={(event) => patch({ esiOn: event.target.checked })} /> ESI applies</label>
                <label className="pr-check"><input type="checkbox" checked={profile.ptOn} onChange={(event) => patch({ ptOn: event.target.checked })} /> Professional tax applies</label>
              </fieldset>
              <fieldset><legend>Salary structure</legend>
                <label className="pr-field"><span>Effective from</span><input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></label>
                {active.map((component) => (
                  <label className="pr-field" key={component.id}><span>{component.name}{component.calc === "P" ? " (% of BASIC)" : ""}{component.type === "D" ? " (deduct)" : ""}</span>
                    <input type="number" min={0} step="any" value={amounts[component.id] ?? ""} onChange={(event) => setAmounts({ ...amounts, [component.id]: event.target.value })} /></label>
                ))}
                {history.length > 1 && <p className="pr-note">Earlier structures from: {history.slice(1).join(", ")}</p>}
                <p className="pr-note">Saving with a new date keeps the old structure as history.</p>
              </fieldset>
            </div>
            {text("remark", "Remark", 200)}
          </>
        )}
        <div className="pr-actions">
          <button type="button" className="pr-primary" disabled={!profile || busy} onClick={() => void save()}>Save</button>
          <button type="button" disabled={!profile} onClick={() => setProfile(null)}>Cancel</button>
          <button type="button" onClick={() => void quit()}>Quit</button>
        </div>
      </div>
    </div>
  );
}
