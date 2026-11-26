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
      <span className="ps-box">
        <input type="number" step="any" min={0} value={setup ? String(setup[key] ?? "") : ""} onChange={(event) => set(key, Number(event.target.value) as never)} />{suffix && <em>{suffix}</em>}
      </span>
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

  if (!setup) return <div className="mp-screen te-screen pr-screen pr-setup" role="region" aria-label={title}><p className="pr-note">Loading…</p></div>;
  return (
    <div className="mp-screen te-screen pr-screen pr-setup" role="region" aria-label={title}>
      <div className="ps-grid">
        <SetupCard tone="blue" icon="person" heading="Salary Journal">
          <label className="pr-field"><span>Journal mode</span>
            <select value={setup.jvMode} onChange={(event) => set("jvMode", event.target.value as Setup["jvMode"])}>
              <option value="AB">A or B (choose each month)</option><option value="A">A - create the salary JV</option><option value="B">B - map an existing JV</option>
            </select>
          </label>
          <AccountPicker label="Salary expense account" search={async (term) => (await call<{ accounts: Account[] }>("accounts", { term })).accounts}
            onPick={(account) => { set("salaryExpCode", account.code); setExpName(account.name); }} />
          <p className="ps-info"><SetupIcon name="info" /><span>Debited when mode A creates the monthly JV: <b>{expName || (setup.salaryExpCode ? `#${setup.salaryExpCode}` : "not chosen")}</b></span></p>
        </SetupCard>
        <SetupCard tone="green" icon="calendar" heading="Days in a Month">
          <label className="pr-field"><span>Basis</span>
            <select value={setup.daysBasis} onChange={(event) => set("daysBasis", event.target.value as Setup["daysBasis"])}>
              <option value="CAL">Calendar days of the month</option><option value="FIX">Fixed days</option>
            </select>
          </label>
          {setup.daysBasis === "FIX" && numberField("fixedDays", "Fixed days")}
        </SetupCard>
        <SetupCard tone="orange" icon="group" heading="Provident Fund">
          {numberField("pfPct", "Employee PF", "%")}{numberField("pfEmpPct", "Employer PF", "%")}{numberField("pfCeiling", "Wage ceiling", "₹")}
        </SetupCard>
        <SetupCard tone="teal" icon="shield" heading="ESI">
          {numberField("esiPct", "Employee ESI", "%")}{numberField("esiEmpPct", "Employer ESI", "%")}{numberField("esiCeiling", "Gross ceiling", "₹")}
        </SetupCard>
        <SetupCard tone="violet" icon="percent" heading="Professional Tax">
          {numberField("ptAmount", "Monthly amount", "₹")}{numberField("ptFromGross", "Applies from gross of", "₹")}
        </SetupCard>
      </div>
      <div className="ps-actions">
        <button type="button" className="ps-save" disabled={busy} onClick={() => void save()}><SetupIcon name="save" />Save</button>
        <button type="button" className="ps-quit" onClick={() => void quit()}><SetupIcon name="quit" />Quit</button>
      </div>
    </div>
  );
}

/** The line icons of the Payroll Setup cards and buttons (24 x 24, drawn in the current colour). */
const SETUP_ICONS = {
  person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c0-3.5 3.6-6 8-6s8 2.500 8 6",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v5M16 3v5M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01",
  group: "M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6.500 19c0-3 2.500-5 5.500-5s5.500 2 5.500 5M5 12.500a2 2 0 1 0 0-4M2 18c0-2 1.200-3.500 3-4M19 12.500a2 2 0 1 1 0-4M22 18c0-2-1.200-3.500-3-4",
  shield: "M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6zM8.500 12l2.500 2.500 4.500-5",
  percent: "M6 18L18 6M7.500 10a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5zM16.500 19a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5z",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
  save: "M4 3h13l3 3v15H4zM8 3v5h7V3M7 21v-7h10v7",
  quit: "M20 12a8 8 0 1 1-4-6.9M20 3v5h-5",
  layers: "M12 3l9 5-9 5-9-5zM3 12.500l9 5 9-5M3 16.500l9 5 9-5",
  search: "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM16 16l5 5",
  pencil: "M4 20l1-4L16 5l3 3L8 19zM14 7l3 3",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  briefcase: "M4 8h16v12H4zM9 8V5h6v3M4 13h16",
  bank: "M3 9l9-5 9 5zM5 10v8M9.500 10v8M14.500 10v8M19 10v8M3 20h18",
  exit: "M13 4H5v16h8M16 8l4 4-4 4M20 12H10",
  upload: "M12 16V4M7 9l5-5 5 5M4 15v5h16v-5",
  download: "M13 4H5v16h8M16 8l4 4-4 4M20 12H10M9 4v4",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3M4.900 4.900L7 7M17 17l2.100 2.100M19.100 4.900L17 7M7 17l-2.100 2.100M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z",
  lock: "M6 11h12v10H6zM8.500 11V8a3.500 3.500 0 0 1 7 0v3M12 15v2",
  unlock: "M6 11h12v10H6zM8.500 11V8a3.500 3.500 0 0 1 6.800-1.200M12 15v2",
  excel: "M6 3h9l4 4v14H6zM14 3v5h5M9.500 11l5 6M14.500 11l-5 6",
  doc: "M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 15h7M9 18h4",
  print: "M7 8V3h10v5M6 17H3v-8h18v8h-3M7 14h10v7H7z",
  tag: "M3 4h8l10 10-7 7L4 11zM8.500 9h.01",
  money: "M3 6h18v12H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 12h.01M18 12h.01",
  calculator: "M6 3h12v18H6zM9 7h6M9 12h.01M12 12h.01M15 12h.01M9 15h.01M12 15h.01M15 15h.01M9 18h.01M12 18h.01M15 18h.01",
  wallet: "M4 7h15v13H4zM4 7l11-3v3M15 11h5v5h-5z",
  check: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM7.800 12.400l2.900 2.900 5.600-5.800",
  card: "M3 6h18v12H3zM3 10h18M7 15h4",
  code: "M5 3h14v18H5zM8 8h8M8 12h8M8 16h5",
  transfer: "M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4",
} as const;

export function SetupIcon({ name }: { name: keyof typeof SETUP_ICONS }) {
  return <svg className="ps-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={SETUP_ICONS[name]} /></svg>;
}

function SetupCard({ tone, icon, heading, children }: { tone: "blue" | "green" | "orange" | "teal" | "violet"; icon: keyof typeof SETUP_ICONS; heading: string; children: React.ReactNode }) {
  return (
    <section className={`ps-card ps-${tone}`} role="group" aria-label={heading}>
      <header><span className="ps-badge"><SetupIcon name={icon} /></span><h3>{heading}</h3></header>
      <div className="ps-body">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------- components */

const BLANK_COMPONENT: Component = { id: 0, name: "", type: "E", calc: "F", pf: false, esi: false, seq: 5, system: false, active: true };

export function PayrollComponents({ menuShortName, title, onClose }: Props) {
  const { call, fail, quit, ready } = usePayroll("components", menuShortName, title, onClose);
  const [rows, setRows] = useState<Component[]>([]);
  const [edit, setEdit] = useState<Component | null>(null);
  const [term, setTerm] = useState("");

  const refresh = useCallback(() => call<{ components: Component[] }>("list").then((body) => setRows(body.components)).catch(fail), [call, fail]);
  useEffect(() => {
    if (!ready) return;
    call<{ components: Component[] }>("list").then((body) => setRows(body.components)).catch(fail);
  }, [call, fail, ready]);

  const typeText = (row: Component) => (row.type === "E" ? "Earning" : "Deduction");
  const calcText = (row: Component) => (row.calc === "F" ? "Fixed amount" : "% of BASIC");
  const shown = rows.filter((row) => `${row.name} ${typeText(row)} ${calcText(row)}`.toLowerCase().includes(term.trim().toLowerCase()));

  const save = async () => {
    if (!edit) return;
    try {
      const body = await call<{ components: Component[] }>("save", { ...edit, id: edit.id || null });
      setRows(body.components); setEdit(null);
    } catch (reason) { await fail(reason); }
  };
  const patch = (change: Partial<Component>) => setEdit((current) => (current ? { ...current, ...change } : current));

  return (
    <div className="mp-screen te-screen pr-screen pr-setup pr-comp" role="region" aria-label={title}>
      <div className="pc-panel">
        <header className="pc-head">
          <span className="pc-title"><span className="pc-badge"><SetupIcon name="layers" /></span><h3>Pay Component</h3></span>
          <label className="pc-search"><SetupIcon name="search" /><input type="search" aria-label="Search components" placeholder="Search..." value={term} onChange={(event) => setTerm(event.target.value)} /></label>
        </header>
        <div className="pc-scroll">
          <table className="pc-table">
            <thead><tr><th>Seq</th><th>Name</th><th>Type</th><th>Calculation</th><th>PF</th><th>ESI</th><th>Active</th><th aria-label="Edit" /></tr></thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.id} className={row.active ? "" : "pr-off"}>
                  <td>{row.seq}</td><td>{row.name}{row.system ? " (system)" : ""}</td><td>{typeText(row)}</td>
                  <td>{calcText(row)}</td><td>{row.pf ? "Yes" : ""}</td><td>{row.esi ? "Yes" : ""}</td><td>{row.active ? "Yes" : "No"}</td>
                  <td className="pc-act"><button type="button" className="pc-edit" onClick={() => setEdit(row)}><SetupIcon name="pencil" />Edit</button></td>
                </tr>
              ))}
              {shown.length === 0 && rows.length > 0 && <tr><td colSpan={8}>No component matches the search.</td></tr>}
            </tbody>
          </table>
        </div>
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
          <div className="ps-actions pc-form-actions"><button type="button" className="ps-save" onClick={() => void save()}><SetupIcon name="save" />Save</button><button type="button" className="ps-quit" onClick={() => setEdit(null)}><SetupIcon name="close" />Cancel</button></div>
        </fieldset>
      )}
        <div className="ps-actions">
          <button type="button" className="ps-save" onClick={() => setEdit({ ...BLANK_COMPONENT })}><SetupIcon name="plus" />Add Component</button>
          <button type="button" className="ps-quit" onClick={() => void refresh()}><SetupIcon name="quit" />Refresh</button>
          <button type="button" className="ps-quit" onClick={() => void quit()}><SetupIcon name="close" />Quit</button>
        </div>
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
  const [term, setTerm] = useState("");
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

  const q = term.trim().toLowerCase();
  const shown = staff.filter((row) => `${row.name} ${row.code} ${row.designation} ${row.department}`.toLowerCase().includes(q));

  return (
    <div className="mp-screen te-screen pr-screen pr-setup pr-sp" role="region" aria-label={title}>
      <header className="sp-head">
        <span className="sp-badge"><SetupIcon name="group" /></span>
        <h2>Staff Payroll Profile</h2>
        {profile && <p className="sp-who"><b>{profile.name}</b> #{profile.code} · Opening {drCr(profile.opening)}</p>}
      </header>

      <div className="sp-columns">
        <section className="sp-list" aria-label="Staff list">
          <div className="sp-list-head">
            <span className="sp-card-title"><SetupIcon name="group" /><h3>Staff List</h3></span>
            <label className="sp-search"><SetupIcon name="search" /><input type="search" aria-label="Search staff" placeholder="Search..." value={term} onChange={(event) => setTerm(event.target.value)} /></label>
          </div>
          <AccountPicker label="Enrol a ledger" search={async (value) => (await call<{ accounts: Account[] }>("accounts", { term: value })).accounts} onPick={enrol} />
          <div className="sp-table-box">
            <table className="sp-table">
              <thead><tr><th>Sr.No</th><th>Staff (from Accounts)</th><th>Designation</th><th className="pr-num">Fixed Pay</th><th className="pr-num">Opening</th></tr></thead>
              <tbody>
                {shown.map((row, index) => (
                  <tr key={row.code} tabIndex={0} className={`${row.active ? "" : "pr-off"} ${profile?.code === row.code ? "pr-pick" : ""}`} onClick={() => void load(row.code)}
                    onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void load(row.code); } }}>
                    <td>{index + 1}</td><td>{row.name} <small>#{row.code}</small></td><td>{row.designation}</td><td className="pr-num">{money(row.fixedEarnings)}</td><td className="pr-num">{drCr(row.opening)}</td>
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={5} className="pr-note">{staff.length === 0 ? "No staff enrolled yet. Use Enrol a ledger above." : "No staff matches the search."}</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        {!profile ? <section className="sp-empty">Pick a staff member from the list, or enrol a ledger.</section> : (
          <>
            <SetupCard tone="blue" icon="briefcase" heading="Basic Info">
              {text("designation", "Designation", 60)}{text("department", "Department", 60)}
              <label className="pr-field"><span>Joining Date</span><input type="date" value={profile.joinDate} onChange={(event) => patch({ joinDate: event.target.value })} /></label>
              <label className="pr-field"><span>Exit Date</span><input type="date" value={profile.exitDate} onChange={(event) => patch({ exitDate: event.target.value })} /></label>
              <label className="pr-field"><span>Pay Basis</span>
                <select value={profile.payBasis} onChange={(event) => patch({ payBasis: event.target.value as "M" | "D" })}><option value="M">Monthly</option><option value="D">Daily</option></select></label>
              {text("remark", "Remark", 200)}
              <label className="pr-check"><input type="checkbox" checked={profile.active} onChange={(event) => patch({ active: event.target.checked })} /> Active</label>
            </SetupCard>
            <SetupCard tone="blue" icon="bank" heading="Bank and Statutory">
              {text("bankName", "Bank", 60)}{text("bankAcNo", "Account no", 30)}{text("bankIfsc", "IFSC", 15)}{text("panNo", "PAN", 15)}
              {text("pfNo", "PF no", 30)}{text("uanNo", "UAN", 20)}{text("esiNo", "ESI no", 30)}
              <label className="pr-check"><input type="checkbox" checked={profile.pfOn} onChange={(event) => patch({ pfOn: event.target.checked })} /> PF Applicable</label>
              <label className="pr-check"><input type="checkbox" checked={profile.esiOn} onChange={(event) => patch({ esiOn: event.target.checked })} /> ESI Applicable</label>
              <label className="pr-check"><input type="checkbox" checked={profile.ptOn} onChange={(event) => patch({ ptOn: event.target.checked })} /> Professional Tax Applicable</label>
            </SetupCard>
            <SetupCard tone="blue" icon="info" heading="Salary Structure">
              <label className="pr-field"><span>Effective from</span><input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></label>
              {active.map((component) => (
                <label className="pr-field" key={component.id}><span>{component.name}{component.calc === "P" ? " (% of BASIC)" : ""}{component.type === "D" ? " (deduct)" : ""}</span>
                  <input type="number" min={0} step="any" value={amounts[component.id] ?? ""} onChange={(event) => setAmounts({ ...amounts, [component.id]: event.target.value })} /></label>
              ))}
              {history.length > 1 && <p className="pr-note">Earlier structures from: {history.slice(1).join(", ")}</p>}
              <p className="sp-hint"><SetupIcon name="info" /><span>Saving with a new date keeps the old structure as history.</span></p>
            </SetupCard>
          </>
        )}
      </div>

      <div className="ps-actions">
        <button type="button" className="ps-save" disabled={!profile || busy} onClick={() => void save()}><SetupIcon name="save" />Save</button>
        <button type="button" className="ps-quit" disabled={!profile} onClick={() => setProfile(null)}><SetupIcon name="quit" />Cancel</button>
        <span className="sp-divider" aria-hidden="true" />
        <button type="button" className="ps-quit" onClick={() => void quit()}><SetupIcon name="exit" />Quit</button>
      </div>
    </div>
  );
}
