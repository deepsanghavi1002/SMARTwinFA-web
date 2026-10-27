"use client";

import { activeScope, useWindowActive, useWindowActiveNow } from "../ui/activeWindow";
import { useWindowLink } from "../ui/windowLink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStartupSelection } from "../startup/StartupGate";
import { parseDesktopDate } from "../../lib/master-program/legacy";
import { accountHelpBooks } from "../../lib/report/registerBooks";
import type { ControlItem, HelpGrid as HelpGridData, ReportDefinition, ReportOutput, ReportSelection } from "../../lib/report/types";
import { reportCall, viewsCall } from "./api";
import { SavedViews } from "./SavedViews";
import type { SavedView } from "./SavedViews";
import type { GroupSpec } from "../../lib/report/groupBy";
import type { PivotHint, SumifHint } from "../../lib/report/pivotHint";
import type { Refusal } from "./api";
import { HelpGrid } from "./HelpGrid";
import { OutputGrid } from "./OutputGrid";
import type { CompareResult } from "./ReportCompare";
import type { OutputStatus } from "./OutputGrid";
import type { LogTable } from "../grid/LogViewer";
import { ReportList } from "./ReportList";
import { useEditorTools } from "../grid/EditorTools";
import { DateField } from "../grid/DateField";
import { messageBox } from "../ui/MessageBox";
import { HotkeyLabel, useAltHotkeys } from "../ui/hotkeys";
import { Icon } from "../ui/Icon";
import { ScreenStatus } from "../ui/ScreenStatus";
import { SearchCombo } from "../ui/SearchCombo";

/**
 * Report_Combine, the one screen every REPORT menu opens (Main Ledger, Day Book, Trial Balance ...).
 * The menu names a report_properties report; its selection tab (first combo, dates, groups,
 * filter / sort / format lists, the options grid and the help grids to tick from) all come from
 * that report's setup, and OK generates the output on the server (lib/report).
 *
 * Output tab: the report as the desktop's C1_OUTPUT shows it: headings, opening, entries, closing,
 * a subtotal under each group and the final total; F6 summarises to the totals, F4 shows all.
 */


/** Dates last used by a report this session (Lib_GlobalVariables rep_from_date / rep_upto_date), kept in sessionStorage. */
const LAST_DATES = "smartwinfa.report.lastDates";
function readLastDates(): { from: string; upto: string } | null {
  try { const text = sessionStorage.getItem(LAST_DATES); return text ? JSON.parse(text) as { from: string; upto: string } : null; } catch { return null; }
}
function saveLastDates(dates: { from: string; upto: string }) {
  try { sessionStorage.setItem(LAST_DATES, JSON.stringify(dates)); } catch { /* private window: the dates are not remembered */ }
}

const itemKey = (item: ControlItem) => `${item.controlValKey}|${item.value}`;
const OPTIONS_GRID = "C1_CHECKBOX";
/** The status line message as each list gets the keyboard (Lbox_Filter_Enter ...). */
const LIST_MESSAGES: Readonly<Record<string, string>> = {
  lbox_Filter: "Filters data with provided input",
  lBox_Sorting: "Sorts data with provided input",
  lBox_Formating: "Report is formatted with provided input",
  lbox_InputCols: "Report is valueted with provided input",
};
const EMPTY_TICKS: ReadonlySet<string> = new Set();
const addonKey = (row: Readonly<Record<string, string>>) => `${row.fiel_key ?? row.FIEL_KEY ?? ""}|${row.sub_code ?? row.SUB_CODE ?? ""}`;

/**
 * The account help narrowed to the chosen book. Form Summary's own (first combo) help lists the accounts of the books the
 * register covers (REGISTER : SALE gives the sale books, debit note and credit note, all ticked until changed); the Account tab of
 * every other report lists the parties of the chosen book (EXPENSE gives the general accounts, book 1; SALE the debtors, 2; PURCHASE the creditors, 3; Party
 * Wise Rate's LESS the debtors, ADD the creditors; Budget's DEBTORS the debtors, CREDITORS the creditors). An entry with no book, or
 * books none of the rows has, leaves every row.
 */
/** The outstanding reports (ageing 5 and 20, clearance 21, interest 32, party wise bill pdf 255) and the register reports (14, 18, 127): the combo's value is the book number when the combo gives no book column. */
/** Reports whose first combo (REGISTER) has its own Account help: Form Summary, Yearly Tax Summary and GST Form Summary. */
const FORM_SUMMARY_LIKE: ReadonlySet<number> = new Set([14, 18, 127]);
const OUTSTANDING: ReadonlySet<number> = new Set([5, 20, 21, 32, 255]);
/** Party Wise Rate's side (first combo): LESS (0) is the sale side, the debtors (book 2); ADD (1) the purchase side, the creditors (book 3). */
const PARTY_RATE_BOOK: Readonly<Record<string, number>> = { 0: 2, 1: 3 };
/** Reports whose first combo's value is the account book itself (Budget: DEBTORS 2, CREDITORS 3), whatever book column its rows carry. */
const ACCOUNT_BOOK_COMBO: ReadonlySet<number> = new Set([42]);

function accountScopeOf(def: ReportDefinition | null, first: string): { help: HelpGridData; keep: (row: Readonly<Record<string, string>>) => boolean; defaultTicked: boolean } | null {
  if (!def) return null;
  const option = def.firstCombo.options.find((candidate) => candidate.value === first);
  const book = def.key === 9 ? PARTY_RATE_BOOK[first] : ACCOUNT_BOOK_COMBO.has(def.key) ? (/^\d+$/.test(first) ? Number(first) : undefined) : option?.book ?? ((OUTSTANDING.has(def.key) || FORM_SUMMARY_LIKE.has(def.key)) && /^\d+$/.test(first) ? Number(first) : undefined);
  if (book === undefined || book < 0) return null;
  const help = FORM_SUMMARY_LIKE.has(def.key) ? def.helps.find((candidate) => candidate.first) : def.helps.find((candidate) => candidate.grid === "C1HelpAccount" && !candidate.first);
  const books = accountHelpBooks(def.key, book, help?.first === true);
  const bookKey = Object.keys(help?.rows[0] ?? {}).find((key) => key.toLowerCase() === "book");
  if (!help || !books || !bookKey) return null;
  const keep = (row: Readonly<Record<string, string>>) => books.includes(Number(row[bookKey]));
  return help.rows.some(keep) ? { help, keep, defaultTicked: FORM_SUMMARY_LIKE.has(def.key) } : null;
}

export function ReportCombine({ reportName, menuShortName, title, onClose, zoomAccount, autoRun, autoFrom, autoTo, autoPivot, autoPick, autoParty, autoSumif, autoSetup }: { autoRun?: boolean; /** Choices (control name to item text) and options to tick as an Ask AI report opens. */ autoSetup?: { choices: Readonly<Record<string, string>>; checks: readonly string[] }; /** A SUMIF Ask AI asked for: worked out on the output when the report has run. */ autoSumif?: SumifHint; /** One account Ask AI named: the Account group is ticked and only this account is picked in its list. */ autoParty?: { code: number; name: string }; /** The question Ask AI was asked: the first combo (SALE, PURCHASE ...) is chosen from the words in it. */ autoPick?: string; /** A pivot Ask AI asked for, set up when the report has run. */ autoPivot?: PivotHint; /** The dates (YYYY-MM-DD) an Ask AI report is run for. */ autoFrom?: string; autoTo?: string; reportName: string; menuShortName: string; title: string; onClose: () => void; /** Zoom from a report row: the account whose Ledger opens (ticked in the Account help, the report run). */ zoomAccount?: number }) {
  const selection = useStartupSelection();
  const [def, setDef] = useState<ReportDefinition | null>(null);
  const [fatal, setFatal] = useState("");
  const [busy, setBusy] = useState("Loading");
  const [tab, setTab] = useState<"select" | "output">("select");
  const [first, setFirst] = useState("");
  const [from, setFrom] = useState("");
  const [upto, setUpto] = useState("");
  const [groups, setGroups] = useState<string[]>([]);
  const [choices, setChoices] = useState<Record<string, string>>({});
  /** The items of the combo the first combo's entry fills (Cmb_FirstCombo_Leave: the day book's series). */
  const [lostItems, setLostItems] = useState<ControlItem[] | null>(null);
  const [columnsTicked, setColumnsTicked] = useState<string[]>([]);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const textDefaults = useRef<Record<string, string>>({});
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [ticks, setTicks] = useState<Record<string, Set<string>>>({});
  /** The register (first combo entry) whose Account ticks the operator has changed; until then every listed account is ticked, as on the desktop. */
  const [firstEdited, setFirstEdited] = useState<string | null>(null);
  /** The Against Book entries of a credit / debit note register (null: the setup's own list). */
  const [againstItems, setAgainstItems] = useState<ControlItem[] | null>(null);
  /** The Register's Include / Exclude Slab list (lbchk_Slabs, built by the program) and its ticked slab keys. */
  const [slabItems, setSlabItems] = useState<ControlItem[] | null>(null);
  const [slabsTicked, setSlabsTicked] = useState<string[]>([]);
  /** A saved view's choice for the lost-focus combo, kept when that combo is refilled. */
  const viewChoice = useRef<string | null>(null);
  /** What waits for the first combo's lists to be refilled (the run Ask AI asked for, on the register it named). */
  const afterFirst = useRef<(() => void) | null>(null);
  const [viewsOpen, setViewsOpen] = useState(false);
  /** The Group By of the output on screen, and the one a saved view starts the next output with. */
  const groupByNow = useRef<readonly GroupSpec[]>([]);
  const [startGroupBy, setStartGroupBy] = useState<readonly GroupSpec[]>([]);
  const [helpTab, setHelpTab] = useState("");
  const [addonField, setAddonField] = useState("");
  const [focusHelp, setFocusHelp] = useState(0);
  const [output, setOutput] = useState<ReportOutput | null>(null);
  /** Each generation starts the output grid afresh (cursor, tree, borders). */
  const [outputRun, setOutputRun] = useState(0);
  const [message, setMessage] = useState("");
  /** The status line: the hot keys of the control in use, and whether the message is an error (red). */
  const [hotKeys, setHotKeys] = useState("");
  const [messageRed, setMessageRed] = useState(false);
  /** The tooltip under the mouse, shown in the status line while it is there. */
  const [tip, setTip] = useState("");
  const [version, setVersion] = useState("");
  /** Where a help grid puts its search box: the right of the help tabs' line. */
  const [findSlot, setFindSlot] = useState<HTMLSpanElement | null>(null);
  const say = useCallback((text: string, keys = "", red = false) => { setMessage(text); setHotKeys(keys); setMessageRed(red); }, []);
  const screen = useRef<HTMLDivElement>(null);
  /** The selection's list boxes, for Tab out of a help grid. */
  const listRefs = useRef<Record<string, HTMLDivElement | null>>({});
  useAltHotkeys(screen);
  const yearStart = useMemo(() => (def ? parseDesktopDate(def.dates.yearStart) : null), [def]);
  const tools = useEditorTools(yearStart);

  const call = useCallback(<T,>(action: string, payload: Record<string, unknown> = {}) => {
    if (!selection) throw new Error("No company is open");
    return reportCall<T>(selection, reportName, menuShortName, action, payload);
  }, [selection, reportName, menuShortName]);
  const refuse = (refusal: Refusal) => messageBox.ask(refusal.message, refusal.caption, ["OK"], { kind: "warning" });

  // Report_Combine_Load.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const reply = await call<{ report: ReportDefinition; runtimeDefaults?: Record<string, string>; warnings: string[]; version?: string }>("report");
        if (!live) return;
        const report = reply.report;
        if (report.rights.modulePassword) {
          const typed = await messageBox.prompt("Enter Module Password", "Module Password", { password: true });
          if (typed === null) { onClose(); return; }
          const check = await call<{ ok: boolean; message: string }>("module-password", { password: typed });
          if (!check.ok) { await messageBox.alert(check.message || "Invalid Password", "Module Password"); onClose(); return; }
        }
        setDef(report);
        // The amounts the report's own queries give (Profit / Loss: Opening Amount from LAST_YEAR, Closing Amount from OS_BILLDIFF) fill their boxes as it opens.
        textDefaults.current = reply.runtimeDefaults ?? {};
        setTexts({ ...textDefaults.current });
        setVersion(reply.version ?? "");
        setFirst(report.firstCombo.options[0]?.value ?? "");
        const lastDates = readLastDates();
        setFrom(report.dates.fromLast && lastDates ? lastDates.from : report.dates.from);
        setUpto(report.dates.uptoLast && lastDates ? lastDates.upto : report.dates.upto);
        setChoices(Object.fromEntries(report.controls.filter((control) => control.type === "L" || control.type === "C").map((control) => [control.name, control.items[0] ? itemKey(control.items[0]) : ""])));
        setColumnsTicked(report.controls.find((control) => control.name === "lbchk_Col_Select")?.initiallyTicked.slice() ?? []);
        setChecks(Object.fromEntries(report.checkboxes.map((check) => [check.name, check.value])));
        setTicks(Object.fromEntries(report.helps.map((help) => [help.grid, new Set<string>()])));
        setHelpTab(report.checkboxes.some((check) => check.visible) ? OPTIONS_GRID : report.helps.find((help) => report.helpTabs.includes(help.grid.replace("C1Help", "Tab_")))?.grid ?? report.helps[0]?.grid ?? "");
        if (reply.warnings.length > 0) setMessage(`Setup warnings: ${reply.warnings.length}`);
      } catch (error) {
        if (live) setFatal(error instanceof Error ? error.message : String(error));
      } finally {
        if (live) setBusy("");
      }
    })();
    return () => { live = false; };
  }, [call, onClose]);

  // Cmb_FirstCombo_Leave: the chosen entry refills its combo (the series of the account's book), first item chosen.
  useEffect(() => {
    if (!def || def.lostFocusControl === "") return;
    let live = true;
    const name = def.lostFocusControl;
    call<{ control: string; items: ControlItem[]; warnings?: string[] }>("lostfocus", { selection: { firstCombo: first } })
      .then((reply) => {
        if (!live) return;
        setLostItems(reply.items);
        // The list the chosen entry fills (the series, the Against Book): a failed query shows its message instead of an empty list.
        if (reply.warnings && reply.warnings.length > 0) setMessage(`${name} : ${reply.warnings[0].slice(0, 400)}`);
        const kept = viewChoice.current;
        viewChoice.current = null;
        const waiting = afterFirst.current;
        afterFirst.current = null;
        setChoices((current) => ({ ...current, [name]: kept && reply.items.some((item) => itemKey(item) === kept) ? kept : reply.items[0] ? itemKey(reply.items[0]) : "" }));
        waiting?.();
      })
      .catch((error: unknown) => { if (live) setMessage(error instanceof Error ? error.message : String(error)); });
    return () => { live = false; };
  }, [def, first, call]);

  // The Against Book combo (cmb_AgainstBook) follows the register: a credit note is against the sale, a debit note against the purchase.
  useEffect(() => {
    if (!def || def.lostFocusControl === "cmb_AgainstBook" || !def.controls.some((candidate) => candidate.type === "C" && candidate.name === "cmb_AgainstBook")) return;
    let live = true;
    call<{ control: string; items: ControlItem[] }>("against", { selection: { firstCombo: first } })
      .then((reply) => {
        if (!live) return;
        setAgainstItems(reply.items);
        setChoices((current) => ({ ...current, cmb_AgainstBook: reply.items[0] ? itemKey(reply.items[0]) : "" }));
      })
      .catch((error: unknown) => { if (live) setMessage(error instanceof Error ? error.message : String(error)); });
    return () => { live = false; };
  }, [def, first, call]);

  // The keyboard starts in the first combo (or the groups when the report has none).
  useEffect(() => {
    if (!def) return;
    const start = screen.current?.querySelector<HTMLElement>(".rp-top input, .rp-top button") ?? listRefs.current.group;
    start?.focus();
  }, [def]);

  const control = (name: string) => def?.controls.find((candidate) => candidate.name === name);
  const groupControl = control("lbchk_Group");
  const chosenItem = (name: string) => control(name)?.items.find((item) => itemKey(item) === choices[name]);
  // Runtime boxes a chosen filter or sort shows (HideOrShowMe with visible_controls_lst).
  const shownRuntime = new Set([chosenItem("lbox_Filter")?.showControls ?? "", chosenItem("lBox_Sorting")?.showControls ?? ""].flatMap((list) => list.split(",")).map((name) => name.trim()).filter(Boolean));
  /** The filter's own list the program builds (Include / Exclude Slab: lbchk_Slabs; Include / Exclude Form: lbchk_Forms), "" when none. */
  const filterList = (chosenItem("lbox_Filter")?.showControls ?? "").split(",").map((name) => name.trim()).find((name) => (name === "lbchk_Slabs" || name === "lbchk_Forms") && !def?.controls.some((candidate) => candidate.name === name)) ?? "";
  const slabListShown = filterList !== "";
  const againstChoice = choices.cmb_AgainstBook ?? "";

  // Include / Exclude Slab: the slabs of the chosen register's book (a return's: the book it is against); Include / Exclude Form: the tax
  // masters. Ticks no longer listed drop, and all of them when the list changes between slabs and forms (their keys are different numbers).
  const filterListOf = useRef("");
  useEffect(() => {
    if (!slabListShown) return;
    let live = true;
    const switched = filterListOf.current !== filterList;
    filterListOf.current = filterList;
    call<{ control: string; items: ControlItem[] }>(filterList === "lbchk_Forms" ? "forms" : "slabs", { selection: { firstCombo: first, choices: { cmb_AgainstBook: againstChoice } } })
      .then((reply) => {
        if (!live) return;
        setSlabItems(reply.items);
        setSlabsTicked((current) => (switched ? [] : current.filter((key) => reply.items.some((item) => item.value === key))));
      })
      .catch((error: unknown) => { if (live) setMessage(error instanceof Error ? error.message : String(error)); });
    return () => { live = false; };
  }, [slabListShown, filterList, first, againstChoice, call]);
  const groupOfGrid = (grid: string) => groupControl?.items.filter((item) => item.showControls === grid && groups.includes(itemKey(item))) ?? [];

  /** Ticking a group shows its help tab (MoveFocus); an addon group shows its own subs in the addon grid. */
  const tickGroup = (item: ControlItem, on: boolean) => {
    setGroups((current) => {
      const next = on ? [...current.filter((key) => key !== itemKey(item)), itemKey(item)] : current.filter((key) => key !== itemKey(item));
      if (next.length === 0 && checks.CHK_GRPASHD) {
        setCheck("CHK_GRPASHD", false);
      }
      return next;
    });
    if (on && item.showControls) {
      setHelpTab(item.showControls);
      if (Number(item.value) > 0) setAddonField(item.value);
      setFocusHelp((count) => count + 1);
    }
  };

  /** C1_CHECKBOX_AfterEdit, SYS.CHK: an option's partner (unticked_for_id / ticked_for_id) follows it. */
  const setCheck = (name: string, value: boolean) => {
    if (!def) return;
    const row = def.checkboxes.find((check) => check.name === name);
    // SYS.ENABLE with the Filter (the stock report's valuation options): the option can be ticked only with a Filter other than the one it is hidden for ("None");
    // ticked, it ticks the option that names it in TICKED_FOR_ID (Valuation On Factor Column ticks Print Factor Column).
    const filterDenies = value && row?.sysValue.toUpperCase() === "SYS.ENABLE" && row.hideAgainstControl.toLowerCase() === "lbox_filter" && chosenItem("lbox_Filter") !== undefined
      && chosenItem("lbox_Filter")!.text.trim().toUpperCase() === row.hideFor.trim().toUpperCase();
    if (filterDenies) { say(`${row!.caption.trim()} : choose a Filter (not ${row!.hideFor}) first`, "", true); return; }
    setChecks((current) => {
      const next = { ...current, [name]: value };
      if (value && row?.sysValue.toUpperCase() === "SYS.ENABLE" && row.hideAgainstControl.toLowerCase() === "lbox_filter") {
        const partner = def.checkboxes.find((check) => check.tickedForId === name);
        if (partner) next[partner.name] = true;
      }
      if (row?.sysValue.toUpperCase() === "SYS.CHK") {
        const untick = def.checkboxes.find((check) => check.untickedForId === name);
        const tick = def.checkboxes.find((check) => check.tickedForId === name);
        if (untick) next[untick.name] = false;
        else if (tick) next[tick.name] = true;
      }
      return next;
    });
  };

  /** A grid's ticks; the first combo's help drops the ticks of accounts the chosen register no longer lists. */
  const ticksOf = (grid: string): ReadonlySet<string> => {
    const ticked = ticks[grid] ?? EMPTY_TICKS;
    const scope = accountScopeOf(def, first);
    if (!scope || scope.help.grid !== grid) return ticked;
    const allowed = new Set(scope.help.rows.filter(scope.keep).map((row) => row[scope.help.keyColumn] ?? ""));
    if (scope.defaultTicked && firstEdited !== first) return allowed;
    return [...ticked].every((key) => allowed.has(key)) ? ticked : new Set([...ticked].filter((key) => allowed.has(key)));
  };
  const selectionNow = (): ReportSelection => ({
    firstCombo: first,
    from,
    upto,
    groups,
    ticks: Object.fromEntries(Object.keys(ticks).map((grid) => [grid, [...ticksOf(grid)]])),
    choices: slabListShown ? { ...choices, [filterList]: slabsTicked.join(",") } : choices,
    columns: columnsTicked,
    texts,
    checks,
  });

  // Saved views (web only).
  const listViews = useCallback(async () => (await viewsCall<{ views: SavedView[] }>(selection!, reportName, menuShortName, "list")).views, [selection, reportName, menuShortName]);
  const saveView = async (name: string) => { await viewsCall(selection!, reportName, menuShortName, "save", { name, payload: { selection: selectionNow(), groupBy: groupByNow.current } }); };
  const removeView = async (name: string) => { await viewsCall(selection!, reportName, menuShortName, "delete", { name }); };
  const applyView = (view: SavedView, keepDates: boolean) => {
    const saved = view.payload as { selection?: Partial<ReportSelection>; groupBy?: GroupSpec[] } | null;
    const chosen = saved?.selection;
    if (!chosen) return;
    const choice = def?.lostFocusControl ? chosen.choices?.[def.lostFocusControl] : undefined;
    viewChoice.current = (chosen.firstCombo ?? "") !== first ? choice ?? null : null;
    setFirst(chosen.firstCombo ?? "");
    setFirstEdited(chosen.firstCombo ?? "");
    if (!keepDates) { setFrom(chosen.from ?? from); setUpto(chosen.upto ?? upto); }
    setGroups([...(chosen.groups ?? [])]);
    setTicks(Object.fromEntries(Object.entries(chosen.ticks ?? {}).map(([grid, keys]) => [grid, new Set(keys)])));
    setChoices({ ...(chosen.choices ?? {}) });
    setColumnsTicked([...(chosen.columns ?? [])]);
    setTexts({ ...(chosen.texts ?? {}) });
    setChecks({ ...(chosen.checks ?? {}) });
    setStartGroupBy(saved?.groupBy ?? []);
    groupByNow.current = saved?.groupBy ?? [];
    setViewsOpen(false);
    say(`View "${view.name}" applied. Press OK to run it.`);
  };

  /** The selection the output was generated from, for Create Group. */
  const generatedWith = useRef<ReportSelection | null>(null);
  /** The dates the output on screen is for (Compare periods). */
  const [generatedPeriod, setGeneratedPeriod] = useState({ from: "", upto: "" });
  // Btn_ok_Click: GenerateReport.
  const generate = async (quiet = false): Promise<boolean> => {
    if (!def || busy) return false;
    if (!def.ported) {
      await messageBox.alert(`${def.head || title} is not available in the web version yet.\nIts output has not been ported; the selection can be seen but not run.`, "Not ported yet");
      return false;
    }
    if (def.dates.fromVisible && def.dates.uptoVisible && from === upto) {
      const yes = await messageBox.confirm(`It Seems You Have Selected From And Upto Date\nSame As ${from}\nIt Will Generate Report Only For ${from}\n\nAre You Sure You Want To Continue?`, "Same Date Selection");
      if (!yes) return false;
    }
    saveLastDates({ from, upto });
    setBusy("Generating report");
    say("Reading database and collecting data for inputs...");
    try {
      const chosen = selectionNow();
      const reply = await call<{ output: ReportOutput }>("generate", { selection: chosen });
      generatedWith.current = chosen;
      setGeneratedPeriod({ from: chosen.from, upto: chosen.upto });
      if (reply.refusal) { say("Report generation failed...", "", true); if (!quiet) await refuse(reply.refusal); return false; }
      setOutput(reply.output);
      setOutputRun((count) => count + 1);
      setTab("output");
      // The rows and the generation time show by Arrange Columns in the output, not here.
      say("", "F6 : Summarize F4 : Unsummarize");
      return true;
    } catch (error) {
      say("Report generation failed...", "", true);
      await messageBox.alert(error instanceof Error ? error.message : String(error), "Report generation failed", "error");
      return false;
    } finally {
      setBusy("");
    }
  };

  // The runs that start themselves (a zoomed window's change, Zoom_Accode, Ask AI) are steps fired by the definition or another window arriving, not by
  // an event of this screen: each sets the selection and the run follows on the next render, when it is in. So these effects set state on purpose.
  /* eslint-disable react-hooks/set-state-in-effect */
  // A window zoomed from this one changed data (an entry saved or deleted): the report runs again when this window is next in front.
  const windowLink = useWindowLink();
  const inFront = useWindowActiveNow();
  useEffect(() => {
    if (!inFront || !windowLink.stale || !output || busy) return;
    windowLink.clearStale();
    void generate();
  }, [inFront, windowLink.stale, output, busy]);

  const desktopDay = (iso: string) => { const [year, month, day] = iso.split("-"); return `${day}/${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(month) - 1]}/${year}`; };
  // Report_Combine_Activated with Zoom_Accode: the account is ticked in the Account help, the first group (Account) is ticked and the report is run.
  const zoomStarted = useRef(false);
  const [zoomRun, setZoomRun] = useState(false);
  useEffect(() => {
    if (!zoomAccount || !def || zoomStarted.current) return;
    zoomStarted.current = true;
    const help = def.helps.find((candidate) => candidate.grid === "C1HelpAccount");
    const key = help?.rows.map((row) => row[help.keyColumn] ?? "").find((value) => value.trim() === String(zoomAccount));
    const group = groupControl?.items.find((item) => item.showControls === "C1HelpAccount") ?? groupControl?.items[0];
    if (!help || key === undefined || !group) { void messageBox.alert("The account is not in the Account help of this report.", "Zoom", "warning"); return; }
    setTicks((current) => ({ ...current, [help.grid]: new Set([key]) }));
    tickGroup(group, true);
    // The dates of the answer the ledger was opened from (this month, the quarter ...); the run follows on the next render, when they are in.
    if (autoFrom && autoTo) { setFrom(desktopDay(autoFrom)); setUpto(desktopDay(autoTo)); }
    setZoomRun(true);
  }, [zoomAccount, def]);
  useEffect(() => {
    if (!zoomRun) return;
    setZoomRun(false);
    void generate();
  }, [zoomRun]);

  // Opened from Ask AI: the report is run at once with its own defaults, to its output grid. When it refuses for want of a group or a list picked, the
  // first group is ticked with everything in its list (nothing was picked: the whole of it) and it is run again.
  const autoStarted = useRef(false);
  const [autoGo, setAutoGo] = useState(false);
  useEffect(() => {
    if (!autoRun || !def || zoomAccount || autoStarted.current) return;
    autoStarted.current = true;
    // The dates the question named go in first; the run follows on the next render, when they are in.
    if (autoFrom && autoTo) { setFrom(desktopDay(autoFrom)); setUpto(desktopDay(autoTo)); }
    // The choices and options the answer was worked out with (Profit / Loss: Closing Amount and Update Value In Master, so its closing stock is generated).
    // The Profit / Loss opened from Ask AI always has its stock value generated (Update Value In Master, and the opening value between dates), as its answer was.
    const setup = autoSetup ?? (def.checkboxes.some((check) => check.name === "CHK_UPD_MASTER") && def.checkboxes.some((check) => check.name === "CHK_PROFIT_TRF")
      ? { choices: {}, checks: ["CHK_UPD_MASTER", ...(autoFrom && autoTo && desktopDay(autoFrom) !== def.dates.yearStart ? ["CHK_OPEN_VALUE"] : [])] } : undefined);
    if (setup) {
      for (const [name, wantedText] of Object.entries(setup.choices)) {
        const item = def.controls.find((control) => control.name === name)?.items.find((entry) => entry.text.trim().toLowerCase() === wantedText.trim().toLowerCase());
        if (item) setChoices((current) => ({ ...current, [name]: itemKey(item) }));
      }
      if (setup.checks.length > 0) setChecks((current) => ({ ...current, ...Object.fromEntries(setup.checks.map((name) => [name, true])) }));
    }
    // The register the question named (purchase, not the sale it opens on): the first combo is set first and the run waits for its lists.
    const words = new Set((autoPick ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word !== "").map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word)));
    const wanted = autoPick ? def.firstCombo.options
      .map((option) => ({ option, parts: option.text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word !== "").map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word)) }))
      .filter((entry) => entry.parts.length > 0 && entry.parts.every((word) => words.has(word)))
      .sort((a, b) => b.parts.length - a.parts.length)[0]?.option : undefined;
    // Dates that do not start at the year's start (a month, a quarter, yesterday): the report that has a Between Date first combo is set to it, not left on Upto Date.
    const wantedFirst = wanted ?? (autoFrom && autoTo && desktopDay(autoFrom) !== def.dates.yearStart ? def.firstCombo.options.find((option) => /between/i.test(option.text)) : undefined);
    // A party the question named: the account group is ticked and that account alone picked in its list.
    if (autoParty) {
      const group = groupControl?.items.find((item) => /account|party/i.test(item.text)) ?? groupControl?.items[0];
      const help = group ? def.helps.find((candidate) => candidate.grid === group.showControls) : undefined;
      const row = help?.rows.find((candidate) => Object.values(candidate).some((value) => value.trim().toLowerCase() === autoParty.name.trim().toLowerCase()));
      if (group && help && row) {
        tickGroup(group, true);
        setTicks((current) => ({ ...current, [help.grid]: new Set([row[help.keyColumn] ?? ""]) }));
        setFirstEdited(wantedFirst?.value ?? first);
      }
    }
    if (wantedFirst && wantedFirst.value !== first && def.lostFocusControl !== "") { afterFirst.current = () => setAutoGo(true); setFirst(wantedFirst.value); if (!autoParty) setFirstEdited(null); return; }
    if (wantedFirst && wantedFirst.value !== first) setFirst(wantedFirst.value);
    setAutoGo(true);
  }, [autoRun, def]);
  useEffect(() => {
    if (!autoGo || !def) return;
    setAutoGo(false);
    void generate(true).then(async (done) => {
      if (done) return;
      // A pivot asked for in words cannot choose for the person: the report needs its own selection (one account, for example) made first.
      if (autoPivot || autoSumif) {
        await messageBox.alert(["This report needs its selection made first (for example one account, untick the rest).", `Make it and press Show: the ${autoPivot ? "pivot" : "SUMIF"} you asked for is done on the result.`].join("\n"), autoPivot ? "Pivot" : "SUMIF", "info");
        return;
      }
      const group = groupControl?.items[0];
      if (group) {
        tickGroup(group, true);
        const help = def.helps.find((candidate) => candidate.grid === group.showControls);
        if (help) setTicks((current) => ({ ...current, [help.grid]: new Set(help.rows.map((row) => row[help.keyColumn] ?? "")) }));
      }
      setZoomRun(true);
    });
  }, [autoGo]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /** The selection as the screen first opened it: the first combo, the dates, the groups, every help un-ticked, the options and lists at their defaults. */
  const clearSelection = () => {
    if (!def) return;
    setFirst(def.firstCombo.options[0]?.value ?? "");
    const lastDates = readLastDates();
    setFrom(def.dates.fromLast && lastDates ? lastDates.from : def.dates.from);
    setUpto(def.dates.uptoLast && lastDates ? lastDates.upto : def.dates.upto);
    setGroups([]);
    setChoices(Object.fromEntries(def.controls.filter((candidate) => candidate.type === "L" || candidate.type === "C").map((candidate) => [candidate.name, candidate.items[0] ? itemKey(candidate.items[0]) : ""])));
    setColumnsTicked(def.controls.find((candidate) => candidate.name === "lbchk_Col_Select")?.initiallyTicked.slice() ?? []);
    setTexts({ ...textDefaults.current });
    setChecks(Object.fromEntries(def.checkboxes.map((check) => [check.name, check.value])));
    setTicks(Object.fromEntries(def.helps.map((help) => [help.grid, new Set<string>()])));
    setFirstEdited(null);
    setAddonField("");
    setHelpTab(def.checkboxes.some((check) => check.visible) ? OPTIONS_GRID : def.helps.find((help) => def.helpTabs.includes(help.grid.replace("C1Help", "Tab_")))?.grid ?? def.helps[0]?.grid ?? "");
    setStartGroupBy([]);
    groupByNow.current = [];
    generatedWith.current = null;
    setOutput(null);
  };

  // The Quit button (here and on the output grid): ask first. On the output it goes back to a clean Selection tab; on the Selection tab it closes the report.
  const leave = async () => {
    if (!(await messageBox.confirm("Are you sure you want to quit?", "Quit"))) return;
    if (tab === "output") {
      clearSelection();
      setTab("select");
      say("");
    } else {
      onClose();
    }
  };

  // Esc on either tab asks to quit, as the Quit button does. Every control that has something of its own to close (a combo's list, a typed
  // search, a side panel, a message box) uses the key first and marks it used (preventDefault), so the screen looks once they have all had their
  // turn: only a bare Esc asks. Watched on the window, so it works wherever the keyboard focus is.
  const quitting = useRef(false);
  const onEscape = (event: KeyboardEvent) => {
    if (event.defaultPrevented || busy || quitting.current) return;
    if (document.querySelector(".msgbox-backdrop") || activeScope().querySelector(".mp-filter, .mp-menu, .mp-preview")) return;
    quitting.current = true;
    void leave().finally(() => { quitting.current = false; });
  };
  const windowActive = useWindowActive();
  const escapeNow = useRef(onEscape);
  useEffect(() => { escapeNow.current = onEscape; });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      // A window behind (another program open in front of it) does not answer.
      if (event.key === "Escape" && windowActive.current) window.setTimeout(() => escapeNow.current(event), 0);
    };
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, [windowActive]);


  /** The output grid's part of the status line: its rows and the selected cells' total. */
  const [gridInfo, setGridInfo] = useState({ rows: "", totals: "" });
  const onGridInfo = useCallback((rows: string, totals: string) => setGridInfo((current) => (current.rows === rows && current.totals === totals ? current : { rows, totals })), []);
  const onGridStatus = useCallback((status: OutputStatus) => say(status.message, status.hotKeys, status.red ?? false), [say]);
  const loadGroup = useCallback(async (fields: readonly string[]) => {
    if (!generatedWith.current) return null;
    setBusy("Generating report");
    try {
      const reply = await call<{ output: ReportOutput }>("group", { selection: generatedWith.current, fields });
      if (reply.refusal) { await refuse(reply.refusal); return null; }
      return reply.output;
    } finally {
      setBusy("");
    }
  }, [call]);
  /** Compare periods: the same selection for other dates of the year. A period with nothing in it compares as zero. */
  const loadCompare = useCallback(async (from: string, upto: string, lastYear = false): Promise<CompareResult> => {
    if (!generatedWith.current) return { output: null, error: "Generate the report first." };
    setBusy("Comparing periods");
    try {
      const reply = await call<{ output: ReportOutput }>("generate", { selection: { ...generatedWith.current, from, upto }, ...(lastYear ? { compareYear: "previous" } : {}) });
      if (reply.refusal) return /No Records/i.test(reply.refusal.caption) ? { output: null, empty: true } : { output: null, error: reply.refusal.message };
      return { output: reply.output };
    } catch (error) {
      return { output: null, error: error instanceof Error ? error.message : String(error) };
    } finally {
      setBusy("");
    }
  }, [call]);
  const loadLog = useCallback(async (ledKey: number, processKey: number, master?: { id: number; code: number; first: string; small?: boolean }) => (await call<{ log: LogTable }>("log", { ledKey, processKey, ...(master ? { masterId: master.id, masterCode: master.code, masterFirst: master.first, masterSmall: master.small === true } : {}) })).log, [call]);
  const loadZoom = useCallback(async (request: { ledKey: number; processKey: number; acCode: number; name: string }) => (await call<{ zoom: { entryName?: string; ledKey?: number; reportName?: string; acCode?: number; message?: string } }>("zoom", request)).zoom, [call]);

  /** C1_CHECKBOX, the Report Options: the first tab of the help grids, ticked like them. */
  const optionsHelp = useMemo<HelpGridData | null>(() => {
    const shown = def?.checkboxes.filter((check) => check.visible) ?? [];
    if (shown.length === 0) return null;
    return {
      grid: OPTIONS_GRID, helpId: "", keyColumn: "name", frozen: 0,
      columns: [{ key: "caption", caption: "SELECTION FOR", width: 460, visible: true, type: "T", decimals: 0, align: "L" }],
      rows: shown.map((check) => ({ name: check.name, caption: check.caption })),
    };
  }, [def]);
  const addonFilter = useCallback((row: Readonly<Record<string, string>>) => addonField === "" || (row.fiel_key ?? row.FIEL_KEY) === addonField, [addonField]);

  if (fatal) return <div className="mp-screen"><div className="mp-combos"><b>{title}</b></div><p className="mp-fatal" role="alert">{fatal}</p></div>;

  const helpShown = def?.helps.filter((help) => def.helpTabs.includes(help.grid.replace("C1Help", "Tab_")) || def.helpTabs.length === 0) ?? [];
  const helpEnabled = (grid: string) => def?.helps.some((help) => help.grid === grid && help.first) === true || groupOfGrid(grid).length > 0 || (grid === "C1HelpAddon" && groups.some((key) => Number(key.split("|")[1]) > 0));
  const helpFilter = (help: HelpGridData): ((row: Readonly<Record<string, string>>) => boolean) | undefined => (help.grid === "C1HelpAddon" ? addonFilter : accountScopeOf(def, first)?.help.grid === help.grid ? accountScopeOf(def, first)?.keep : undefined);
  const addonGroups = groupControl?.items.filter((item) => Number(item.value) > 0) ?? [];
  const addonItem = addonGroups.find((item) => item.value === addonField);
  const addonEnabled = addonItem ? groups.includes(itemKey(addonItem)) : helpEnabled("C1HelpAddon");
  const isCheckEnabled = (name: string) => {
    const check = def?.checkboxes.find((c) => c.name === name);
    if (!check) return false;
    if (check.name === "CHK_GRPASHD") return groups.length > 0;
    return check.enabled;
  };
  const optionTicks = new Set(Object.entries(checks).filter(([, on]) => on).map(([name]) => name));
  const pickLists = def?.controls.filter((candidate) => candidate.name !== "lbchk_Group" && candidate.type === "L") ?? [];
  const tickLists = def?.controls.filter((candidate) => candidate.name !== "lbchk_Group" && candidate.type === "K") ?? [];
  /** Tab out of a help grid: on to the list after the groups (Shift+Tab: back to the groups). */
  const tabOutOfHelp = (back: boolean) => {
    const next = back ? listRefs.current.group : (pickLists[0] ? listRefs.current[pickLists[0].name] : null);
    if (next) next.focus(); else screen.current?.querySelector<HTMLInputElement>(".rp-actions input")?.focus();
  };
  const combos = def?.controls.filter((candidate) => candidate.type === "C") ?? [];

  return (
    <div ref={screen} className={`mp-screen rp-screen${busy ? " rp-working" : ""}`} aria-busy={Boolean(busy)} role="region" aria-label={def?.head || title} onMouseOver={(event) => { const owner = (event.target as Element).closest("[data-tip], [title]"); setTip(owner?.getAttribute("data-tip") ?? owner?.getAttribute("title") ?? ""); }} onMouseLeave={() => setTip("")} onFocus={() => setTip("")}>
      <div className="rp-body">
      <div className="rp-main">
      {tab === "select" && def && (
        <div className="rp-select">
          <div className="rp-top">
            {def.firstCombo.visible && (
              <>
                <span className="rp-top-label">{def.firstCombo.label}</span>
                <div className="rp-top-combo"><SearchCombo ariaLabel={def.firstCombo.label} options={def.firstCombo.options} value={def.firstCombo.options.find((option) => option.value === first) ?? null} onChoose={(option) => setFirst(option.value)} /></div>
              </>
            )}
            {busy && <span className="mp-busy">{busy}…</span>}
          </div>

          <div className="rp-left">
            {groupControl && (
              <ReportList
                ref={(element) => { listRefs.current.group = element; }}
                caption={groupControl.caption}
                mode="tick"
                entries={groupControl.items.map((item) => ({ key: itemKey(item), text: item.text, badge: groups.includes(itemKey(item)) ? String(groups.indexOf(itemKey(item)) + 1) : undefined }))}
                chosen={groups}
                onTick={(key, on) => { const item = groupControl.items.find((candidate) => itemKey(candidate) === key); if (item) tickGroup(item, on); }}
                onEnter={() => say("", "Space : Tick / ↑↓ : Move")}
                onActive={(key) => { const item = groupControl.items.find((candidate) => itemKey(candidate) === key); if (item) setMessage(`Tick to filter data with selected ${item.text}`); if (item?.showControls) { setHelpTab(item.showControls); if (Number(item.value) > 0) setAddonField(item.value); } }}
              />
            )}
            {pickLists.map((list) => (
              <ReportList
                key={list.name}
                ref={(element) => { listRefs.current[list.name] = element; }}
                caption={list.caption}
                mode="pick"
                entries={(list.name === def.lostFocusControl && lostItems ? lostItems : list.items).map((item) => ({ key: itemKey(item), text: item.text }))}
                chosen={[choices[list.name] ?? ""]}
                onPick={(key) => { setChoices((current) => ({ ...current, [list.name]: key })); if (helpTab === OPTIONS_GRID && helpShown.length === 1) setHelpTab(helpShown[0].grid); }}
                onEnter={() => say(LIST_MESSAGES[list.name] ?? "", "↑↓ : Choose")}
              />
            ))}
          </div>

          <div className="rp-mid">
            {slabListShown && (
              <ReportList
                caption={filterList === "lbchk_Forms" ? "Forms" : "Slabs"}
                mode="tick"
                entries={(slabItems ?? []).map((item) => ({ key: item.value, text: item.text }))}
                chosen={slabsTicked}
                onTick={(key, on) => setSlabsTicked((current) => (on ? [...current.filter((value) => value !== key), key] : current.filter((value) => value !== key)))}
                onEnter={() => say(filterList === "lbchk_Forms" ? "Tick the forms (taxes) to include or exclude" : "Tick the slabs to include or exclude", "Space : Tick / ↑↓ : Move")}
              />
            )}
            {tickLists.map((list) => (
              <ReportList
                key={list.name}
                caption={list.caption}
                mode="tick"
                entries={list.items.map((item) => ({ key: item.value, text: item.text, locked: item.extra[1] === "Y" }))}
                chosen={[...columnsTicked, ...list.items.filter((item) => item.extra[1] === "Y").map((item) => item.value)]}
                onTick={(key, on) => setColumnsTicked((current) => (on ? [...current, key] : current.filter((value) => value !== key)))}
              />
            ))}
            {combos.map((combo) => (
              <label key={combo.name} className="rp-field">
                <span>{combo.caption}</span>
                {(() => {
                  const entries = combo.name === def.lostFocusControl && lostItems ? lostItems : combo.name === "cmb_AgainstBook" && againstItems ? againstItems : combo.items;
                  return (
                    <select value={choices[combo.name] ?? ""} disabled={combo.name === "cmb_AgainstBook" && entries.length === 0} onChange={(event) => setChoices((current) => ({ ...current, [combo.name]: event.target.value }))}>
                      {entries.map((item) => <option key={itemKey(item)} value={itemKey(item)}>{item.text}</option>)}
                    </select>
                  );
                })()}
              </label>
            ))}
            {def.runtime.filter((box) => box.visible || shownRuntime.has(box.name)).map((box) => box.type === "A" ? (
              <span key={box.name} className="rp-runtime-label">{box.text}</span>
            ) : (
              <label key={box.name} className="rp-field">
                {/* Steel Plant Challan: the Challan No / Vehicle No box carries no heading. */}
                {def.key !== 228 && <span>{box.name.replace(/^txt_/, "").replace(/amt$/i, " Amount")}</span>}
                <input className="mp-control" inputMode="decimal" maxLength={box.maxChars || undefined} value={texts[box.name] ?? ""} onChange={(event) => { const value = event.target.value; if (/^-?\d*\.?\d*$/.test(value)) setTexts((current) => ({ ...current, [box.name]: value })); }} />
              </label>
            ))}
          </div>

          <div className="rp-right">
            {(helpShown.length > 0 || optionsHelp) && (
              <div className="rp-helps">
                <div className="rp-help-tabs" role="tablist">
                  {optionsHelp && (
                    <button type="button" role="tab" tabIndex={-1} aria-selected={helpTab === OPTIONS_GRID} className={helpTab === OPTIONS_GRID ? "rp-tab-on" : ""} onClick={() => setHelpTab(OPTIONS_GRID)}>Report Options</button>
                  )}
                  {helpShown.map((help) => (
                    <button key={help.grid} type="button" role="tab" tabIndex={-1} aria-selected={helpTab === help.grid} className={`${helpTab === help.grid ? "rp-tab-on" : ""} ${helpEnabled(help.grid) ? "rp-help-tab-live" : ""}`} onClick={() => setHelpTab(help.grid)}>
                      {help.grid.replace("C1Help", "")} {ticksOf(help.grid).size ? `(${ticksOf(help.grid).size})` : ""}
                    </button>
                  ))}
                  <span className="rp-help-tools">
                  {helpTab === "C1HelpAddon" && addonGroups.length > 0 && (
                    <select className="rp-addon-pick" value={addonField} onChange={(event) => setAddonField(event.target.value)} aria-label="Addon">
                      <option value="">All addons</option>
                      {addonGroups.map((item) => <option key={item.value} value={item.value}>{item.text}</option>)}
                    </select>
                  )}
                  <span className="rp-find-slot" ref={setFindSlot} />
                  </span>
                </div>
                {optionsHelp && (
                  <HelpGrid
                    help={optionsHelp}
                    hidden={helpTab !== OPTIONS_GRID}
                    enabled
                    ticked={optionTicks}
                    rowKey={(row) => row.name ?? ""}
                    rowDisabled={(row) => !isCheckEnabled(row.name ?? "")}
                    onTicks={(next) => { for (const check of def.checkboxes) if (check.visible && isCheckEnabled(check.name) && next.has(check.name) !== (checks[check.name] ?? false)) setCheck(check.name, next.has(check.name)); }}
                    focusKey={0}
                    onTabOut={tabOutOfHelp}
                    findSlot={findSlot}
                    groupName="Report Options"
                    onStatus={() => say("Ticked options are applied to the report", "Space : Tick / F6 : Invert Selection / Ctrl+F : Search")}
                  />
                )}
                {helpShown.map((help) => (
                  <HelpGrid
                    key={help.grid}
                    help={help}
                    hidden={helpTab !== help.grid}
                    enabled={help.grid === "C1HelpAddon" ? addonEnabled : helpEnabled(help.grid)}
                    ticked={ticksOf(help.grid)}
                    rowKey={help.grid === "C1HelpAddon" ? addonKey : (row) => row[help.keyColumn] ?? ""}
                    filter={helpFilter(help)}
                    onTicks={(next) => { if (help.first) setFirstEdited(first); setTicks((current) => ({ ...current, [help.grid]: next })); }}
                    focusKey={helpTab === help.grid ? focusHelp : 0}
                    freezeMain
                    onTabOut={tabOutOfHelp}
                    findSlot={findSlot}
                    groupName={help.grid === "C1HelpAddon" ? "Addon Groups" : undefined}
                    onStatus={(keys, text, red) => say(text, keys, red)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="rp-actions">
            {def.dates.fromVisible && <div className="rp-date" onFocus={() => say("Report is generated from this date", "Alt+↓ : Calendar")}><span>Report Generation From</span><DateField ariaLabel="Report Generation From" value={from} tools={tools} onChange={setFrom} required /></div>}
            {def.dates.uptoVisible && <div className="rp-date" onFocus={() => say("Report is generated upto this date", "Alt+↓ : Calendar")}><span>{def.dates.uptoLabel}</span><DateField ariaLabel={def.dates.uptoLabel} value={upto} tools={tools} onChange={setUpto} required /></div>}
            {!def.ported && <span className="rp-warning">Output of this report is not ported yet.</span>}
            <span className="rp-spacer" />
            <button type="button" data-hotkey="v" aria-keyshortcuts="Alt+V" className={`mp-btn mp-btn-plain ${viewsOpen ? "rp-btn-on" : ""}`} onClick={() => setViewsOpen((open) => !open)} title="Save this selection under a name, or apply a saved one"><Icon name="views" /><HotkeyLabel text="Views" hotkey="v" /></button>
            <button type="button" data-hotkey="k" aria-keyshortcuts="Alt+K" className="mp-btn mp-btn-green rp-ok" onClick={() => void generate()} disabled={Boolean(busy)}><Icon name="ok" /><HotkeyLabel text="OK" hotkey="k" /></button>
            <button type="button" data-hotkey="q" aria-keyshortcuts="Alt+Q" className="mp-btn mp-btn-red rp-quit" onClick={() => void leave()}><Icon name="close" /><HotkeyLabel text="Quit" hotkey="q" /></button>
          </div>
          {tools.popups}
          {viewsOpen && <SavedViews list={listViews} save={saveView} remove={removeView} apply={applyView} onClose={() => setViewsOpen(false)} />}
        </div>
      )}

      {tab === "output" && output && def && (
        <OutputGrid
          key={outputRun}
          output={output}
          fallbackTitle={title}
          companyName={selection?.companyName ?? ""}
          userName={selection?.loginName ?? ""}
          rights={def.rights}
          busy={Boolean(busy)}
          onRefresh={() => void generate()}
          onQuit={() => void leave()}
          loadLog={loadLog}
          loadZoom={loadZoom}
          loadGroup={loadGroup}
          loadCompare={loadCompare}
          comparePeriod={generatedPeriod}
          yearStart={def.dates.yearStart}
          yearEnd={def.dates.yearEnd}
          onStatus={onGridStatus}
          onInfo={onGridInfo}
          initialGroupBy={startGroupBy}
          initialPivot={autoPivot}
          initialSumif={autoSumif}
          onGroupBy={(specs) => { groupByNow.current = specs; }}
        />
      )}
      </div>
      <div className="rp-vtabs" role="tablist" aria-orientation="vertical">
        <button type="button" role="tab" tabIndex={-1} aria-selected={tab === "select"} className={tab === "select" ? "rp-tab-on" : ""} onClick={() => setTab("select")}>Selection</button>
        <button type="button" role="tab" tabIndex={-1} aria-selected={tab === "output"} className={tab === "output" ? "rp-tab-on" : ""} disabled={!output} onClick={() => setTab("output")}>Output</button>
      </div>
      </div>
      <ScreenStatus hotKeys={hotKeys} message={tip || message} error={!tip && messageRed} version={version} rows="" totals={tab === "output" ? gridInfo.totals : ""} />
      {busy && <div className="rp-busy" role="status" aria-live="polite"><span className="rp-spinner" aria-hidden="true" /><span>{busy}…</span></div>}
    </div>
  );
}
