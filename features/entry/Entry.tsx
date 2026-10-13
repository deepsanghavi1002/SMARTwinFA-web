"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useStartupSelection } from "../startup/StartupGate";
import { parseDesktopDate, toDecimal } from "../../lib/master-program/legacy";
import type { BookScreen, EntryColumn, EntryOption, GridColumn, HelpList, InvoiceControl, InvoiceDefinition, PartyDetails, SeriesDefaults, SlabRow } from "../../lib/entry/types";
import { entryCall } from "./api";
import { useEditorTools } from "../grid/EditorTools";
import { DateField } from "../grid/DateField";
import { messageBox } from "../ui/MessageBox";
import { HotkeyLabel, useAltHotkeys } from "../ui/hotkeys";
import { Icon } from "../ui/Icon";
import { SearchCombo } from "../ui/SearchCombo";

/**
 * Comman_Entry (Entry.cs): the TRANSACTION > Invoice screen, laid out as the desktop form is.
 * Every header box sits where entry_control puts it (label_left/top, control_left/top/width),
 * the grids sit on the tab page where the desktop's designer puts them, and the toolbar is the
 * desktop's bottom strip.
 *
 * Ported so far (the screen set-up): choosing the register fills the screen for that book
 * (header boxes shown for the book, series, default date and number, product grid columns
 * including the item-wise slab and product addon columns, the slab grid with its tax lists),
 * the party help and the party's address, addon fields and pending bills, and the Find / Edit
 * list. Entering products, the slab arithmetic, Save, restoring an entry, Print and the
 * e-invoice / e-way calls are not ported yet (docs/PENDING-WORK.md).
 */

type Tab = "all" | "outstanding" | "find" | "eway";
type EntryReply = { entry: InvoiceDefinition; warnings: string[]; companyName: string; userName: string; yearStart: string; yearEnd: string };
type BookReply = { book: BookScreen & { asksTaxGroup: boolean }; warnings: string[] };

/** The desktop form's tab control: top 117, pages 1021 x 394 under an 18px strip. */
const TAB_TOP = 117;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const dayOf = (value: string) => { const date = parseDesktopDate(value); return date ? DAYS[date.getDay()] : ""; };
const at = (box: Readonly<{ left: number; top: number; width: number; height?: number }>): CSSProperties => ({ left: box.left, top: box.top, width: box.width });

function amount(value: string, decimals: number): string {
  if (value.trim() === "") return "";
  const number = toDecimal(value);
  return number.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** A side grid (slab, addon, outstanding, find / edit): heading row and rows, the columns as the setup sizes them. */
function SideGrid({ columns, rows, cell, label, style, empty }: {
  columns: readonly GridColumn[];
  rows: readonly Readonly<Record<string, string>>[];
  cell?: (row: number, column: GridColumn) => ReactNode;
  label: string;
  style: CSSProperties;
  empty?: string;
}) {
  return (
    <div className="ent-grid" style={style} role="grid" aria-label={label}>
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column.key} style={{ width: column.width, minWidth: column.width, textAlign: column.align === "R" ? "right" : column.align === "C" ? "center" : "left" }}>{column.caption}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className={index % 2 ? "ent-alt" : ""}>
              {columns.map((column) => (
                <td key={column.key} className={column.editable ? "ent-open" : ""} style={{ textAlign: column.align === "R" ? "right" : column.align === "C" ? "center" : "left" }}>
                  {cell ? cell(index, column) : column.align === "R" && column.decimals > 0 ? amount(row[column.key] ?? "", column.decimals) : row[column.key] ?? ""}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && empty && <tr><td colSpan={Math.max(1, columns.length)} className="ent-empty">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function Entry({ entryName, menuShortName, title, onClose }: { entryName: string; menuShortName: string; title: string; onClose: () => void }) {
  const selection = useStartupSelection();
  const [def, setDef] = useState<InvoiceDefinition | null>(null);
  const [fatal, setFatal] = useState("");
  const [locked, setLocked] = useState(true);
  const [busy, setBusy] = useState("Loading");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [yearStart, setYearStart] = useState<Date | null>(null);
  const [register, setRegister] = useState<EntryOption | null>(null);
  const [book, setBook] = useState<BookScreen | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [slab, setSlab] = useState<SlabRow[]>([]);
  const [tab, setTab] = useState<Tab>("all");
  const [party, setParty] = useState<PartyDetails | null>(null);
  const [addon, setAddon] = useState<Record<number, string>>({});
  const [help, setHelp] = useState<HelpList | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpAt, setHelpAt] = useState(0);
  const [preview, setPreview] = useState<HelpList | null>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const partyRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const tools = useEditorTools(yearStart);
  useAltHotkeys(screenRef);

  const call = useCallback(<T,>(action: string, payload: Record<string, unknown> = {}) => {
    if (!selection) return Promise.reject(new Error("No company is open"));
    return entryCall<T>(selection, entryName, menuShortName, action, payload);
  }, [selection, entryName, menuShortName]);
  const say = useCallback((text: string, heading = "Entry") => messageBox.ask(text, heading), []);

  // ---- Comman_Entry_Load (and the module password Main_Menu_New asks first)
  useEffect(() => {
    if (!selection) return;
    let cancelled = false;
    entryCall<EntryReply>(selection, entryName, menuShortName, "entry")
      .then(async (body) => {
        if (cancelled) return;
        setDef(body.entry);
        setYearStart(new Date(body.yearStart));
        setWarnings([...body.entry.unsupported, ...body.warnings]);
        if (!body.entry.rights.modulePassword) { setLocked(false); return; }
        for (;;) {
          const password = await messageBox.prompt("Enter Password", "Password", { password: true });
          if (cancelled) return;
          if (password === null) { onClose(); return; }
          const check = await entryCall<{ ok: boolean; message: string }>(selection, entryName, menuShortName, "module-password", { password }).catch((error: unknown) => ({ ok: false, message: error instanceof Error ? error.message : String(error) }));
          if (cancelled) return;
          if (check.ok) { setLocked(false); return; }
          await messageBox.ask(check.message, "Password");
        }
      })
      .catch((error: unknown) => { if (!cancelled) setFatal(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!cancelled) setBusy(""); });
    return () => { cancelled = true; };
  }, [selection, entryName, menuShortName, onClose]);

  // ---- Cmb_FirstCombo_Leave: the register sets the screen up
  const chooseRegister = useCallback(async (option: EntryOption) => {
    setRegister(option);
    setBusy("Setting the screen");
    try {
      let body = await call<BookReply>("book", { firstCombo: option });
      if (body.book.asksTaxGroup) {
        // "CGST [Yes] / IGST [No] / VAT [Cancel] Entry...": the desktop asks before the slab grid is filled.
        const answer = await messageBox.ask("CGST [Yes] / IGST [No] / VAT [Cancel] Entry...", "GST Entry Type", ["Yes", "No", "Cancel"], { defaultButton: "Yes" });
        body = await call<BookReply>("book", { firstCombo: option, taxGroup: answer === "Yes" ? "G" : answer === "No" ? "I" : "V" });
      }
      const next = body.book;
      setBook(next);
      setSlab([...next.slabRows]);
      setParty(null);
      setAddon({});
      setHelp(null);
      setHelpOpen(false);
      setPreview(null);
      setTab("all");
      const initial: Record<string, string> = {};
      for (const control of next.controls) initial[control.name] = control.initial;
      initial.dtp_date = next.defaults.date;
      initial.tbx_number = next.defaults.number;
      for (const name of ["dtp_chlndate", "dtp_entrydate", "dtp_ewaydate"]) if (next.controls.some((control) => control.name === name)) initial[name] = next.defaults.date;
      setValues(initial);
      setWarnings([...(def?.unsupported ?? []), ...next.warnings, ...body.warnings]);
      Promise.resolve().then(() => screenRef.current?.querySelector<HTMLElement>(".ent-head [data-first] input, .ent-head [data-first] button")?.focus());
    } catch (error) {
      setBook(null);
      await say(error instanceof Error ? error.message : String(error), "Entry Warning");
    } finally {
      setBusy("");
    }
  }, [call, def, say]);

  // ---- Cmb_Series_Leave: another series has its own last date and number
  const chooseSeries = useCallback(async (series: string) => {
    setValues((current) => ({ ...current, cmb_series: series }));
    setPreview(null);
    if (!register) return;
    try {
      const body = await call<{ defaults: SeriesDefaults }>("series", { firstCombo: register, series });
      setValues((current) => ({ ...current, dtp_date: body.defaults.date, tbx_number: body.defaults.number, dtp_chlndate: current.dtp_chlndate !== undefined ? body.defaults.date : current.dtp_chlndate }));
    } catch (error) {
      await say(error instanceof Error ? error.message : String(error));
    }
  }, [call, register, say]);

  // ---- Tbx_PartyName: the help list (Refresh_HelpGrid "A") and leaving it (address, addons, pending bills)
  const openHelp = useCallback(async () => {
    if (!book || !register) return;
    setHelpOpen(true);
    if (help) return;
    setBusy("Account help");
    try {
      const body = await call<{ help: HelpList }>("party-help", { firstCombo: register, partyBooks: book.partyBooks });
      setHelp(body.help);
      if (body.help.rows.length === 0) await say(body.help.total, "Entry Warning");
    } catch (error) {
      await say(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }, [book, register, help, call, say]);

  const typedName = values.tbx_partyname ?? "";
  const shownHelp = useMemo(() => {
    if (!help) return [];
    const typed = typedName.trim().toUpperCase();
    if (typed === "" || party?.name === typedName) return help.rows.slice(0, 300);
    const starts = help.rows.filter((row) => (row.NAME ?? "").toUpperCase().startsWith(typed));
    const contains = help.rows.filter((row) => !(row.NAME ?? "").toUpperCase().startsWith(typed) && (row.NAME ?? "").toUpperCase().includes(typed));
    return [...starts, ...contains].slice(0, 300);
  }, [help, typedName, party]);

  const choosePartyRow = useCallback(async (row: Readonly<Record<string, string>> | undefined) => {
    if (!row || !register) return;
    setHelpOpen(false);
    setBusy("Party");
    try {
      const body = await call<{ party: PartyDetails }>("party", { firstCombo: register, code: Number(row.CODE) });
      setParty(body.party);
      setValues((current) => ({ ...current, tbx_partyname: body.party.name, tbx_credit_days: current.tbx_credit_days !== undefined ? body.party.creditDays : current.tbx_credit_days }));
      setAddon(Object.fromEntries(body.party.addon.map((item) => [item.key, item.value])));
    } catch (error) {
      await say(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }, [register, call, say]);

  const partyKeys = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "F2") { event.preventDefault(); if (!helpOpen) void openHelp(); else setHelpAt((row) => Math.min(row + 1, shownHelp.length - 1)); return; }
    if (event.key === "ArrowUp" && helpOpen) { event.preventDefault(); setHelpAt((row) => Math.max(0, row - 1)); return; }
    if (event.key === "PageDown" && helpOpen) { event.preventDefault(); setHelpAt((row) => Math.min(row + 12, shownHelp.length - 1)); return; }
    if (event.key === "PageUp" && helpOpen) { event.preventDefault(); setHelpAt((row) => Math.max(0, row - 12)); return; }
    if (event.key === "Escape" && helpOpen) { event.preventDefault(); event.stopPropagation(); setHelpOpen(false); return; }
    if (event.key === "Enter" && helpOpen) { event.preventDefault(); event.stopPropagation(); void choosePartyRow(shownHelp[helpAt]); }
  };

  // ---- Invoice_Tab_Find_Edit_Enter: the register's entries in the series
  const openTab = useCallback(async (next: Tab) => {
    setTab(next);
    if (next !== "find" || preview || !register) return;
    setBusy("Entries");
    try {
      const body = await call<{ preview: HelpList }>("preview", { firstCombo: register, series: values.cmb_series ?? "" });
      setPreview(body.preview);
    } catch (error) {
      await say(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }, [preview, register, call, values.cmb_series, say]);

  // Enter moves to the next box of the header, as the desktop's KeyPreview did.
  const helpOpenRef = useRef(helpOpen);
  useEffect(() => { helpOpenRef.current = helpOpen; }, [helpOpen]);
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const enter = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.defaultPrevented || helpOpenRef.current) return;
      const target = event.target as HTMLElement;
      if (target.tagName === "TEXTAREA" || target.closest(".mp-combo-list")) return;
      const boxes = [...form.querySelectorAll<HTMLElement>("input:not([disabled]), select:not([disabled]), textarea:not([disabled])")].filter((box) => box.offsetParent !== null);
      const index = boxes.indexOf(target);
      if (index >= 0 && index < boxes.length - 1) { event.preventDefault(); boxes[index + 1].focus(); }
    };
    form.addEventListener("keydown", enter);
    return () => form.removeEventListener("keydown", enter);
  }, []);

  const quit = async () => {
    if (book && (party || (values.tbx_narration ?? "") !== "")) {
      const answer = await messageBox.ask("Quit the entry? What is typed is not saved.", "Quit", ["Yes", "No"], { defaultButton: "No" });
      if (answer !== "Yes") return;
    }
    onClose();
  };
  const notPorted = (what: string) => () => void say(`${what} is not ported to the web yet. The screen set-up is done; product entry and saving come next.`, "Entry");

  const control = (item: InvoiceControl) => {
    const value = values[item.name] ?? "";
    const set = (next: string) => setValues((current) => ({ ...current, [item.name]: next }));
    const labelStyle: CSSProperties = { left: item.label_.left, top: item.label_.top, width: item.label_.width, height: item.label_.height, textAlign: item.label_.right ? "right" : "left" };
    const boxStyle: CSSProperties = { ...at(item.box), ...(item.name === "tbx_narration" ? { height: item.box.height } : {}) };
    return [
      <label key={`${item.name}-label`} className={`ent-label ${item.compulsory ? "ent-compulsory" : ""}`} style={labelStyle} title={item.tooltip || undefined} htmlFor={`ent-${item.name}`}>{item.label}</label>,
      <span key={item.name} className={`ent-box ent-box-${item.type}`} style={boxStyle} {...(item.name === "cmb_series" ? { "data-first": "" } : {})}>
        {item.type === "CB" ? (
          item.name === "cmb_series" ? (
            <SearchCombo ariaLabel={item.label} options={item.options} value={item.options.find((option) => option.text === value) ?? null} onChoose={(option) => void chooseSeries(option.text)} />
          ) : (
            <select id={`ent-${item.name}`} className="mp-control" aria-label={item.label} value={value} onChange={(event) => set(event.target.value)}>
              {item.options.map((option) => <option key={`${option.value}-${option.text}`} value={option.text}>{option.text}</option>)}
            </select>
          )
        ) : item.type === "DT" ? (
          <DateField ariaLabel={item.label} value={value} tools={tools} required={item.compulsory} onChange={set} />
        ) : item.name === "tbx_partyname" ? (
          <input
            id={`ent-${item.name}`}
            ref={partyRef}
            className="mp-control"
            role="combobox"
            aria-label={item.label}
            aria-expanded={helpOpen}
            aria-controls="ent-account-help"
            autoComplete="off"
            value={value}
            title="Down arrow (or F2): the account help · Enter takes the highlighted account"
            onChange={(event) => { set(event.target.value); setHelpAt(0); if (!helpOpen) void openHelp(); }}
            onKeyDown={partyKeys}
          />
        ) : item.name === "tbx_narration" ? (
          <textarea id={`ent-${item.name}`} className="mp-control ent-narration" aria-label={item.label} maxLength={item.maxLength > 0 ? item.maxLength : undefined} value={value} onChange={(event) => set(event.target.value.replace(/'/g, ""))} />
        ) : (
          <input id={`ent-${item.name}`} className="mp-control" aria-label={item.label} maxLength={item.maxLength > 0 ? item.maxLength : undefined} value={value} onChange={(event) => set(event.target.value)} />
        )}
      </span>,
    ];
  };

  const productColumns = useMemo(() => book?.product.columns.filter((column) => column.visible) ?? [], [book]);
  const frozenLefts = useMemo(() => {
    const lefts: number[] = [];
    let left = 0;
    for (let index = 0; index < (book?.product.frozen ?? 0) && index < productColumns.length; index += 1) { lefts.push(left); left += productColumns[index].width; }
    return lefts;
  }, [book, productColumns]);
  const productCell = (column: EntryColumn, row: number) => (column.key.toLowerCase() === "il_serial" ? String(row + 1) : "");

  const headControls = book?.controls.filter((item) => item.place === "T") ?? [];
  const footControls = book?.controls.filter((item) => item.place === "B") ?? [];
  const ewayControls = book?.controls.filter((item) => item.place === "E" && (def?.ewayDates || !["dtp_ewaydate", "tbx_ewayvalid"].includes(item.name))) ?? [];
  const showParty = Boolean(book?.party && headControls.some((item) => item.name === "tbx_partyname"));
  const slabGridRows = slab.map((row) => ({ slab_order: String(row.order), slab_mathoper: row.sign, slab_desc: row.desc, slab_perc: row.perc, slab_amount: row.amount, s_lastot: "0.00" }));

  if (fatal) return <div className="mp-screen"><p className="mp-error">{fatal}</p><button type="button" className="mp-btn mp-btn-red" onClick={onClose}><Icon name="quit" />Quit</button></div>;

  return (
    <div ref={screenRef} className={`mp-screen ent-screen ${locked && def ? "mp-locked" : ""}`} role="region" aria-label={def?.caption || title}>
      <div className="ent-scroll">
        <div ref={formRef} className="ent-form" role="group" aria-label={def?.caption || title}>
          <div className="ent-head" role="group" aria-label={`${def?.caption || title} header`}>
            <label className="ent-label ent-register-label" style={{ left: 2, top: 6, width: 84 }} htmlFor="ent-register">{def?.firstCombo.label ?? "Register"}</label>
            <span className="ent-box ent-register" style={{ left: 86, top: 6, width: 317 }} id="ent-register">
              <SearchCombo
                ariaLabel={def?.firstCombo.label ?? "Register"}
                options={def?.firstCombo.options ?? []}
                value={register}
                reselect
                disabled={locked || !def || Boolean(busy && busy !== "")}
                focus={!locked && !book && Boolean(def)}
                onChoose={(option) => void chooseRegister(option)}
              />
            </span>
            {book && <span className="ent-side" style={{ left: 406, top: 6 }} title="Book posting side">{book.side}</span>}
            {book?.balance && <span className="ent-balance" style={{ left: 238, top: 28 }} title="Book balance as on the last date of the year">{book.balance}</span>}
            {headControls.flatMap(control)}
            {book && headControls.some((item) => item.name === "dtp_date") && <span className="ent-day" style={{ left: 204, top: 50 }}>{dayOf(values.dtp_date ?? "")}</span>}
            {book && headControls.some((item) => item.name === "dtp_chlndate") && <span className="ent-day" style={{ left: 204, top: 72 }}>{dayOf(values.dtp_chlndate ?? "")}</span>}
            {showParty && (
              <>
                <span className="ent-label" style={{ left: 509, top: 28, width: 74 }}>Address</span>
                <ul className="ent-address" style={{ left: 589, top: 28, width: 427, height: 69 }} aria-label="Party address" title="Closing balance, address, telephone, GST number, opening balance, credit days and limit">
                  {(party?.address ?? []).map((line, index) => <li key={index}>{line}</li>)}
                </ul>
              </>
            )}
            {helpOpen && help && (
              <div id="ent-account-help" className="ent-help" style={{ left: 86, top: TAB_TOP, width: 930 }} role="listbox" aria-label="Account help">
                <div className="ent-help-scroll">
                  <table>
                    <thead><tr>{help.columns.map((column) => <th key={column.key} style={{ width: column.width, minWidth: column.width, textAlign: column.align === "R" ? "right" : "left" }}>{column.caption}</th>)}</tr></thead>
                    <tbody>
                      {shownHelp.map((row, index) => (
                        <tr key={`${row.CODE}-${index}`} className={index === helpAt ? "ent-help-current" : index % 2 ? "ent-alt" : ""} ref={index === helpAt ? (element) => element?.scrollIntoView({ block: "nearest" }) : undefined} onMouseDown={(event) => { event.preventDefault(); setHelpAt(index); }} onDoubleClick={() => void choosePartyRow(row)}>
                          {help.columns.map((column) => <td key={column.key} style={{ textAlign: column.align === "R" ? "right" : "left" }}>{column.format === "N2" ? amount(row[column.key] ?? "", 2) : row[column.key] ?? ""}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="ent-help-foot">{help.total}{shownHelp.length < help.rows.length ? ` · showing ${shownHelp.length}` : ""} · ↑↓ move · Enter take · Esc close</div>
              </div>
            )}
          </div>

          {book && (
            <div className="ent-tabs" style={{ top: TAB_TOP }}>
              <div className="ent-tab-strip" role="tablist">
                <button type="button" role="tab" aria-selected={tab === "all"} className={tab === "all" ? "ent-tab-on" : ""} onClick={() => void openTab("all")}>Product &amp; Slab</button>
                {def?.tabs.outstanding && <button type="button" role="tab" aria-selected={tab === "outstanding"} className={tab === "outstanding" ? "ent-tab-on" : ""} onClick={() => void openTab("outstanding")}>Outstanding</button>}
                <button type="button" role="tab" aria-selected={tab === "find"} className={tab === "find" ? "ent-tab-on" : ""} onClick={() => void openTab("find")}>Find / Edit</button>
                {def?.tabs.eway && <button type="button" role="tab" aria-selected={tab === "eway"} className={tab === "eway" ? "ent-tab-on" : ""} onClick={() => void openTab("eway")}>E-Way Bill</button>}
              </div>
              <div className="ent-page" role="tabpanel">
                {tab === "all" && (
                  <>
                    {book.inventory ? (
                      <div className="ent-grid ent-product" style={{ left: 3, top: 0, width: 1011, height: 234 }} role="grid" aria-label="Products" title="Choosing products and their rates is the next part to be ported">
                        <table>
                          <thead>
                            <tr>
                              {productColumns.map((column, index) => (
                                <th key={column.key} className={`${index < frozenLefts.length ? "ent-frozen" : ""} ${column.editable ? "" : "ent-head-readonly"}`} style={{ width: column.width, minWidth: column.width, left: frozenLefts[index], textAlign: column.align === "R" ? "right" : "left" }} title={column.tooltip || undefined}>{column.caption}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {Array.from({ length: book.product.rows }, (_unused, row) => (
                              <tr key={row} className={row % 2 ? "ent-alt" : ""}>
                                {productColumns.map((column, index) => (
                                  <td key={column.key} className={`${index < frozenLefts.length ? "ent-frozen" : ""} ${column.editable ? "ent-open" : ""}`} style={{ left: frozenLefts[index], textAlign: column.align === "R" ? "right" : "left" }}>{productCell(column, row)}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="ent-note" style={{ left: 3, top: 0, width: 1011 }}>This book takes no product rows: the amount goes in the slab grid&apos;s first row.</div>
                    )}
                    {book.slab && (
                      <SideGrid
                        label="Slab"
                        style={{ left: 3, top: 260, width: 510, height: 131 }}
                        columns={book.grids.slab}
                        rows={slabGridRows}
                        cell={(row, column) => {
                          const item = slab[row];
                          if (column.key === "slab_perc" && item.options && item.options.length > 0) {
                            return (
                              <select className="ent-cell-select" aria-label={`${item.desc} tax`} value={item.perc} onChange={(event) => { const perc = event.target.value; setSlab((rows) => rows.map((candidate, index) => (index === row ? { ...candidate, perc } : candidate))); }}>
                                {item.options.map((option) => <option key={option.value} value={option.text}>{option.text}</option>)}
                              </select>
                            );
                          }
                          const value = slabGridRows[row][column.key as keyof (typeof slabGridRows)[number]] ?? "";
                          return column.align === "R" && column.decimals > 0 ? amount(value, column.decimals) : value;
                        }}
                      />
                    )}
                    <SideGrid
                      label="Addon"
                      style={{ left: 511, top: 260, width: 498, height: 131 }}
                      columns={book.grids.addon}
                      rows={(party?.addon ?? []).map((item) => ({ addon_label: item.label, addon_input: addon[item.key] ?? "" }))}
                      empty={showParty ? "Choose the party: its addon fields show here" : undefined}
                      cell={(row, column) => {
                        const item = party!.addon[row];
                        if (column.key !== "addon_input") return item.label;
                        const value = addon[item.key] ?? "";
                        const set = (next: string) => setAddon((current) => ({ ...current, [item.key]: next }));
                        return item.options
                          ? <select className="ent-cell-select" aria-label={item.label} value={value} onChange={(event) => set(event.target.value)}>{item.options.map((option) => <option key={option.value} value={option.text}>{option.text}</option>)}</select>
                          : <input className="ent-cell-input" aria-label={item.label} value={value} onChange={(event) => set(event.target.value)} />;
                      }}
                    />
                  </>
                )}
                {tab === "outstanding" && (
                  <SideGrid label="Outstanding" style={{ left: 11, top: 15, width: 582, height: 249 }} columns={book.grids.outstanding} rows={party?.outstanding ?? []} empty={party ? "No pending entries for this party" : "Choose the party first"} />
                )}
                {tab === "find" && (
                  <SideGrid
                    label="Entries"
                    style={{ left: 3, top: 3, width: 1015, height: 367 }}
                    columns={(preview?.columns ?? []).filter((column) => column.key !== "Tick").map((column) => ({ key: column.key, caption: column.caption, width: column.width, align: column.align === "R" || column.format === "N2" || column.format === "N" ? "R" : "L", decimals: column.format === "N2" ? 2 : 0, editable: false }))}
                    rows={preview?.rows ?? []}
                    empty={preview ? "No entries in this series" : "Loading…"}
                  />
                )}
                {tab === "find" && preview && <div className="ent-help-foot" style={{ position: "absolute", left: 3, top: 372 }}>{preview.total} · opening an entry to view or edit is not ported yet</div>}
                {tab === "eway" && <div className="ent-eway">{ewayControls.flatMap(control)}</div>}
              </div>
            </div>
          )}

          {book && (
            <div className="ent-foot">
              <span className="ent-label ent-final-label" style={{ left: 2, top: 533, width: 130 }}>Entry Final Amt.:</span>
              <output className="ent-final" style={{ left: 138, top: 533, width: 101 }} aria-label="Entry final amount">0.00</output>
              {footControls.flatMap(control)}
            </div>
          )}
        </div>
      </div>

      <div className="ent-status" aria-live="polite">
        {busy && <span className="mp-busy">{busy}…</span>}
        {book && <span>{def?.statusHead} · {register?.text} · {book.entryFor}</span>}
        {warnings.map((warning) => <span key={warning} className="ent-warning" title={warning}>⚠ {warning}</span>)}
      </div>

      <div className="ent-toolbar" role="toolbar" aria-label="Entry buttons">
        <button type="button" className="mp-btn mp-btn-green" data-hotkey="s" aria-keyshortcuts="Alt+S" disabled={!book} title="Saving an invoice is not ported yet" onClick={notPorted("Save")}><Icon name="save" /><HotkeyLabel text="Save" hotkey="s" /></button>
        <button type="button" className="mp-btn mp-btn-blue" data-hotkey="c" aria-keyshortcuts="Alt+C" disabled={!book} onClick={() => register && void chooseRegister(register)}><Icon name="cancel" /><HotkeyLabel text="Cancel" hotkey="c" /></button>
        <button type="button" className="mp-btn mp-btn-blue" data-hotkey="d" aria-keyshortcuts="Alt+D" disabled={!book} title="Deleting an invoice is not ported yet" onClick={notPorted("Delete")}><Icon name="clear" /><HotkeyLabel text="Delete" hotkey="d" /></button>
        <button type="button" className="mp-btn mp-btn-blue" data-hotkey="p" aria-keyshortcuts="Alt+P" disabled={!book} title="Printing an invoice is not ported yet" onClick={notPorted("Print")}><Icon name="print" /><HotkeyLabel text="Print" hotkey="p" /></button>
        <button type="button" className="mp-btn mp-btn-blue" data-hotkey="r" aria-keyshortcuts="Alt+R" disabled={!book} onClick={() => { setHelp(null); setPreview(null); if (tab === "find") setTab("all"); }}><Icon name="refresh" /><HotkeyLabel text="Refresh" hotkey="r" /></button>
        <button type="button" className="mp-btn mp-btn-blue" data-hotkey="g" aria-keyshortcuts="Alt+G" disabled={!book} title="Range print is not ported yet" onClick={notPorted("Range print")}><Icon name="list" /><HotkeyLabel text="Range" hotkey="g" /></button>
        {def?.buttons.upload && <button type="button" className="mp-btn mp-btn-blue" disabled={!book} title="Upload document is not ported yet" onClick={notPorted("Upload document")}><Icon name="image" />Upload Document</button>}
        {def?.buttons.einvoice && <button type="button" className="mp-btn mp-btn-blue" disabled={!book} title="E-invoice is not ported yet" onClick={notPorted("E-invoice")}><Icon name="export" />E-Invoice</button>}
        {def?.buttons.log && <button type="button" className="mp-btn mp-btn-blue" disabled={!book} title="The entry log is not ported yet" onClick={notPorted("Log")}><Icon name="log" />Log</button>}
        <button type="button" className="mp-btn mp-btn-red" data-hotkey="q" aria-keyshortcuts="Alt+Q" onClick={() => void quit()}><Icon name="quit" /><HotkeyLabel text="Quit" hotkey="q" /></button>
      </div>
      {tools.popups}
    </div>
  );
}
