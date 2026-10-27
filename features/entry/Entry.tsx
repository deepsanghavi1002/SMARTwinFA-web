"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useStartupSelection } from "../startup/StartupGate";
import { formatDesktopDate, parseDesktopDate } from "../../lib/master-program/legacy";
import { fixed, toNumber } from "../../lib/entry/calc";
import type { BookScreen, EntryColumn, EntryOption, HelpList as HelpData, InvoiceControl, InvoiceDefinition, PartyDetails, ProductChoice, RestoredEntry, SeriesDefaults, SlabRow } from "../../lib/entry/types";
import type { TdsInfo } from "../../lib/entry/tds";
import type { HeaderField, HeaderProblem } from "../../lib/entry/checks";
import type { SaveReport } from "../../lib/entry/save";
import { entryCall } from "./api";
import { useEditorTools } from "../grid/EditorTools";
import { DateField } from "../grid/DateField";
import { HelpList } from "../grid/HelpList";
import { useHelpView } from "../grid/useHelpView";
import { useDraggable } from "../grid/useDraggable";
import { messageBox } from "../ui/MessageBox";
import { useWindowLink } from "../ui/windowLink";
import { HotkeyLabel, useAltHotkeys } from "../ui/hotkeys";
import { Icon } from "../ui/Icon";
import { SearchCombo } from "../ui/SearchCombo";
import { FindList } from "./FindList";
import type { FindMode } from "./FindList";
import { ReturnsPanel } from "./ReturnsPanel";
import type { ReturnsChoices } from "../../lib/entry/invoice";
import { EntryLog } from "./EntryLog";
import { UploadDocuments, docRowsFor } from "./UploadDocuments";
import { RangePanel } from "./RangePanel";
import type { DocRow } from "./UploadDocuments";
import { MasterDetails } from "./MasterDetails";
import { AccountLedger } from "./AccountLedger";
import { LinkPick } from "./LinkPick";
import type { LinkList as LinkListData } from "../../lib/entry/link";
import { PartyStock } from "./PartyStock";
import type { PartyStock as PartyStockData } from "../../lib/entry/partyStock";
import type { AccountLedger as AccountLedgerData } from "../../lib/entry/ledger";
import type { MasterDetails as MasterDetailsData } from "../../lib/entry/details";
import type { EntryLog as EntryLogData } from "../../lib/entry/log";
import { amountText, helpCell } from "./format";
import { chooseProduct, filledLines, lineTotals, recalcLine, slabFromLines } from "./lines";
import type { Line } from "./lines";
import { ProductGrid } from "./ProductGrid";
import { VoucherGrid, filledVoucherLines } from "./VoucherGrid";
import type { VoucherLine } from "./VoucherGrid";
import { EntryCell, focusEntryCell } from "./EntryCell";
import { properHeading } from "../../lib/master-program/heading";
import { SideGrid } from "./SideGrid";
import { InvoicePrint } from "./InvoicePrint";
import { combineBills, standardBillHtml } from "../../lib/entry/billHtml";
import type { Bill } from "../../lib/entry/billHtml";
import { AddressPick } from "./AddressPick";
import { addressFields } from "./addressLines";

/**
 * Comman_Entry (Entry.cs): the TRANSACTION > Invoice screen. Header boxes sit where entry_control
 * puts them, except that the party and its address keep to the right edge and the entry date /
 * number go beside the date / number and challan lines; the grids sit on the tab page, as wide as
 * the window.
 *
 * Ported: choosing the register sets the screen up (header boxes, series, default date and
 * number, product grid columns with the item-wise slab and product addon columns, the slab grid
 * with its tax lists); the party help, the party's address, addons and pending bills, and the
 * tax group its state gives (CGST / IGST); the product rows (product help, the rate and MRP from
 * the party rate or price list, box × packing + loose, the factor in the rate's unit, value,
 * item-wise discounts and taxes, the totals line); the slab run total and final amount; Find /
 * Edit opening a saved entry. Save, Delete, Print and the e-invoice / e-way calls are not ported
 * yet (docs/PENDING-WORK.md).
 */

type Tab = "all" | "outstanding" | "find" | "eway";
type EntryReply = { entry: InvoiceDefinition; warnings: string[]; companyName: string; userName: string; yearStart: string; yearEnd: string };
type BookReply = { book: BookScreen & { asksTaxGroup: boolean }; warnings: string[]; asksAgainst?: boolean };
type Restored = RestoredEntry & { itemSlab: Record<number, Record<number, { perc: string; taxId: number; amount: string }>>; slabTax: Record<number, number> };
type HelpKind = "account" | "product";

/**
 * The desktop form is 592px tall (tab control at top 117, pages 1021 x 394, foot at 533), more than a browser window leaves
 * under its menus, so the web form is tighter to fit one screen: the tab control right under the header, the product grid
 * showing 7 rows (desktop 8), the product totals line, the slab grid showing 4 rows (desktop 5, the fifth scrolls), and the
 * foot (final amount, narration) moved up by as much as the page shrank.
 */
const TAB_TOP = 96;
const ROW = 20;
const PRODUCT_TOP = 0;
const PRODUCT_HEIGHT = ROW * 8 + 19; // heading + 7 rows + horizontal scroll bar
const SLAB_TOP = PRODUCT_TOP + PRODUCT_HEIGHT + 24; // the product totals line between
/** The voucher's Daybook box runs to the right end of the book balance (239 + 223), and the Dr / Cr and Add / Edit labels follow it. */
const VOUCHER_REGISTER_WIDTH = 375;
const VOUCHER_SIDE_LEFT = 464;
/** The calendar button of a date box sits outside the voucher's date input, so the input is as wide as the Series box. */
const VOUCHER_DATE_BUTTON = 21;
const VOUCHER_HEIGHT = ROW * 7 + 19;
/** The voucher's account help opens at the top of the grid's 3rd row (tab strip 18, heading and two rows of ROW above it). */
const VOUCHER_HELP_TOP = TAB_TOP + 18 + ROW + 2 * ROW - 2;
/** The voucher's address box is taller, so its 5 lines (14px each, 2px apart, padding and border) show whole; it reaches up into the register's row (right of the Add / Edit label). */
const VOUCHER_ADDRESS = { top: 13, height: 86 }; // the voucher grid: heading + 6 whole rows + horizontal scroll bar
const VOUCHER_ADDON_TOP = PRODUCT_TOP + VOUCHER_HEIGHT + 24;
const SLAB_HEIGHT = ROW * 5 + 2; // heading + 4 rows
const PAGE_HEIGHT = SLAB_TOP + SLAB_HEIGHT + 3;
const FOOT_TOP = TAB_TOP + 18 + PAGE_HEIGHT + 6;
/** The desktop's foot top: entry_control's bottom boxes are moved up by the difference. */
const DESKTOP_FOOT_TOP = 533;
const FORM_HEIGHT = FOOT_TOP + 54;
/** The party box and the address: kept to the right edge (desktop 427 wide). */
const PARTY_WIDTH = 427;
const PARTY_RIGHT = 8;
/** Gap between the slab and addon grids: two scroll bars. */
const SIDE_GAP = 34;
/** The form's least width (globals.css .ent-form min-width). */
const FORM_MIN_WIDTH = 1130;
/** A whole, positive figure (the E-Way distance in km). */
const WHOLE_NUMBER_RULES = { decimals: 0, positiveOnly: true, rangeFrom: 0, rangeUpto: 0 };
/** GST E-Way Bill start (desktop PublicVariable.EWAY_Bill_Date). */
const EWAY_START = new Date(2018, 3, 1);
/** The register chosen last on a screen is offered first the next time (a convenience of this browser only). */
const registerKey = (entryName: string) => `smartwinfa.entry.register.${entryName}`;
function recalledRegister(entryName: string): string {
  try { return window.localStorage.getItem(registerKey(entryName)) ?? ""; } catch { return ""; }
}
function rememberRegister(entryName: string, text: string): void {
  try { window.localStorage.setItem(registerKey(entryName), text); } catch { /* storage may be blocked */ }
}
const HELP_ROWS = 12;
/** The product help shows 9 entries at a time, so it stays on the screen under the product grid. */
const PRODUCT_HELP_ROWS = 9;
/** The voucher's account help shows nine whole rows. */
const VOUCHER_HELP_ROWS = 9;
/** A slab %: up to three places, never below nought; a slab amount: two places, a round-off or add / less may be negative. */
const PERCENT_RULES = { decimals: 3, positiveOnly: true, rangeFrom: 0, rangeUpto: 0 };
const AMOUNT_RULES = { decimals: 2, positiveOnly: false, rangeFrom: 0, rangeUpto: 0 };
/** The Outstanding grid's set-off amount: positive, two decimals. */
const NO_SETOFF: Record<number, string> = {};
const SETOFF_RULES = { decimals: 2, positiveOnly: true, rangeFrom: 0, rangeUpto: 0 };
/** Licences whose bills may have products worth nothing (the desktop's zero-total check skips them). */
const ZERO_TOTAL_LICENCES = [6, 9, 19, 25, 27, 29, 68];

/** Whether a 29 February falls between two dates (the accounting year). */
function yearHasLeapDay(from: Date | null, to: Date | null): boolean {
  if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return false;
  for (let year = from.getFullYear(); year <= to.getFullYear(); year += 1) {
    const leapDay = new Date(year, 1, 29);
    if (leapDay.getMonth() === 1 && leapDay >= new Date(from.getFullYear(), from.getMonth(), from.getDate()) && leapDay <= to) return true;
  }
  return false;
}

/** Each help's main column: it is searched, frozen, and headed in capitals. */
const HELP_MAIN = { account: "NAME", product: "prod_short" } as const;

/** Enter in a header or foot box: the next box; from the last header box, the first Product cell. False when it did not move. */
function moveOn(form: HTMLElement, from: HTMLElement): boolean {
  const boxes = [...form.querySelectorAll<HTMLElement>(".ent-head input:not([disabled]), .ent-head select:not([disabled]), .ent-foot input:not([disabled]), .ent-foot textarea:not([disabled])")].filter((box) => box.offsetParent !== null);
  const index = boxes.indexOf(from);
  if (index < 0) return false;
  const next = boxes[index + 1];
  if (next && !(from.closest(".ent-head") && next.closest(".ent-foot"))) { next.focus(); return true; }
  if (from.closest(".ent-head")) return focusEntryCell(form, "0:prod_key") || focusFirstCell(form.querySelector("[aria-label=Slab]"));
  return false;
}

/** Puts the keyboard on the first open cell of a grid (the slab after the products); false when it has none. */
function focusFirstCell(grid: Element | null | undefined): boolean {
  const cell = grid?.querySelector<HTMLElement>("td.ent-open input, td.ent-open button, td.ent-open select");
  cell?.focus();
  return Boolean(cell);
}
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const dayOf = (value: string) => { const date = parseDesktopDate(value); return date ? DAYS[date.getDay()] : ""; };

/**
 * Where the web puts a header box when it differs from entry_control: the party name keeps to the
 * right edge; the entry date and entry number sit beside the date / number and challan lines.
 */
function headerPlace(item: InvoiceControl): { label: CSSProperties; box: CSSProperties } | null {
  const right = (top: number) => ({ label: { right: PARTY_RIGHT + PARTY_WIDTH, left: "auto", top, width: 90, textAlign: "right" as const }, box: { right: PARTY_RIGHT, left: "auto", top, width: PARTY_WIDTH } });
  switch (item.name) {
    case "tbx_partyname": return right(item.box.top);
    // The expense name sits under the address, its head and box on the party name's right edge.
    case "cmb_ac_exp_name": return right(item.box.top);
    case "dtp_entrydate": return { label: { left: 412, top: 50, width: 88, textAlign: "right" }, box: { left: 500, top: 50, width: 112 } };
    case "tbx_entryno": return { label: { left: 412, top: 72, width: 88, textAlign: "right" }, box: { left: 500, top: 72, width: 88 } };
    default: return null;
  }
}

export function Entry({ entryName, menuShortName, title, onClose, zoom }: { entryName: string; menuShortName: string; title: string; onClose: () => void; /** Zoom from a report row: the voucher (ledger key) the screen opens on. */ zoom?: number }) {
  const selection = useStartupSelection();
  const windowLink = useWindowLink();
  const [def, setDef] = useState<InvoiceDefinition | null>(null);
  const [fatal, setFatal] = useState("");
  const [locked, setLocked] = useState(true);
  const [busy, setBusy] = useState("Loading");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [yearStart, setYearStart] = useState<Date | null>(null);
  const [yearEnd, setYearEnd] = useState<Date | null>(null);
  const [register, setRegister] = useState<EntryOption | null>(null);
  const [book, setBook] = useState<BookScreen | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [slab, setSlab] = useState<SlabRow[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  /** The voucher style (Entry.cs str_Entry_Style V): account rows instead of product rows. */
  const [vlines, setVlines] = useState<VoucherLine[]>([]);
  /** An opened voucher that is a Contra (type 9): its account cannot be changed. */
  const [contra, setContra] = useState(false);
  /** The series' own period (bn_from to bn_upto, inside the year): the date box takes no day outside it. */
  const [period, setPeriod] = useState<{ from: string; upto: string; chlnFrom: string } | null>(null);
  const [accountText, setAccountText] = useState<{ row: number; text: string } | null>(null);
  /** The voucher row whose Account cell the account help belongs to. */
  const [voucherRow, setVoucherRow] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [party, setParty] = useState<PartyDetails | null>(null);
  /** The party's TDS (an expense / agency / purchase book with the TDS auto journal): the nature account and rate the TDS Amount box works from. */
  const [tds, setTds] = useState<{ code: number; info: TdsInfo } | null>(null);
  const [addon, setAddon] = useState<Record<number, string>>({});
  const [accountHelp, setAccountHelp] = useState<HelpData | null>(null);
  const [productHelp, setProductHelp] = useState<HelpData | null>(null);
  const [helpKind, setHelpKind] = useState<HelpKind | null>(null);
  const [helpAt, setHelpAt] = useState(0);
  const [productText, setProductText] = useState<{ row: number; text: string } | null>(null);
  /** The product row whose Product cell the product help belongs to. */
  const [productRow, setProductRow] = useState<number | null>(null);
  /** The party whose addresses are being picked from (Display_Address: a party with several addresses), else null. */
  const [addressPick, setAddressPick] = useState<PartyDetails | null>(null);
  /** cmb_ProdFilter: the product-type choice the product help is filtered by, and the row it is being asked for. */
  const [prodFilter, setProdFilter] = useState<EntryOption | null>(null);
  /** F6 in the product help: only the products the party has already taken (its keys are read once per party). */
  const [partyOnly, setPartyOnly] = useState(false);
  const [partyProducts, setPartyProducts] = useState<{ code: number; keys: ReadonlySet<number> } | null>(null);
  const [preview, setPreview] = useState<HelpData | null>(null);
  /** Find / Edit with every field of each entry: read only when "All fields" is pressed; shown while allFields is on. */
  const [previewAll, setPreviewAll] = useState<{ fields: HelpData | null; products: HelpData | null }>({ fields: null, products: null });
  const [findMode, setFindMode] = useState<FindMode>("");
  /** The Returns panel of a debit / credit note while it asks, and what the note is against once answered (lbl_AgainstBook / lbl_AgainstNature). */
  const [returnsAsk, setReturnsAsk] = useState<{ choices: ReturnsChoices; resolve: (choice: { code: number; nature: number; accountName: string; natureText: string } | null) => void } | null>(null);
  const [against, setAgainst] = useState<{ book: string; nature: string } | null>(null);
  /** Range print: the panel while it is open, and the entries it (or a click) ticked in the Find / Edit list - the ones Print prints. */
  const [rangeOpen, setRangeOpen] = useState(false);
  const [ticked, setTicked] = useState<number[]>([]);
  /** Upload Document: the window while it is open (its answer comes back as a promise), and the rows it was left with, kept for the entry's Save. */
  const [docsAsk, setDocsAsk] = useState<{ initial: DocRow[]; resolve: (rows: DocRow[] | null) => void } | null>(null);
  const [docPending, setDocPending] = useState<DocRow[] | null>(null);
  /** How many product rows the opened entry came with: the keyboard leaves the grid for the slab after the last of them. */
  const [restoredRows, setRestoredRows] = useState(0);
  /** The TDS amount the opened entry's auto journal passed ("" when none): shown as a label beside the narration. */
  const [restoredTds, setRestoredTds] = useState("");
  /** The Print button: the format choice and the bill preview are open. */
  const [printing, setPrinting] = useState(false);
  /** The entry opened from Find / Edit (its unique key), or null for a new entry. */
  const [restored, setRestored] = useState<number | null>(null);
  const [logView, setLogView] = useState<EntryLogData | null>(null);
  /** The F1 window of a help row: the account or product master, field and value side by side. */
  /** The F8 window of an account help row: that account's Ledger with the items of each voucher. */
  /** Set when the F1 / F8 window closes: the account help it returns to stays on the row it was on (the focus would reset it to the first). */
  const keepHelpAt = useRef(false);
  /** The F7 window of an account help row: that party's stock lines (Partywise Stock). */
  const [stockView, setStockView] = useState<PartyStockData | null>(null);
  /** The cell the keyboard returns to when the product-fixed stock window closes ("" for the account help's F7). */
  const stockBack = useRef("");
  /** The product the F7 stock window was opened from: the product help lands on it when the keyboard comes back. */
  const stockLand = useRef<number | null>(null);
  /** The cursor is in a Rate cell: the status line names its F7. */
  const [onRate, setOnRate] = useState(false);
  /** A LINK register: the pending source entries, then their lines, are ticked in a list before the entry is made from them. */
  const [linkPick, setLinkPick] = useState<{ step: "entries" | "lines"; list: LinkListData; processKeys: number[] } | null>(null);
  const [ledgerView, setLedgerView] = useState<AccountLedgerData | null>(null);
  const [details, setDetails] = useState<{ kind: HelpKind; data: MasterDetailsData } | null>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  /** Set when a register has just been chosen: the keyboard goes to the series once the screen is drawn. */
  const focusSeries = useRef(false);
  /** The first register's screen, drawn closed until a register is chosen (the desktop shows the whole form at once). */
  const [ghost, setGhost] = useState<BookScreen | null>(null);
  const partyRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const tools = useEditorTools(yearStart);
  const accountDrag = useDraggable();
  const productDrag = useDraggable();
  useAltHotkeys(screenRef);

  const call = useCallback(<T,>(action: string, payload: Record<string, unknown> = {}) => {
    if (!selection) return Promise.reject(new Error("No company is open"));
    return entryCall<T>(selection, entryName, menuShortName, action, payload);
  }, [selection, entryName, menuShortName]);
  const say = useCallback((text: string, heading = "Entry") => messageBox.ask(text, heading), []);
  const failed = useCallback((error: unknown) => say(error instanceof Error ? error.message : String(error), "Entry Warning"), [say]);

  // ---- Comman_Entry_Load (and the module password Main_Menu_New asks first)
  useEffect(() => {
    if (!selection) return;
    let cancelled = false;
    entryCall<EntryReply>(selection, entryName, menuShortName, "entry")
      .then(async (body) => {
        if (cancelled) return;
        setDef(body.entry);
        setYearStart(new Date(body.yearStart));
        setYearEnd(new Date(body.yearEnd));
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

  /** Blank_FullEntry: everything the entry holds goes (the register stays chosen unless `all`). */
  const blankEntry = useCallback((keepList = false) => {
    setSlab([]);
    setLines([]);
    setVlines([]);
    setContra(false);
    setDetailsRow(null);
    setAccountText(null);
    setVoucherRow(null);
    setParty(null);
    setAddon({});
    setAddressPick(null);
    setHelpKind(null);
    setPartyOnly(false);
    setProductText(null);
    // The Find / Edit list (and the All fields / With product choice) stays until the register or series changes or an entry is saved.
    if (!keepList) { setPreview(null); setPreviewAll({ fields: null, products: null }); setFindMode(""); setTicked([]); }
    setRestored(null);
    setRestoredTds("");
    setDocPending(null);
    setRestoredRows(0);
    setTab("all");
  }, []);

  /** The register the box offers before one is chosen: the one chosen last time on this screen, else the first. */
  const defaultRegister = useMemo(() => {
    const options = def?.firstCombo.options ?? [];
    const last = recalledRegister(entryName);
    return options.find((option) => option.text === last) ?? options[0] ?? null;
  }, [def, entryName]);
  /** The register's book (for a tax group: Fill_Slab_and_Addon again with CGST, IGST or VAT). */
  const loadBook = useCallback(async (given: EntryOption, taxGroup?: BookScreen["taxGroup"]): Promise<BookReply> => {
    let option = given;
    let body = await call<BookReply>("book", { firstCombo: option, ...(taxGroup ? { taxGroup } : {}) });
    if (body.asksAgainst) {
      // A debit / credit note first asks what it is against (the Returns panel); the slab follows the book chosen.
      const { returns } = await call<{ returns: ReturnsChoices }>("returns", { firstCombo: option });
      const choice = await new Promise<{ code: number; nature: number; accountName: string; natureText: string } | null>((resolve) => setReturnsAsk({ choices: returns, resolve }));
      setReturnsAsk(null);
      if (!choice) throw new Error("The note was not started: choose the book it is against");
      option = { ...option, against: { code: choice.code, nature: choice.nature } };
      setRegister(option);
      setAgainst({ book: `Ag: ${choice.accountName}`, nature: choice.natureText });
      body = await call<BookReply>("book", { firstCombo: option, ...(taxGroup ? { taxGroup } : {}) });
    }
    if (!taxGroup && body.book.asksTaxGroup) {
      // "CGST [Yes] / IGST [No] / VAT [Cancel] Entry...": the desktop asks before the slab grid is filled.
      const answer = await messageBox.ask("CGST [Yes] / IGST [No] / VAT [Cancel] Entry...", "GST Entry Type", ["Yes", "No", "Cancel"], { defaultButton: "Yes" });
      body = await call<BookReply>("book", { firstCombo: option, taxGroup: answer === "Yes" ? "G" : answer === "No" ? "I" : "V" });
    }
    return body;
  }, [call]);

  // ---- LINK registers: the pending source entries are listed as soon as the register is chosen (c1dg_LinkEntry)
  const openLinkEntries = useCallback(async (option: EntryOption) => {
    setBusy("Pending entries");
    try {
      const { list } = await call<{ list: LinkListData }>("link-entries", { firstCombo: option });
      if (list.rows.length === 0) { await say("No pending entry found to link...", "Entry Warning"); return; }
      setLinkPick({ step: "entries", list, processKeys: [] });
    } catch (error) {
      await failed(error);
    } finally {
      setBusy("");
    }
  }, [call, say, failed]);

  // ---- Cmb_FirstCombo_Leave: the register sets the screen up
  const chooseRegister = useCallback(async (option: EntryOption) => {
    setRegister(option);
    rememberRegister(entryName, option.text);
    setAgainst(null);
    setBusy("Setting the screen");
    try {
      const body = await loadBook(option);
      const next = body.book;
      blankEntry();
      setBook(next);
      setSlab([...next.slabRows]);
      setAccountHelp(null);
      const initial: Record<string, string> = {};
      for (const control of next.controls) initial[control.name] = control.initial;
      setPeriod({ from: next.defaults.from, upto: next.defaults.upto, chlnFrom: next.defaults.chlnFrom });
      initial.dtp_date = next.defaults.date;
      initial.tbx_number = next.defaults.number;
      for (const name of ["dtp_chlndate", "dtp_entrydate", "dtp_ewaydate"]) if (next.controls.some((control) => control.name === name)) initial[name] = next.defaults.date;
      setValues(initial);
      setWarnings([...(def?.unsupported ?? []), ...next.warnings, ...body.warnings]);
      focusSeries.current = true;
      if (next.link) void openLinkEntries(option);
    } catch (error) {
      setBook(null);
      await failed(error);
    } finally {
      setBusy("");
    }
  }, [loadBook, blankEntry, def, failed, openLinkEntries]);

  // ---- Cmb_Series_Leave: another series has its own last date and number
  const chooseSeries = useCallback(async (series: string) => {
    setValues((current) => ({ ...current, cmb_series: series }));
    setPreview(null); setPreviewAll({ fields: null, products: null }); setFindMode("");
    if (!register) return;
    try {
      const body = await call<{ defaults: SeriesDefaults }>("series", { firstCombo: register, series });
      setPeriod({ from: body.defaults.from, upto: body.defaults.upto, chlnFrom: body.defaults.chlnFrom });
      setValues((current) => ({ ...current, dtp_date: body.defaults.date, tbx_number: body.defaults.number, dtp_chlndate: current.dtp_chlndate !== undefined ? body.defaults.date : current.dtp_chlndate }));
    } catch (error) {
      await failed(error);
    }
  }, [call, register, failed]);

  // ---- Dtp_Date_Leave, Tbx_Number_Leave, Tbx_ChlnNo_Leave, Tbx_EntryNo_Leave, Tbx_PartyName_Leave: the checks made as a header box is left
  const valuesRef = useRef(values);
  valuesRef.current = values;
  /** Dt_Restore_Date: the date an opened entry was saved with (the lock dates judge that, not a changed date). */
  const restoredDate = useRef("");
  /**
   * Asks the server the questions the desktop asks when a header box is left and shows its messages in order.
   * False when a message sends the cursor back (the entry must not go on with that value).
   */
  const checkHeader = useCallback(async (name: HeaderField, extra: Record<string, unknown> = {}): Promise<boolean> => {
    if (!register || !book) return true;
    const now = valuesRef.current;
    try {
      const body = await call<{ problems: HeaderProblem[] }>("check", {
        firstCombo: register, field: name, series: now.cmb_series ?? "", date: now.dtp_date ?? "", number: now.tbx_number ?? "", chlnNo: now.tbx_chlnno ?? "", entryNo: now.tbx_entryno ?? "",
        editKey: restored ?? 0, editDate: restoredDate.current, taxGroup: restored !== null ? book.taxGroup : "", ...extra,
      });
      for (const problem of body.problems) {
        if (problem.kind === "ask") {
          if (await messageBox.ask(problem.text, problem.title, ["Yes", "No"], { defaultButton: "Yes" }) !== "Yes") return false;
          continue;
        }
        await say(problem.text, problem.title);
        if (problem.clear) setValues((current) => ({ ...current, [`tbx_${problem.clear}`]: "" }));
        if (problem.kind === "stop") {
          if (problem.setDate) setValues((current) => ({ ...current, dtp_date: problem.setDate! }));
          return false;
        }
      }
    } catch (error) {
      await failed(error);
    }
    return true;
  }, [register, book, restored, call, say, failed]);
  /** Leaving a checked box (not for a toolbar button, so Cancel and Quit are never held up): the box takes the keyboard back when its check stops. */
  const leaveBox = (event: ReactFocusEvent<HTMLElement>, name: string) => {
    const field: HeaderField | undefined = ({ dtp_date: "date", tbx_number: "number", tbx_chlnno: "chlnno", tbx_entryno: "entryno" } as Record<string, HeaderField>)[name];
    const to = event.relatedTarget as Element | null;
    if (!field || !book || event.currentTarget.contains(to) || to?.closest("button, .mp-calendar, [role=dialog]")) return;
    // Going back to the date (the way a refused number is put right) is never held up.
    if (name !== "dtp_date" && to?.closest("[data-box=dtp_date]")) return;
    const box = event.currentTarget;
    setTimeout(() => {
      void checkHeader(field).then((ok) => { if (!ok) setTimeout(() => box.querySelector<HTMLInputElement>("input")?.focus(), 50); });
    }, 60);
  };

  // ---- The helps (Refresh_HelpGrid "A" and "P"), in the shared movable help window
  /** A help being read: the field's focus and its typing ask at once, and are given the one load. */
  const helpLoads = useRef<Partial<Record<HelpKind, Promise<HelpData | null>>>>({});
  const openHelp = useCallback(async (kind: HelpKind): Promise<HelpData | null> => {
    if (!book || !register) return null;
    setHelpKind(kind);
    const have = kind === "account" ? accountHelp : productHelp;
    if (have) return have;
    const pending = helpLoads.current[kind];
    if (pending) return pending;
    const load = (async () => {
      setBusy(kind === "account" ? "Account help" : "Product help");
      try {
        const body = kind === "account"
          ? await call<{ help: HelpData }>("party-help", { firstCombo: register, partyBooks: book.partyBooks })
          : await call<{ help: HelpData }>("product-help", { firstCombo: register });
        if (kind === "account") setAccountHelp(body.help); else setProductHelp(body.help);
        if (body.help.rows.length === 0) await say(body.help.total, "Entry Warning");
        return body.help;
      } catch (error) {
        setHelpKind(null);
        await failed(error);
        return null;
      } finally {
        setBusy("");
        delete helpLoads.current[kind];
      }
    })();
    helpLoads.current[kind] = load;
    return load;
  }, [book, register, accountHelp, productHelp, call, say, failed]);

  /** Reads a help in the background, so it is already there when its field gets the keyboard (nothing is shown). */
  const prefetchHelp = useCallback((kind: HelpKind) => {
    if (!book || !register || (kind === "account" ? accountHelp : productHelp) || helpLoads.current[kind]) return;
    helpLoads.current[kind] = (async () => {
      try {
        const body = kind === "account"
          ? await call<{ help: HelpData }>("party-help", { firstCombo: register, partyBooks: book.partyBooks })
          : await call<{ help: HelpData }>("product-help", { firstCombo: register });
        if (kind === "account") setAccountHelp(body.help); else setProductHelp(body.help);
        return body.help;
      } catch {
        return null;
      } finally {
        delete helpLoads.current[kind];
      }
    })();
  }, [book, register, accountHelp, productHelp, call]);
  useEffect(() => {
    if (!book || !register || locked) return;
    if (book.inventory) prefetchHelp("product");
    if (book.party || def?.style === "V") prefetchHelp("account");
  }, [book, register, locked, def, prefetchHelp]);

  /** What the field the help belongs to has typed: the help keeps the entries that start with it. */
  const typedName = values.tbx_partyname ?? "";
  const voucher = def?.style === "V";
  const typed = helpKind === "account" ? (voucher ? (accountText?.row === voucherRow ? accountText?.text ?? "" : "") : party?.name === typedName ? "" : typedName) : helpKind === "product" && productText?.row === productRow ? productText.text : "";
  const typedHelp = useMemo((): HelpData | null => {
    const help = helpKind === "account" ? accountHelp : helpKind === "product" ? productHelp : null;
    if (!help || !helpKind) return null;
    const main = HELP_MAIN[helpKind];
    // The main column's heading in capitals, the others in Proper Case.
    const columns = help.columns.map((column) => ({ ...column, caption: column.key === main ? column.caption.toUpperCase() : properHeading(column.caption) }));
    const needle = typed.trim().toUpperCase();
    // cmb_ProdFilter: only the products of the chosen type.
    const typeRows = helpKind === "product" && help.filter && prodFilter ? help.rows.filter((row) => (row.pg_filter ?? "").trim() === prodFilter.text) : help.rows;
    const taken = helpKind === "product" && partyOnly && partyProducts && partyProducts.code === party?.code ? partyProducts.keys : null;
    const byType = taken ? typeRows.filter((row) => taken.has(Number(row.prod_key))) : typeRows;
    if (needle === "") return byType === help.rows ? { ...help, columns } : { ...help, columns, rows: byType, total: `${help.total} · ${byType.length} ${taken ? "taken by the party" : `of type ${prodFilter?.text}`}` };
    const rows = byType.filter((row) => (row[main] ?? "").trim().toUpperCase().startsWith(needle));
    return { ...help, columns, rows, total: `${help.total} · ${rows.length} found` };
  }, [helpKind, accountHelp, productHelp, typed, prodFilter, partyOnly, partyProducts, party?.code]);
  // Each help keeps its own column filters and sort (useHelpView); the list on screen is the one Enter takes from.
  const accountView = useHelpView(helpKind === "account" ? typedHelp : null, helpCell);
  const productView = useHelpView(helpKind === "product" ? typedHelp : null, helpCell);
  const helpView = helpKind === "account" ? accountView : productView;
  const shownHelp = helpView.view;
  /** An Account cell that already holds an account: its help opens with the cursor on that account, not on the first one. */
  const accountLandOn = useRef<number | null>(null);
  const [accountLandTick, setAccountLandTick] = useState(0);
  useEffect(() => {
    if (helpKind !== "account" || accountLandOn.current === null || !shownHelp || shownHelp.rows.length === 0) return;
    const at = shownHelp.rows.findIndex((row) => Number(row.CODE) === accountLandOn.current);
    accountLandOn.current = null;
    if (at >= 0) setHelpAt(at);
  }, [helpKind, shownHelp, accountLandTick]);
  /** A double click on the Account Head of a filled row: the help (opened if it was closed) puts its cursor on that account again, with no text to search. */
  const landOnAccount = (row: number) => {
    const code = vlines[row]?.code;
    if (!code) return;
    setAccountText(null);
    accountLandOn.current = code;
    setAccountLandTick((now) => now + 1);
    if (helpKind !== "account") void openHelp("account");
  };
  /** A Product cell that already holds a product (an entry being edited): its help opens with the cursor on that product, not on the first one. */
  const helpLandOn = useRef<number | null>(null);
  const [landTick, setLandTick] = useState(0);
  useEffect(() => {
    if (helpKind !== "product" || helpLandOn.current === null || !shownHelp || shownHelp.rows.length === 0) return;
    const at = shownHelp.rows.findIndex((row) => Number(row.prod_key) === helpLandOn.current);
    helpLandOn.current = null;
    if (at >= 0) setHelpAt(at);
  }, [helpKind, shownHelp, landTick]);

  /** The field a help belongs to: the party box, or the Product cell it opened from. */
  const focusHelpField = useCallback((kind: HelpKind | null) => {
    if (kind === "account") { if (voucher) { if (voucherRow !== null) focusEntryCell(formRef.current, `${voucherRow}:name`); } else partyRef.current?.focus(); }
    else if (kind === "product" && productRow !== null) focusEntryCell(formRef.current, `${productRow}:prod_key`);
  }, [productRow, voucher, voucherRow]);
  /** F1 on a help row: the whole master record of the row the cursor is on (Esc closes it and the help gets the keyboard back). */
  const showDetails = async (kind: HelpKind) => {
    const rows = shownHelp?.rows ?? [];
    const row = rows[Math.min(helpAt, rows.length - 1)];
    const key = Number(kind === "account" ? row?.CODE : row?.prod_key);
    if (!row || !key) return;
    setBusy("Master details");
    try {
      const body = await call<{ details: MasterDetailsData }>("master-details", { kind, key });
      setDetails({ kind, data: body.details });
    } catch (error) {
      await failed(error);
    } finally {
      setBusy("");
    }
  };
  /** F8 on an account help row: the Ledger of that account in a window like the F1 one (Esc gives the keyboard back to the help). */
  const showLedger = async () => {
    const rows = shownHelp?.rows ?? [];
    const row = rows[Math.min(helpAt, rows.length - 1)];
    const code = Number(row?.CODE);
    if (!row || !code) return;
    setBusy("Ledger");
    try {
      const body = await call<{ ledger: AccountLedgerData }>("ledger", { code });
      setLedgerView(body.ledger);
    } catch (error) {
      await failed(error);
    } finally {
      setBusy("");
    }
  };
  /** F7 on the voucher's account help: that account's pending bills with the days they have been pending (no ageing), in the F7 window. */
  const showPartyOutstanding = async () => {
    const rows = shownHelp?.rows ?? [];
    const row = rows[Math.min(helpAt, rows.length - 1)];
    const code = Number(row?.CODE);
    if (!row || !code) return;
    setBusy("Outstanding");
    try {
      const body = await call<{ stock: PartyStockData }>("party-outstanding", { code, date: values.dtp_date ?? "" });
      setStockView(body.stock);
    } catch (error) {
      await failed(error);
    } finally {
      setBusy("");
    }
  };
  const showPartyStock = async () => {
    const rows = shownHelp?.rows ?? [];
    const row = rows[Math.min(helpAt, rows.length - 1)];
    const code = Number(row?.CODE);
    if (!row || !code) return;
    setBusy("Partywise Stock");
    try {
      const body = await call<{ stock: PartyStockData }>("party-stock", { code });
      setStockView(body.stock);
    } catch (error) {
      await failed(error);
    } finally {
      setBusy("");
    }
  };
  /** F7 on the product help (this party, the highlighted product) or on a Rate cell (that row's product, every party): newest first. */
  const showProductStock = async (prodKey: number, withParty: boolean, backTo: string) => {
    if (!prodKey) return;
    setBusy("Product Stock");
    try {
      const body = await call<{ stock: PartyStockData }>("party-stock", { code: withParty ? party?.code ?? 0 : 0, prodKey, date: values.dtp_date ?? "" });
      stockBack.current = backTo;
      stockLand.current = withParty ? prodKey : null;
      setStockView(body.stock);
    } catch (error) {
      await failed(error);
    } finally {
      setBusy("");
    }
  };
  /** F6 in the product help: the list of the products this party has already taken; F6 again, every product. */
  const togglePartyProducts = async () => {
    // The list changes under the cursor: it stops on the product of the row being entered (else the one above it), not on the first one.
    const landOn = () => {
      const row = productRow ?? 0;
      helpLandOn.current = lines[row]?.product?.key ?? lines.slice(0, row).reverse().find((line) => line.product)?.product?.key ?? null;
      setHelpAt(0);
      setLandTick((now) => now + 1);
    };
    if (partyOnly) { landOn(); setPartyOnly(false); return; }
    if (!party) { await say("Choose the party first", "Entry Warning"); return; }
    let have = partyProducts?.code === party.code ? partyProducts : null;
    if (!have && register) {
      try {
        const body = await call<{ keys: number[] }>("party-products", { firstCombo: register, code: party.code });
        have = { code: party.code, keys: new Set(body.keys) };
        setPartyProducts(have);
      } catch (error) {
        await failed(error);
        return;
      }
    }
    if (!have || have.keys.size === 0) { await say("This party has not taken any product yet", "Entry Warning"); return; }
    landOn();
    setPartyOnly(true);
  };
  const productHelpStock = () => {
    const rows = shownHelp?.rows ?? [];
    const row = rows[Math.min(helpAt, rows.length - 1)];
    if (row && productRow !== null) void showProductStock(Number(row.prod_key), true, `${productRow}:prod_key`);
  };
  const rateStock = (row: number) => {
    const key = lines[row]?.product?.key;
    if (key) void showProductStock(Number(key), false, `${row}:rate`);
  };
  const closeStock = () => {
    setStockView(null);
    keepHelpAt.current = true;
    const back = stockBack.current;
    stockBack.current = "";
    if (back) { setTimeout(() => focusEntryCell(formRef.current, back), 0); return; }
    setTimeout(() => { if (voucher) { if (voucherRow !== null) focusEntryCell(formRef.current, `${voucherRow}:name`); } else partyRef.current?.focus(); }, 0);
  };
  const closeLedger = () => {
    setLedgerView(null);
    keepHelpAt.current = true;
    setTimeout(() => { if (voucher) { if (voucherRow !== null) focusEntryCell(formRef.current, `${voucherRow}:name`); } else partyRef.current?.focus(); }, 0);
  };
  /** Esc on the details: the keyboard goes back to the field the help belongs to (its help shows again). */
  const closeDetails = () => {
    const kind = details?.kind;
    setDetails(null);
    if (kind === "account") keepHelpAt.current = true;
    setTimeout(() => {
      if (kind === "account") { if (voucher) { if (voucherRow !== null) focusEntryCell(formRef.current, `${voucherRow}:name`); } else partyRef.current?.focus(); }
      else if (kind === "product" && productRow !== null) focusEntryCell(formRef.current, `${productRow}:prod_key`);
    }, 0);
  };
  const closeHelp = useCallback((focusBack = true) => {
    const kind = helpKind;
    setHelpKind(null);
    if (focusBack) focusHelpField(kind);
  }, [helpKind, focusHelpField]);
  /** ↓ in the field puts the keyboard in the help, on the highlighted entry. */
  const enterHelp = () => setTimeout(() => formRef.current?.querySelector<HTMLElement>(".mp-help")?.focus(), 0);
  /** Leaving the field closes its help, unless the keyboard went into the help. */
  const leaveField = (event: ReactFocusEvent<HTMLElement>, kind: HelpKind) => {
    if ((event.relatedTarget as Element | null)?.closest(".mp-help")) return;
    setHelpKind((current) => (current === kind ? null : current));
  };
  /** Leaving the help for anything but its own field closes it. */
  const leaveHelp = (event: ReactFocusEvent<HTMLElement>) => {
    const to = event.relatedTarget as Element | null;
    if (!to || event.currentTarget.contains(to)) return;
    if (helpKind === "account" && to === partyRef.current) return;
    if (helpKind === "account" && voucher && to.getAttribute("data-cell") === `${voucherRow}:name`) return;
    if (helpKind === "product" && to.getAttribute("data-cell") === `${productRow}:prod_key`) return;
    setHelpKind(null);
  };

  /**
   * The keys of a field with a help (the party, a Product cell). The help shows when the field
   * gets the keyboard; ↓ (or F2) moves into it; typing keeps the entries starting with the text;
   * Enter after typing takes the highlighted entry; Esc hides the help.
   */
  const helpKeys = (event: ReactKeyboardEvent<HTMLInputElement>, kind: HelpKind, choose: (row: Readonly<Record<string, string>>) => void): boolean => {
    const open = helpKind === kind && shownHelp !== null;
    if (event.key === "F1" && open) { event.preventDefault(); void showDetails(kind); return true; }
    if (event.key === "F7" && open && kind === "account") { event.preventDefault(); void (voucher ? showPartyOutstanding() : showPartyStock()); return true; }
    if (event.key === "F5" && open && kind === "account" && voucher) { event.preventDefault(); void endVoucherRows(); return true; }
    if (event.key === "F7" && open && kind === "product") { event.preventDefault(); productHelpStock(); return true; }
    if (event.key === "F8" && open && kind === "account") { event.preventDefault(); void showLedger(); return true; }
    if (event.key === "ArrowDown" || event.key === "F2") {
      event.preventDefault();
      if (!open) void openHelp(kind).then(enterHelp); else enterHelp();
      return true;
    }
    if (event.key === "Enter" && typed.trim() !== "") {
      // After typing, Enter takes the highlighted entry; while the help is still being read, the first one starting with the text.
      event.preventDefault();
      event.stopPropagation();
      if (open) { const row = shownHelp!.rows[Math.min(helpAt, shownHelp!.rows.length - 1)]; if (row) choose(row); return true; }
      const text = typed.trim().toUpperCase();
      void openHelp(kind).then((help) => { const row = help?.rows.find((candidate) => (candidate[HELP_MAIN[kind]] ?? "").trim().toUpperCase().startsWith(text)); if (row) choose(row); });
      return true;
    }
    if (!open) return false;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setHelpKind(null); return true; }
    return false;
  };

  /** The party (and its address) settled: the keyboard goes to the Product of the next free row (its help shows), else the next box. */
  const afterParty = useCallback((sameParty = false) => {
    // The same party taken again on an entry already filled: the products are edited from the first row, not from a new one.
    const freeRow = sameParty ? 0 : filledLines(lines).length;
    setTimeout(() => {
      if (!formRef.current || !partyRef.current) return;
      if (book?.inventory && focusEntryCell(formRef.current, `${freeRow}:prod_key`)) return;
      // A debit / credit note of a nature that takes no stock (Others) has no product rows: from the party straight to the slab grid's first row.
      if (book && !book.inventory && book.slab && book.entryFor === "DrCr" && focusFirstCell(formRef.current.querySelector("[aria-label=Slab]"))) return;
      moveOn(formRef.current, partyRef.current);
    }, 0);
  }, [book, lines]);
  /** The address picked (null: Esc, the first address stays): a party with another address than the first shows its Ship to lines. */
  const pickAddress = async (id: number | null) => {
    const pending = addressPick;
    setAddressPick(null);
    if (!pending) return;
    if (id !== null && id !== pending.addressId && register) {
      try {
        const body = await call<{ party: PartyDetails }>("party", { firstCombo: register, code: pending.code, date: values.dtp_date ?? "", addressId: id });
        setParty(body.party);
      } catch (error) {
        await failed(error);
      }
    }
    if (id === null) partyRef.current?.focus(); else afterParty(party?.code === pending.code && filledLines(lines).length > 0);
  };

  // ---- Tbx_PartyName_Leave: address, addons, pending bills, and the tax group the party's state gives
  const choosePartyRow = useCallback(async (row: Readonly<Record<string, string>> | undefined) => {
    if (!row || !register || !book) return;
    setHelpKind(null);
    const allowed = await checkHeader("party", { party: { code: Number(row.CODE) || 0, name: row.NAME ?? "", book: Number(row.BOOK) || 0, closing: row.CLOSING_BAL ?? "", limit: row.LIMIT ?? "", message: row.ac_message ?? "", startDate: row.a_startdate ?? "", lastDate: row.a_lastdate ?? "" } });
    if (!allowed) { partyRef.current?.focus(); return; }
    setBusy("Party");
    try {
      const body = await call<{ party: PartyDetails }>("party", { firstCombo: register, code: Number(row.CODE), date: values.dtp_date ?? "" });
      const next = body.party;
      if (book.slab && next.taxGroup !== book.taxGroup) {
        if (filledLines(lines).length > 0) {
          const name = next.taxGroup === "G" ? "CGST / SGST" : next.taxGroup === "I" ? "IGST" : "VAT";
          await say(`Current Entry not Set as ${name}, if you want to change then first CANCEL entry...`, "Entry Warning");
          partyRef.current?.focus();
          return;
        }
        // Fill_Slab_and_Addon again: the slab rows and the item-wise columns of the party's tax group.
        const reloaded = await loadBook(register, next.taxGroup);
        setBook(reloaded.book);
        setSlab([...reloaded.book.slabRows]);
      }
      // The TDS of the party (a new entry only): a party whose TDS nature account is not open is refused.
      let deducts = false;
      if (restored === null) {
        const reply = await call<{ tds: { info: TdsInfo | null; error?: string } }>("tds", { firstCombo: register, code: next.code });
        if (reply.tds.error) { await say(reply.tds.error, "Entry Warning"); partyRef.current?.focus(); return; }
        setTds(reply.tds.info ? { code: next.code, info: reply.tds.info } : null);
        deducts = reply.tds.info !== null;
      }
      setParty(next);
      setValues((current) => ({ ...current, tbx_partyname: next.name, tbx_credit_days: deducts ? "" : current.tbx_credit_days !== undefined ? next.creditDays : current.tbx_credit_days }));
      setAddon(Object.fromEntries(next.addon.map((item) => [item.key, item.value])));
      // Several addresses: the operator picks the one first (c1help_Address); the keyboard moves on after it.
      if (next.addresses.length > 1) { setHelpKind(null); setAddressPick(next); return; }
      afterParty(party?.code === next.code && filledLines(lines).length > 0);
    } catch (error) {
      await failed(error);
    } finally {
      setBusy("");
    }
  }, [register, book, call, checkHeader, values.dtp_date, lines, loadBook, say, failed, afterParty, restored]);

  const partyKeys = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (helpKeys(event, "account", (row) => void choosePartyRow(row))) return;
    if (event.key === "Enter" && formRef.current) {
      event.preventDefault();
      setHelpKind(null);
      // The party is already taken and has several addresses: Enter asks for the address again, as when it was taken from the help.
      if (party && party.addresses.length > 1 && party.name === (values.tbx_partyname ?? "")) { setAddressPick(party); return; }
      moveOn(formRef.current, event.currentTarget);
    }
  };
  /** The party box got the keyboard: its help shows (on the party already chosen); the keyboard stays in the box. */
  const partyFocus = () => {
    if (keepHelpAt.current) { keepHelpAt.current = false; void openHelp("account"); return; }
    const at = accountHelp?.rows.findIndex((row) => row.NAME === party?.name) ?? -1;
    setHelpAt(at >= 0 ? at : 0);
    void openHelp("account");
  };

  // ---- The voucher's account rows: Voucher_Validate_Account and Voucher_AcHelp_Selection
  const sideDbcode = book?.sides?.find((side) => side.text === values.cmb_side)?.acDbcode ?? 1;
  const journal = book?.bookKey === 19;
  const loadDetailsRef = useRef<(row: number, code: number) => void>(() => undefined);
  const chooseVoucherAccount = useCallback(async (row: number, helpRow: Readonly<Record<string, string>> | undefined) => {
    if (!helpRow || !register || !book) return;
    setHelpKind(null);
    const allowed = await checkHeader("party", {
      voucher: { rows: row + 1, sideDbcode, bookName: register.text },
      party: { name: helpRow.NAME ?? "", book: Number(helpRow.BOOK) || 0, closing: helpRow.CLOSING_BAL ?? "", limit: helpRow.LIMIT ?? "", message: helpRow.ac_message ?? "", startDate: helpRow.a_startdate ?? "", lastDate: helpRow.a_lastdate ?? "" },
    });
    setAccountText(null);
    if (!allowed) { setTimeout(() => focusEntryCell(formRef.current, `${row}:name`), 0); return; }
    const code = Number(helpRow.CODE);
    setVlines((current) => {
      const copy = [...current];
      while (copy.length <= row) copy.push({ code: 0, book: 0, cells: {} });
      // The row's own addon fields (Sub Ledger ...) start at their default; another account on the row keeps what was chosen.
      const addonDefaults = Object.fromEntries((book.voucherAddon?.row ?? []).map((item) => [item.key, item.value]));
      copy[row] = { code, book: Number(helpRow.BOOK) || 0, cells: { ...copy[row].cells, name: helpRow.NAME ?? "" }, addon: copy[row].code === code ? copy[row].addon ?? addonDefaults : addonDefaults, setoffs: copy[row].code === code ? copy[row].setoffs : undefined };
      return copy;
    });
    loadDetailsRef.current(row, code);
    // The side the book side picks takes the figure (a journal book either; the debit first).
    focusAfterVoucher.current = `${row}:${sideDbcode === 1 || journal ? "debit_amt" : "credit_amt"}`;
  }, [register, book, sideDbcode, journal, checkHeader]);
  /** The cell to put the keyboard on once the voucher rows are drawn again (the figure of the account just taken). */
  const focusAfterVoucher = useRef<string | null>(null);
  useEffect(() => {
    if (focusAfterVoucher.current && focusEntryCell(formRef.current, focusAfterVoucher.current)) focusAfterVoucher.current = null;
  }, [vlines]);
  const accountKeys = (event: ReactKeyboardEvent<HTMLInputElement>, row: number): boolean => helpKeys(event, "account", (helpRow) => void chooseVoucherAccount(row, helpRow));
  /** The side of a row's account: the Book Side's, or on a journal the figure typed (debit unless only a credit is there). */
  const rowSide = (row: number) => (journal ? (toNumber(vlines[row]?.cells.debit_amt) > 0 || toNumber(vlines[row]?.cells.credit_amt) === 0 ? 1 : 2) : sideDbcode);
  /**
   * input_name's LF event: the account's address box and the bills pending on the side the day book posts to (the Outstanding tab). The row's saved
   * ledger key makes what the opened voucher already set off count as pending again. Read once per account, side and row.
   */
  const accountReads = useRef(new Map<string, PartyDetails>());
  /** The voucher row the bills (and the address) on screen belong to: the Outstanding tab sets off for that row, whichever row the keyboard was on last. */
  const [detailsRow, setDetailsRow] = useState<number | null>(null);
  loadDetailsRef.current = (row, code) => void loadAccountDetails(row, code, Number(copyOfCells(row, "_led_key")) || 0);
  const accountWanted = useRef("");
  const loadAccountDetails = async (row: number, code: number, ledKey: number, side = rowSide(row)): Promise<PartyDetails | null> => {
    if (!register || !book || code <= 0) return null;
    const id = `${code}:${side}:${ledKey}:${values.dtp_date ?? ""}`;
    accountWanted.current = id;
    const known = accountReads.current.get(id);
    if (known) { setParty(known); setDetailsRow(row); return known; }
    try {
      const body = await call<{ party: PartyDetails }>("party", { firstCombo: register, code, date: values.dtp_date ?? "", addressId: 1, voucherSide: side, rowLedKey: ledKey });
      accountReads.current.set(id, body.party);
      if (accountWanted.current === id) { setParty(body.party); setDetailsRow(row); }
      return body.party;
    } catch (error) {
      await failed(error);
      return null;
    }
  };
  /** The ledger key a voucher row was saved with (0 for a new row). */
  const copyOfCells = (row: number, key: string) => vlines[row]?.cells[key] ?? "";
  const accountFocus = (row: number) => {
    setVoucherRow(row);
    accountLandOn.current = vlines[row]?.code || null;
    if (vlines[row]?.code) void loadAccountDetails(row, vlines[row].code, Number(copyOfCells(row, "_led_key")) || 0);
    else setParty(null);
    if (accountText && accountText.row !== row) setAccountText(null);
    if (keepHelpAt.current) { keepHelpAt.current = false; void openHelp("account"); return; }
    setHelpAt(0);
    void openHelp("account");
  };
  /** A journal without MULTIJV takes many rows on one side only: debit on many rows and credit on many rows is refused (the desktop's "Multiple JV serial on both side not allowed"). */
  const editVoucherCell = (row: number, key: string, value: string) => {
    if (journal && !book?.voucherMulti?.jv && (key === "debit_amt" || key === "credit_amt") && toNumber(value) > 0) {
      const rows = vlines.map((line, index) => (index === row ? { ...line, cells: { ...line.cells, [key]: value } } : line));
      if (rows.filter((line) => toNumber(line.cells.debit_amt) > 0).length > 1 && rows.filter((line) => toNumber(line.cells.credit_amt) > 0).length > 1) {
        void say("Multiple JV serial on both side not allowed...", "Entry Warning");
        return;
      }
    }
    applyVoucherCell(row, key, value);
  };
  const applyVoucherCell = (row: number, key: string, value: string) => setVlines((current) => current.map((line, index) => {
    if (index !== row) return line;
    // One figure per row unless the book is a journal: typing one side clears the other.
    const cells = { ...line.cells, [key]: value };
    if (key === "debit_amt" || key === "credit_amt") delete cells._auto;
    if (!journal && value !== "" && key === "debit_amt") cells.credit_amt = "";
    if (!journal && value !== "" && key === "credit_amt") cells.debit_amt = "";
    return { ...line, cells };
  }));
  /**
   * F5 in the account rows (like F5 in the product rows of an invoice): the account entry is over. A voucher with no account is refused, a journal must tally;
   * then the keyboard goes to the Addon grid (the register's header fields), else to the narration.
   */
  const endVoucherRows = async () => {
    setHelpKind(null);
    setAccountText(null);
    if (filledVoucherLines(vlines).length === 0) { await say("Account Name not selected...", "Entry Warning"); setTimeout(() => focusEntryCell(formRef.current, "0:name"), 30); return; }
    if (journal && Math.abs(toNumber(voucherTotals.debit) - toNumber(voucherTotals.credit)) > 0.005) {
      await say(`Debit and Credit Total are not Equal... (difference ${amountText(voucherTotals.difference, 2)})`, "Entry Warning");
      setTimeout(() => focusEntryCell(formRef.current, `${filledVoucherLines(vlines).length}:name`), 30);
      return;
    }
    setTimeout(() => {
      if ((view?.voucherAddon?.header.length ?? 0) > 0 && focusFirstCell(formRef.current?.querySelector("[aria-label=Addon]"))) return;
      formRef.current?.querySelector<HTMLElement>("#ent-tbx_narration")?.focus();
    }, 30);
  };
  const editVoucherAddon = (row: number, key: number, value: string) => setVlines((current) => current.map((line, index) => (index === row ? { ...line, addon: { ...(line.addon ?? {}), [key]: value } } : line)));
  const deleteVoucherRow = (row: number) => setVlines((current) => current.filter((_line, index) => index !== row));
  /** The header addon fields (entrypos L) start at their defaults on every new entry of the register. */
  const voucherAddonDefaults = (screen: BookScreen | null | undefined): Record<number, string> => Object.fromEntries((screen?.voucherAddon?.header ?? []).map((item) => [item.key, item.value]));
  /** The voucher row the Outstanding tab works on (the account row last in the keyboard), and the amount it may set off. */
  const outRow = detailsRow ?? voucherRow ?? 0;
  const rowAmount = (row: number) => toNumber(vlines[row]?.cells.debit_amt) || toNumber(vlines[row]?.cells.credit_amt);
  /** Enter on a row's figure: an account with pending bills goes to the Outstanding tab, the keyboard on the first set-off box. */
  const voucherAmountEntered = async (row: number): Promise<boolean> => {
    const line = vlines[row];
    if (!line?.code || !book?.setoff || rowAmount(row) <= 0) return false;
    const details = await loadAccountDetails(row, line.code, Number(copyOfCells(row, "_led_key")) || 0);
    if (!details || details.outstanding.length === 0) return false;
    setVoucherRow(row);
    setTab("outstanding");
    setTimeout(() => formRef.current?.querySelector<HTMLElement>(".ent-grid[aria-label=Outstanding] input[data-cell^=os]")?.focus(), 80);
    return true;
  };
  const voucherTotals = useMemo(() => {
    const sum = (key: string) => vlines.reduce((total, line) => total + toNumber(line.cells[key]), 0);
    const debit = sum("debit_amt");
    const credit = sum("credit_amt");
    // Only a journal must tally: the other day books post the day book side themselves, so there is no difference to show.
    return { debit: fixed(debit, 2), credit: fixed(credit, 2), difference: journal ? fixed(Math.abs(debit - credit), 2) : "0.00", final: Math.max(debit, credit) };
  }, [vlines, journal]);
  /** Cmb_Side_Leave: the side picked decides the open figure and the series offered. */
  const chooseSide = (text: string) => {
    const side = book?.sides?.find((candidate) => candidate.text === text);
    setValues((current) => ({ ...current, cmb_side: text }));
    if (side?.series[0]) void chooseSeries(side.series[0].text);
    setVlines((current) => current.map((line) => ({ ...line, cells: { ...line.cells, debit_amt: side && side.acDbcode === 2 && !journal ? "" : line.cells.debit_amt ?? "", credit_amt: side && side.acDbcode === 1 && !journal ? "" : line.cells.credit_amt ?? "" } })));
  };

  // ---- The product rows (C1dg_Inputdata): Product_Selection and the recalculation after each cell
  const productColumns = useMemo(() => book?.product.columns.filter((column) => column.visible) ?? [], [book]);
  const context = useMemo(() => (book ? { book, columns: productColumns } : null), [book, productColumns]);

  /**
   * Product_Selection's refusals, before the row takes the product: past its Last Date, locked (or warned) by its master
   * message (PROD_LOCK / PROD_WARN), the same product twice (I_DUPLICHK). True when the choice must not go on.
   */
  const productRefused = async (row: number, help: Readonly<Record<string, string>>): Promise<boolean> => {
    if (!book) return false;
    const same = lines[row]?.product !== null && lines[row]?.product !== undefined && String(lines[row].product!.key) === help.prod_key;
    const last = parseDesktopDate(help.last_date);
    const entryDate = parseDesktopDate(values.dtp_date);
    if (!same && last && entryDate && entryDate > last) { await say(`Entry date is greater than Product Last Date i.e. : ${formatDesktopDate(last)}`, "Entry Warning"); return true; }
    const message = (help.prod_message ?? "").trim();
    if (message !== "" && book.productRules.message === "lock") { await say(`Selected Product is Lock in Master The Reason is ${help.prod_message}`, "Entry Warning"); return true; }
    if (message !== "" && book.productRules.message === "warn") {
      const answer = await messageBox.ask(`Selected Product Warning Message! ${help.prod_message} Do You want to Continue Entry? `, "Product Warn Message", ["Yes", "No"], { defaultButton: "No" });
      if (answer !== "Yes") return true;
    }
    if (book.productRules.noDuplicate) {
      const at = lines.findLastIndex((line, index) => index !== row && line.product !== null && String(line.product.key) === help.prod_key);
      if (at >= 0) { await say(`Selected product already in used at Serial ${at + 1}`, "Entry Warning"); return true; }
    }
    return false;
  };

  const chooseProductRow = useCallback(async (row: number, helpRow: Readonly<Record<string, string>> | undefined) => {
    if (!helpRow || !register || !context) return;
    // A LINK register's rows come from the source entry: a product can not be picked or changed here.
    if (book?.link) { setHelpKind(null); return; }
    if (await productRefused(row, helpRow)) { setTimeout(enterHelp, 0); return; }
    setHelpKind(null);
    setBusy("Product");
    try {
      const body = await call<{ product: ProductChoice }>("product", { firstCombo: register, prodKey: Number(helpRow.prod_key), acCode: party?.code ?? 0, date: values.dtp_date ?? "" });
      const product = { ...body.product, stock1: helpRow.stock_1 ?? body.product.stock1, stock2: helpRow.stock_2 ?? body.product.stock2 };
      setLines((current) => {
        const copy = [...current];
        while (copy.length <= row) copy.push({ cells: {}, product: null });
        let chosen = chooseProduct(copy[row], product, context, slab);
        // A stock register whose rows go either way: a new row comes in (+) until the operator marks it out (-), as the desktop does.
        if (book?.stockNatBoth && !chosen.cells.prod_return) chosen = { ...chosen, cells: { ...chosen.cells, prod_return: "+" } };
        // IL_DIV: the product type the row was picked under is saved with it.
        copy[row] = prodFilter && productHelp?.filter ? { ...chosen, cells: { ...chosen.cells, il_div: prodFilter.value } } : chosen;
        return copy;
      });
      setProductText(null);
      // The next open cell of the row.
      const first = productColumns.find((column) => column.editable && column.key !== "prod_key");
      if (first) focusAfterDraw.current = `${row}:${first.key}`;
    } catch (error) {
      await failed(error);
    } finally {
      setBusy("");
    }
  }, [register, context, call, party, values.dtp_date, slab, productColumns, failed, lines, book, prodFilter, productHelp]);

  /**
   * F5 in the product help (or its Product cell): the products are over. A row with a product but
   * no quantity is taken off; a bill whose products come to nothing stops ("Total of All Product can
   * not be Zero Value", as the desktop, except the licences that allow it); else the help closes and
   * the keyboard goes to the slab grid (else the addon grid, else the narration).
   */
  const endProducts = async () => {
    const row = productRow ?? -1;
    const kept = lines.filter((line, index) => !(index === row && line.product && toNumber(line.cells.quantity) === 0));
    if (kept.length !== lines.length) setLines(kept);
    setProductText(null);
    const total = filledLines(kept).reduce((sum, line) => sum + toNumber(line.cells.il_value), 0);
    if (total === 0 && book?.bookActual && !ZERO_TOTAL_LICENCES.includes(def?.licence ?? 0)) {
      await say("Total of All Product can not be Zero Value", "Entry Warning");
      setTimeout(enterHelp, 0);
      return;
    }
    setHelpKind(null);
    const form = formRef.current;
    // The product grid shows from its first row (Sr. 1), so every product entered is on view whichever row F5 was pressed on.
    const showFromTop = () => { const box = form?.querySelector<HTMLElement>(".ent-product[aria-label=Products]"); if (box) { box.scrollTop = 0; box.scrollLeft = 0; } };
    setTimeout(showFromTop, 0);
    setTimeout(showFromTop, 120);
    if (focusFirstCell(form?.querySelector("[aria-label=Slab]")) || focusFirstCell(form?.querySelector("[aria-label=Addon]"))) return;
    afterGrids();
  };

  /** The +/- column of a row (a stock register whose rows go either way): "+" stock in, "-" stock out. */
  const markRow = (row: number, mark: string) => {
    setLines((current) => {
      const copy = [...current];
      while (copy.length <= row) copy.push({ cells: {}, product: null });
      copy[row] = { ...copy[row], cells: { ...copy[row].cells, prod_return: mark } };
      return copy;
    });
  };
  const productKeys = (event: ReactKeyboardEvent<HTMLInputElement>, row: number): boolean => {
    if (event.key === "F5") { event.preventDefault(); void endProducts(); return true; }
    // Job Stock In / Out ...: "+" or "-" on a row with no product yet marks it as stock in or out (the desktop's F2 on the empty row).
    if (book?.stockNatBoth && (event.key === "+" || event.key === "-") && !lines[row]?.product && (productText?.text ?? "") === "") {
      event.preventDefault();
      markRow(row, event.key);
      return true;
    }
    if (event.key === "F6") { event.preventDefault(); void togglePartyProducts(); return true; }
    if (helpKeys(event, "product", (helpRow) => void chooseProductRow(row, helpRow))) return true;
    // Enter on an empty row (nothing typed) ends the products: on to the slab grid's first open cell.
    if (event.key === "Enter" && !lines[row]?.product) {
      event.preventDefault();
      setHelpKind(null);
      if (!focusFirstCell(formRef.current?.querySelector("[aria-label=Slab]"))) focusFirstCell(formRef.current?.querySelector("[aria-label=Addon]"));
      return true;
    }
    return false;
  };
  /** A Product cell got the keyboard: the product help shows beside it. */
  const productFocus = (row: number) => {
    setProductRow(row);
    if (productText && productText.row !== row) setProductText(null);
    setHelpAt(0);
    // Back from the F7 stock window: the help stops on the product it was opened from, not the first one.
    // An empty row carries on from the row above: its product type and its product are where the help stops.
    const carried = lines[row]?.product ? undefined : lines.slice(0, row).reverse().find((line) => line.product);
    const land = stockLand.current ?? lines[row]?.product?.key ?? carried?.product?.key ?? null;
    helpLandOn.current = land;
    stockLand.current = null;
    setLandTick((now) => now + 1);
    // The keyboard goes into the product help (it is read already); Esc brings it back to this cell.
    // A book with a product filter (PGFILT) asks the product type first, for each new row.
    // A book with a product filter (PGFILT) shows the product type above the product help, always: a new row starts on it (its value is the row's, else the last one chosen),
    // and any change of it gives the same in the help below at once.
    if (book?.link) return;
    void openHelp("product").then((help) => {
      if (!help) return;
      if (help.filter && help.filter.options.length > 0) {
        const own = lines[row]?.cells.il_div || carried?.cells.il_div;
        const rowType = own ? help.filter.options.find((option) => option.value === own) : undefined;
        if (rowType) setProdFilter(rowType);
        // The list is cut to the type now: the landing is worked out again on it.
        helpLandOn.current = land;
        setLandTick((now) => now + 1);
        // The product type is always the first stop; Enter on it goes on to the product help.
        setTimeout(() => formRef.current?.querySelector<HTMLInputElement>(".ent-filter-bar input")?.focus(), 60);
        return;
      }
      setTimeout(enterHelp, 30);
    });
  };

  /** A cell to put the keyboard on once the product rows are drawn again (the next cell after a product is taken). */
  const focusAfterDraw = useRef<string | null>(null);
  useEffect(() => {
    if (focusAfterDraw.current && focusEntryCell(formRef.current, focusAfterDraw.current)) focusAfterDraw.current = null;
  }, [lines]);

  const editCell = useCallback(async (row: number, key: string, value: string) => {
    if (!context || !book) return;
    // C1dg_Inputdata_AfterEdit: an item-wise tax chosen against the product master's tax asks first (half each for CGST / SGST).
    const taxColumn = slab.some((item) => item.itemWise && item.master && item.short === key) ? productColumns.find((column) => column.key === key) : undefined;
    const line = lines[row];
    // Unit more than the source entry holds is not allowed (the quantity and the factor of a row made from a source line).
    if (line?.cells._link_il && (key === "quantity" || key === "factor")) {
      const limit = toNumber(key === "quantity" ? line.cells._max_qty : line.cells._max_factor);
      if (toNumber(value) > limit + 0.0000001) {
        await say("Unit more than Source Documents not allowed...", "Entry Warning");
        setTimeout(() => focusEntryCell(formRef.current, `${row}:${key}`), 0);
        return;
      }
    }
    if (taxColumn && value !== "" && line?.product) {
      const percOf = (text: string) => book.taxPercs[taxColumn.options?.find((option) => option.text === text)?.value ?? ""] ?? 0;
      const chosen = percOf(value);
      const expected = line.product.taxPerc > 0 && book.taxGroup === "G" ? line.product.taxPerc / 2 : line.product.taxPerc;
      if ((chosen > 0 || percOf(line.cells[key] ?? "") !== chosen) && Math.abs(chosen - expected) > 0.001) {
        const answer = await messageBox.ask("Selected Entry Tax And Product Master Tax Not Match Are You Continued Entry...", "Tax Selection Warning", ["Yes", "No"], { defaultButton: "No" });
        if (answer !== "Yes") { setTimeout(() => focusEntryCell(formRef.current, `${row}:${key}`), 0); return; }
      }
    }
    // The SGST (UTGST) tax of a product row is locked to the CGST % of the same row: choosing CGST puts the same % in SGST, and an SGST of another % is refused.
    const carried: Record<string, string> = {};
    const central = slab.find((item) => item.itemWise && item.master && /CGST/i.test(item.desc) && !/SGST|UTGST/i.test(item.desc));
    const state = slab.find((item) => item.itemWise && item.master && /SGST|UTGST/i.test(item.desc));
    if (central && state && value !== "") {
      const columnOf = (short: string) => productColumns.find((column) => column.key === short);
      const percIn = (short: string, text: string) => book.taxPercs[columnOf(short)?.options?.find((option) => option.text === text)?.value ?? ""] ?? 0;
      if (key === central.short) {
        const perc = percIn(central.short, value);
        const same = columnOf(state.short)?.options?.find((option) => (book.taxPercs[option.value] ?? 0) === perc);
        if (same) carried[state.short] = same.text;
      } else if (key === state.short && (line?.cells[central.short] ?? "") !== "") {
        const cgst = percIn(central.short, line?.cells[central.short] ?? "");
        const chosen = percIn(state.short, value);
        if (chosen > 0 && cgst > 0 && Math.abs(cgst - chosen) > 0.0001) {
          await say(`CGST And ${/UTGST/i.test(state.desc) ? "UTGST" : "SGST"} Tax Percentage Different not allowed...`, "Entry Warning");
          // Ok on the warning: editing goes on in the same cell of the same row.
          setTimeout(() => focusEntryCell(formRef.current, `${row}:${key}`), 0);
          return;
        }
      }
    }
    setLines((current) => current.map((line, index) => (index === row ? recalcLine({ ...line, cells: { ...line.cells, [key]: value, ...carried } }, key, context, slab) : line)));
  }, [context, book, slab, lines, productColumns]);

  const deleteRow = useCallback(async (row: number) => {
    if (!lines[row]?.product) return;
    const answer = await messageBox.ask(`Remove row ${row + 1} (${lines[row].cells.prod_key ?? ""})?`, "Delete Row", ["Yes", "No"], { defaultButton: "No" });
    if (answer === "Yes") setLines((current) => current.filter((_line, index) => index !== row));
  }, [lines]);

  // ---- Slab_RunTotal: from the product rows and the slab rows' own % / amounts
  const slabResult = useMemo(() => (book ? slabFromLines(book, slab, lines) : { amounts: [], runTotals: [], final: 0 }), [book, slab, lines]);
  // ---- Outstanding tab (c1dg_OutClear): the set-off amount of each pending bill is typed, and Total_Outstanding adds the columns up
  const [setoffState, setSetoffState] = useState<{ party: PartyDetails | null; values: Record<number, string> }>({ party: null, values: {} });
  const money = (value: string | undefined) => Number((value ?? "").replace(/,/g, "")) || 0;
  /** What was typed for the party read last (reading a party again, as opening an entry does, starts afresh). */
  const voucherSetoffs = voucher ? vlines[detailsRow ?? voucherRow ?? 0]?.setoffs : undefined;
  const typedSetoff = voucher
    ? Object.fromEntries((party?.outstanding ?? []).flatMap((row, index) => (voucherSetoffs?.[Number(row.out_key)] !== undefined ? [[index, voucherSetoffs[Number(row.out_key)]]] : [])))
    : setoffState.party === party ? setoffState.values : NO_SETOFF;
  const setSetoff = (change: (current: Record<number, string>) => Record<number, string>) => {
    if (!voucher) { setSetoffState((now) => ({ party, values: change(now.party === party ? now.values : NO_SETOFF) })); return; }
    const bills = party?.outstanding ?? [];
    setVlines((current) => current.map((line, index) => {
      if (index !== (detailsRow ?? voucherRow ?? 0)) return line;
      const byIndex = Object.fromEntries(bills.flatMap((bill, at) => (line.setoffs?.[Number(bill.out_key)] !== undefined ? [[at, line.setoffs[Number(bill.out_key)]]] : [])));
      const changed = change(byIndex);
      const setoffs = Object.fromEntries(Object.entries(changed).map(([at, value]) => [Number(bills[Number(at)]?.out_key), value]));
      // A row with no amount of its own takes the total of its set-offs (and keeps following it until a figure is typed in the row).
      const own = toNumber(line.cells.debit_amt) || toNumber(line.cells.credit_amt);
      if (own > 0 && line.cells._auto !== "1") return { ...line, setoffs };
      const total = Object.values(setoffs).reduce((sum, value) => sum + money(value), 0);
      const sideKey = rowSide(index) === 1 ? "debit_amt" : "credit_amt";
      const cells: Record<string, string> = { ...line.cells, [sideKey]: total > 0 ? fixed(total, 2) : "", _auto: "1" };
      if (!journal) cells[sideKey === "debit_amt" ? "credit_amt" : "debit_amt"] = "";
      return { ...line, setoffs, cells };
    }));
  };
  /** The set-off of each pending bill (by its row number): as typed, else what the opened entry had set off (the row's own figure). */
  const setoff = useMemo(() => {
    const out: Record<number, string> = {};
    (party?.outstanding ?? []).forEach((row, index) => {
      const value = typedSetoff[index] ?? (money(row.out_setoff) > 0 ? fixed(money(row.out_setoff), 2) : "");
      if (value !== "") out[index] = value;
    });
    return out;
  }, [party, typedSetoff]);
  const outstandingSetoff = Object.values(setoff).reduce((all, value) => all + money(value), 0);
  /** The totals of the rows the grid shows: how many (under Sr.), and the bill, pending and set-off amounts. */
  const outstandingTotals = (shown: readonly number[]) => {
    const sum = (key: string) => shown.reduce((all, row) => all + money(party?.outstanding[row]?.[key]), 0);
    return {
      serial: String(shown.length),
      out_entryamt: amountText(fixed(sum("out_entryamt"), 2), 2),
      out_pending: amountText(fixed(sum("out_pending"), 2), 2),
      out_setoff: amountText(fixed(shown.reduce((all, row) => all + money(setoff[row]), 0), 2), 2),
    };
  };
  const totals = useMemo(() => lineTotals(lines, book?.product.totals ?? [], (key) => (key === "il_value" ? 2 : key === "factor" ? book?.decimals.factor ?? 3 : book?.decimals.qty ?? 3)), [lines, book]);
  const decimalsOf = useCallback((key: string) => {
    if (!book) return 2;
    if (["quantity", "bundle", "pack_qty", "loose_qty", "stock_1", "stock_2"].includes(key)) return book.decimals.qty;
    if (key === "factor") return book.decimals.factor;
    if (key === "rate") return book.decimals.rate;
    return 2;
  }, [book]);

  const setSlabRow = (row: number, change: Partial<SlabRow>) => setSlab((rows) => rows.map((candidate, index) => (index === row ? { ...candidate, ...change } : candidate)));

  // ---- Invoice_Tab_Find_Edit_Enter: the register's entries in the series
  const openTab = useCallback(async (next: Tab) => {
    setTab(next);
    if (next === "outstanding" && voucher) { const line = vlines[voucherRow ?? 0]; if (line?.code) loadDetailsRef.current(voucherRow ?? 0, line.code); }
    if (next !== "find" || preview || !register) return;
    setBusy("Entries");
    try {
      const body = await call<{ preview: HelpData }>("preview", { firstCombo: register, series: values.cmb_series ?? "" });
      setPreview(body.preview);
    } catch (error) {
      await failed(error);
    } finally {
      setBusy("");
    }
  }, [preview, register, call, values.cmb_series, failed, voucher, vlines, voucherRow]);
  /** "All fields" (slab amounts and addons of each entry) and "With product" (and every product line): one server read each, only when asked. */
  const chooseFindMode = async (next: FindMode) => {
    if (next === "") { setFindMode(""); return; }
    if (!previewAll[next]) {
      if (!register) return;
      setBusy(next === "products" ? (voucher ? "All fields with outstanding" : "All fields with product") : "All fields");
      try {
        const body = await call<{ preview: HelpData }>("preview-all", { firstCombo: register, series: values.cmb_series ?? "", withProducts: next === "products" });
        setPreviewAll((now) => ({ ...now, [next]: body.preview }));
      } catch (error) {
        await failed(error);
        return;
      } finally {
        setBusy("");
      }
    }
    setFindMode(next);
  };

  // ---- C1Help_EntryPreview_DoubleClick → Restore_Entry: the entry opens, ready to edit
  const openEntry = useCallback(async (row: Readonly<Record<string, string>>) => {
    if (!register || !book) return;
    if (String(row.name ?? "").toLowerCase().includes("cancel invoice")) { await say("A cancelled invoice number opens for editing on the desktop only (not ported yet).", "Entry"); return; }
    // NewEditContinue: an entry being added, the same entry reloaded, or another entry taken while one is open - each is asked, with the desktop's words (No is the default).
    const sameEntry = restored !== null && restored === Number(row.unique_key);
    const working = filledLines(lines).length > 0 || filledVoucherLines(vlines).length > 0;
    if (restored === null ? working : true) {
      const words = restored === null ? "Add Entry not Save, will be lost! Do you want to continue with New Edit/Del ?" : sameEntry ? "Same Entry Reload will lost any unsave changes! Do you want to continue with Edit/Del ?" : "Last Edit Entry not Save, will be lost! Do you want to continue with New Edit/Del ?";
      const answer = await messageBox.ask(words, "Entry Edit/Delete", ["Yes", "No"], { defaultButton: "No" });
      if (answer !== "Yes") return;
    }
    setBusy("Opening the entry");
    try {
      const { entry } = await call<{ entry: Restored }>("restore", { firstCombo: register, uniqueKey: Number(row.unique_key) });
      let screenBook = book;
      // A debit / credit note opens against the book it was saved with: its slab follows that book, and the two labels show it.
      let reg = register;
      if (entry.against) {
        const saved = entry.against;
        if (register.against?.code !== saved.code || register.against?.nature !== saved.nature) { reg = { ...register, against: { code: saved.code, nature: saved.nature } }; setRegister(reg); }
        setAgainst({ book: `Ag: ${saved.accountName}`, nature: saved.natureText });
      }
      if (!entry.voucher && book.slab && (entry.taxGroup !== book.taxGroup || reg !== register)) screenBook = (await loadBook(reg, entry.taxGroup)).book;
      // Header and foot: a list box's saved key shows as its text.
      const next: Record<string, string> = {};
      for (const control of screenBook.controls) {
        const saved = entry.values[control.name];
        if (saved === undefined) { next[control.name] = control.initial; continue; }
        const option = control.type === "CB" && !control.options.some((candidate) => candidate.text === saved) ? control.options.find((candidate) => candidate.value === saved) : undefined;
        next[control.name] = option ? option.text : saved;
      }
      // The voucher style: the saved side (bk_dbcode, the day book's side) picks the Book Side whose account side is the other one.
      if (entry.voucher && screenBook.sides && screenBook.sides.length > 0) {
        const bookSide = Number(entry.values.cmb_side);
        const side = screenBook.sides.find((candidate) => candidate.acDbcode === (bookSide === 2 ? 1 : 2));
        if (side) next.cmb_side = side.text;
      }
      let partyDetails: PartyDetails | null = null;
      if (entry.partyCode > 0 && screenBook.party) partyDetails = (await call<{ party: PartyDetails }>("party", { firstCombo: reg, editKey: Number(row.unique_key), code: entry.partyCode, date: next.dtp_date ?? "", addressId: entry.addressId })).party;
      // The slab rows' own % and amounts (the item-wise ones come from the product rows).
      const slabRows = screenBook.slabRows.map((slabRow) => {
        const saved = entry.slab[slabRow.key];
        if (!saved || slabRow.itemWise) return slabRow;
        const perc = slabRow.master
          ? slabRow.options?.find((option) => option.value === String(entry.slabTax[slabRow.key] ?? ""))?.text ?? slabRow.perc
          : toNumber(saved.perc) !== 0 ? saved.perc : "";
        return { ...slabRow, perc, amount: saved.amount };
      });
      const columns = screenBook.product.columns;
      const restoredLines: Line[] = entry.lines.map((line) => {
        const cells: Record<string, string> = { ...line.cells };
        const items = entry.itemSlab[Number(cells._il_key)] ?? {};
        for (const slabRow of slabRows) {
          if (!slabRow.itemWise) continue;
          const saved = items[slabRow.key];
          if (!saved) continue;
          cells[slabRow.short] = slabRow.master
            ? columns.find((column) => column.key === slabRow.short)?.options?.find((option) => option.value === String(saved.taxId))?.text ?? ""
            : toNumber(saved.perc) !== 0 ? saved.perc : "";
          cells[`${slabRow.short}_amt`] = fixed(toNumber(saved.amount), 2);
        }
        // The quantity the bill already holds counts as stock of its own while it is edited (the stock check).
        cells._orig_qty = cells.quantity ?? "";
        return { cells, product: line.product };
      });
      blankEntry(true);
      setBook(screenBook);
      setSlab(slabRows);
      setValues(next);
      setParty(partyDetails);
      setAddon({ ...(entry.voucher ? voucherAddonDefaults(screenBook) : Object.fromEntries((partyDetails?.addon ?? []).map((item) => [item.key, item.value]))), ...entry.addon });
      setLines(restoredLines);
      // The account rows of a voucher: each as saved, with its ledger key (the Edit save changes the row by it).
      if (entry.voucher) {
        setVlines(entry.voucher.rows.map((voucherRow) => ({
          code: voucherRow.code, book: voucherRow.book,
          cells: { name: voucherRow.name, debit_amt: voucherRow.debit, credit_amt: voucherRow.credit, doc_no1: voucherRow.chqNo, chln_date: voucherRow.chqDate, _led_key: String(voucherRow.ledKey) },
          addon: { ...Object.fromEntries((screenBook.voucherAddon?.row ?? []).map((item) => [item.key, item.value])), ...voucherRow.addon },
          setoffs: Object.fromEntries(voucherRow.setoffs.map((item) => [item.outKey, item.amount])),
        })));
        setContra(entry.voucher.contra);
        accountReads.current.clear();
        const first = entry.voucher.rows[0];
        if (first) { setVoucherRow(0); void loadAccountDetails(0, first.code, first.ledKey, first.credit !== "" && first.debit === "" ? 2 : 1); }
      }
      restoredDate.current = next.dtp_date ?? "";
      setRestoredTds(entry.tdsAmount);
      setRestoredRows(restoredLines.length);
      // The entry is open: the keyboard goes to the Series, ready to type (a voucher shows series and book side only: it goes to the date).
      setTimeout(() => formRef.current?.querySelector<HTMLElement>(entry.voucher ? ".ent-head [data-box=dtp_date] input" : ".ent-head [data-first] input, .ent-head [data-first] button")?.focus(), 150);
      setRestored(entry.uniqueKey);
    } catch (error) {
      await failed(error);
    } finally {
      setBusy("");
    }
  }, [register, book, lines, vlines, restored, call, loadBook, blankEntry, say, failed]);

  /**
   * Link_Product_Rec / Restore_Entry for a LINK register: the lines chosen from the source entries become the rows of a new entry (their pending quantity, the
   * source's rate and units; the taxes and totals work out as for any chosen product), and each row remembers its source line for the Save.
   */
  const applyLinkEntry = async (entry: Restored) => {
    if (!register || !book) return;
    setBusy("Loading the entry");
    try {
      let screenBook = book;
      if (book.slab && entry.taxGroup !== book.taxGroup) screenBook = (await loadBook(register, entry.taxGroup)).book;
      const ctx = { book: screenBook, columns: screenBook.product.columns.filter((column) => column.visible) };
      const slabRows = [...screenBook.slabRows];
      const carried = ["quantity", "factor", "rate", "uomentry_id", "rateuom_id", "pack_qty", "master_rate", "_link_process", "_link_il", "_link_uom", "_file_qty", "_file_factor", "_max_qty", "_max_factor"];
      const nextLines: Line[] = entry.lines.map((source) => {
        const chosen = chooseProduct({ cells: {}, product: null }, source.product!, ctx, slabRows);
        const cells = { ...chosen.cells };
        for (const key of carried) if (source.cells[key] !== undefined && source.cells[key] !== "") cells[key] = source.cells[key];
        return recalcLine({ cells, product: chosen.product }, "quantity", ctx, slabRows);
      });
      const next: Record<string, string> = { ...values };
      for (const control of screenBook.controls) {
        const saved = entry.values[control.name];
        if (saved === undefined) { if (next[control.name] === undefined) next[control.name] = control.initial; continue; }
        const option = control.type === "CB" && !control.options.some((candidate) => candidate.text === saved) ? control.options.find((candidate) => candidate.value === saved) : undefined;
        next[control.name] = option ? option.text : saved;
      }
      let partyDetails: PartyDetails | null = null;
      if (entry.partyCode > 0 && screenBook.party) partyDetails = (await call<{ party: PartyDetails }>("party", { firstCombo: register, editKey: 0, code: entry.partyCode, date: next.dtp_date ?? "", addressId: entry.addressId })).party;
      setBook(screenBook);
      setSlab(slabRows);
      setValues(next);
      setParty(partyDetails);
      setAddon(Object.fromEntries((partyDetails?.addon ?? []).map((item) => [item.key, item.value])));
      setLines(nextLines);
      setTimeout(() => formRef.current?.querySelector<HTMLElement>(".ent-head [data-first] input, .ent-head [data-first] button")?.focus(), 150);
    } catch (error) {
      await failed(error);
    } finally {
      setBusy("");
    }
  };

  /** F5 in the link list: the ticked entries go to their lines, the ticked lines make the entry. */
  const linkDone = async (rows: readonly Readonly<Record<string, string>>[]) => {
    if (!linkPick || !register) return;
    try {
      if (linkPick.step === "entries") {
        if (rows.length === 0) { await say("Tick an entry to link.", "Entry Warning"); return; }
        if (new Set(rows.map((row) => row.party_name)).size > 1) { await say("Only Single Party Selection Allowed.", "Party Selection Warning"); return; }
        if (!linkPick.list.multi && rows.length > 1) { await say("Multiple Entry Selection not Allowed.", "Entry Warning"); return; }
        const processKeys = rows.map((row) => Number(row._key));
        setBusy("Lines");
        const { list } = await call<{ list: LinkListData }>("link-lines", { firstCombo: register, processKeys });
        setLinkPick({ step: "lines", list, processKeys });
        return;
      }
      // No line ticked: every pending line of the chosen entries.
      setBusy("Loading the entry");
      const { entry } = await call<{ entry: Restored }>("link-restore", { firstCombo: register, processKeys: linkPick.processKeys, ilKeys: rows.map((row) => Number(row._key)) });
      setLinkPick(null);
      await applyLinkEntry(entry);
    } catch (error) {
      await failed(error);
    } finally {
      setBusy("");
    }
  };

  // The register chosen: the keyboard goes to the series (a voucher: to the Book Side first, which may be changed) as soon as the screen is drawn.
  useEffect(() => {
    if (!book || !focusSeries.current) return;
    const target = (voucher ? screenRef.current?.querySelector<HTMLElement>(".ent-head [data-box=cmb_side] input, .ent-head [data-box=cmb_side] button") : null) ?? screenRef.current?.querySelector<HTMLElement>(".ent-head [data-first] input, .ent-head [data-first] button");
    if (target) { focusSeries.current = false; target.focus(); }
  }, [book, voucher]);

  // Zoom from a report row (Comman_Entry with Zoom_Ledid): the voucher's register is chosen, then the entry opens as from Find / Edit.
  const zoomStarted = useRef(false);
  const zoomPending = useRef<number | null>(null);
  useEffect(() => {
    if (!zoom || locked || !def || zoomStarted.current) return;
    zoomStarted.current = true;
    void (async () => {
      try {
        const reply = await call<{ zoom: { option: EntryOption; uniqueKey: number } }>("zoom", { ledKey: zoom });
        zoomPending.current = reply.zoom.uniqueKey;
        await chooseRegister(reply.zoom.option);
      } catch (error) {
        await failed(error);
      }
    })();
  }, [zoom, locked, def, call, chooseRegister, failed]);
  useEffect(() => {
    if (zoomPending.current === null || !register || !book) return;
    const uniqueKey = zoomPending.current;
    zoomPending.current = null;
    void openEntry({ unique_key: String(uniqueKey) });
  }, [register, book, openEntry]);

  // Before a register is chosen the whole form is on screen, closed: the first register's layout is read once for it.
  useEffect(() => {
    if (!def || locked || ghost || book || !selection) return;
    const first = def.firstCombo.options[0];
    if (!first) return;
    let cancelled = false;
    entryCall<BookReply>(selection, entryName, menuShortName, "book", { firstCombo: first, taxGroup: "G" })
      .then((body) => { if (!cancelled) setGhost(body.book); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [def, locked, ghost, book, selection, entryName, menuShortName]);

  // The box or cell being entered is brought fully into view, the product window and the page scrolling to it.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const show = (event: FocusEvent) => (event.target as HTMLElement).scrollIntoView?.({ block: "nearest", inline: "nearest" });
    form.addEventListener("focusin", show);
    return () => form.removeEventListener("focusin", show);
  }, []);

  // Enter moves to the next box of the header, as the desktop's KeyPreview did (the grids, the helps and the party box,
  // whose help is always showing, move on their own).
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const enter = (event: KeyboardEvent) => {
      // F5 is the entry's key (the products are over), never the browser's reload.
      if (event.key === "F5") { event.preventDefault(); return; }
      // The E-Way Bill tab's typed boxes: Enter goes to the next box.
      {
        const box = event.target as HTMLElement;
        if (event.key === "Enter" && box.tagName === "INPUT" && box.closest(".ent-eway") && !box.hasAttribute("data-cell")) { event.preventDefault(); nextEway(box); return; }
      }
      if (event.key !== "Enter" || event.defaultPrevented) return;
      const target = event.target as HTMLElement;
      const save = () => screenRef.current?.querySelector<HTMLElement>('[data-hotkey="s"]');
      // The narration: Enter leaves it for the next box (Shift+Enter is a new line). Credit days is the last box: Enter goes to Save.
      if (target.id === "ent-tbx_narration" && !event.shiftKey) { event.preventDefault(); if (!moveOn(form, target)) save()?.focus(); return; }
      if (target.id === "ent-tbx_credit_days") { event.preventDefault(); save()?.focus(); return; }
      if (target.tagName === "TEXTAREA" || target.id === "ent-tbx_partyname" || target.closest(".mp-combo-list, .ent-grid, .ent-find, .mp-help")) return;
      if (moveOn(form, target)) event.preventDefault();
      else if (target.closest(".ent-foot")) { event.preventDefault(); save()?.focus(); }
    };
    form.addEventListener("keydown", enter);
    return () => form.removeEventListener("keydown", enter);
  }, []);

  const quit = async () => {
    if (book && (party || filledLines(lines).length > 0 || filledVoucherLines(vlines).length > 0 || (values.tbx_narration ?? "") !== "")) {
      const answer = await messageBox.ask("Quit the entry? What is typed is not saved.", "Quit", ["Yes", "No"], { defaultButton: "No" });
      if (answer !== "Yes") return;
    }
    onClose();
  };
  /** Btn_Cancel_Click: "Are You Sure Want To Cancel Entry ?", then the screen is blank and the register can be chosen again. */
  const cancelEntry = async () => {
    if (!book) return;
    const answer = await messageBox.ask("Are You Sure Want To Cancel Entry ? ", "Entry Cancel", ["Yes", "No"], { defaultButton: "No" });
    if (answer !== "Yes") return;
    blankEntry(true);
    setBook(null);
    setValues({});
    setAccountHelp(null);
  };
  // Save opens once series, date and number are filled (or an entry is open from Find / Edit); Delete, Print, Range,
  // Upload Document, E-Invoice and Log only for an entry opened from Find / Edit. Cancel, Refresh and Quit always.
  const isRestored = restored !== null;
  const tdsNow = !isRestored && party && tds && tds.code === party.code ? tds.info : null;
  const canSave = Boolean(book) && (isRestored || ((values.cmb_series ?? "").trim() !== "" && (values.dtp_date ?? "").trim() !== "" && (values.tbx_number ?? "").trim() !== ""));
  /**
   * Btn_Save_Click (a new invoice): the screen's figures go to the server, which works them out again and writes the entry.
   * The server only commits when it is switched to (SMARTWINFA_ENTRY_SAVE_COMMIT); otherwise it writes, reads back and
   * rolls back, and the answer lists what a save would have written.
   */
  const saveEntry = async () => {
    if (!book || !register) return;
    if (tdsNow && (values.tbx_credit_days ?? "").trim() === "" && !voucher) {
      const answer = await messageBox.ask("TDS Amount Zero, Save Entry With TDS Amount Zero?", "TDS Amount Zero Message", ["Yes", "No"], { defaultButton: "Yes" });
      if (answer !== "Yes") return;
    }
    if (voucher) {
      if (filledVoucherLines(vlines).length === 0) { await say("Account Name not selected...", "Entry Warning"); return; }
      if (journal && Math.abs(toNumber(voucherTotals.debit) - toNumber(voucherTotals.credit)) > 0.005) { await say(`Debit and Credit Total are not Equal... (difference ${amountText(voucherTotals.difference, 2)})`, "Entry Warning"); return; }
    }
    if (!voucher && filledLines(lines).length === 0 && (book.inventory || slabResult.final <= 0)) { await say("Total of All Product can not be Zero Value", "Entry Warning"); return; }
    if ((await messageBox.ask("Confirm to save data?", "Confirm Save", ["Yes", "No"], { defaultButton: "Yes" })) !== "Yes") return;
    setBusy("Saving");
    try {
      const reply = await call<{ report: SaveReport; committed: boolean; commitDisabled?: boolean }>("save", {
        firstCombo: register,
        commit: true,
        save: voucher ? {
          values,
          rows: filledVoucherLines(vlines).map((line) => ({
            ledKey: Number(line.cells._led_key) || 0, code: line.code, debit: line.cells.debit_amt ?? "", credit: line.cells.credit_amt ?? "", chqNo: line.cells.doc_no1 ?? "", chqDate: line.cells.chln_date ?? "",
            addon: line.addon ?? {},
            setoffs: Object.entries(line.setoffs ?? {}).filter(([, amount]) => money(amount) > 0).map(([outKey, amount]) => ({ outKey: Number(outKey), amount: fixed(money(amount), 2) })),
          })),
          addon: { ...voucherAddonDefaults(book), ...addon },
          editKey: restored ?? 0,
        } : {
          values,
          party: { code: party?.code ?? 0, addressId: party?.addressId ?? 1 },
          lines: filledLines(lines).map((line) => ({ prodKey: line.product!.key, cells: line.cells })),
          slab: slab.map((row) => ({ perc: row.perc, amount: row.amount, manual: row.manual === true })),
          addon,
          setoffs: (party?.outstanding ?? []).flatMap((row, index) => (money(setoff[index]) > 0 ? [{ outKey: Number(row.out_key), amount: fixed(money(setoff[index]), 2) }] : [])),
          taxGroup: book.taxGroup,
          finalAmount: fixed(slabResult.final, 2),
          editKey: restored ?? 0,
        },
      });
      const counts = new Map<string, number>();
      for (const row of reply.report.rows) counts.set(row.table, (counts.get(row.table) ?? 0) + 1);
      const list = [...counts].map(([table, count]) => `${table} ${count}`).join(", ");
      if (reply.committed) {
        windowLink.changed();
        await say(`${reply.report.summary.renumberedFrom ? `Number ${reply.report.summary.renumberedFrom} was taken by another user meanwhile.\n` : ""}${reply.report.summary.fullDocNo} saved.  Amount ${amountText(String(reply.report.summary.finalAmount), 2)}`, "Entry Saved");
        // Upload Document: an entry that was changed keeps the rows the window was left with; a new entry is asked ("Upload Documents File?").
        if (def?.buttons.upload) {
          const savedKey = restored ?? reply.report.keys.pkval_1;
          if (restored !== null) { if (docPending) await saveDocuments(restored, docPending); }
          else if (savedKey > 0 && (await messageBox.ask("Upload Documents File?", "Upload Documents Message", ["Yes", "No"], { defaultButton: "Yes" })) === "Yes") {
            const rows = await askDocuments(docRowsFor([]));
            if (rows) await saveDocuments(savedKey, rows);
          }
        }
        blankEntry();
        setBook(null);
        setValues({});
        setAccountHelp(null);
      } else {
        await say(`Save checked, NOTHING was written (saving is switched off on this server).

${reply.report.summary.fullDocNo}   amount ${amountText(String(reply.report.summary.finalAmount), 2)}   book ${amountText(String(reply.report.summary.bookAmount), 2)}
Rows it would write: ${list}
Balance updates: ${reply.report.updates.length}`, "Save (dry run)");
      }
    } catch (error) {
      await failed(error);
    } finally {
      setBusy("");
    }
  };
  /** Btn_Delete_Click: after the question the invoice stays as a deleted row, its postings are taken off the balances. */
  const deleteEntry = async () => {
    if (!book || !register || restored === null) return;
    const answer = await messageBox.ask("Are You Sure Want To Delete Entry ? ", "Entry Delete", ["Yes", "No"], { defaultButton: "No" });
    if (answer !== "Yes") return;
    setBusy("Deleting");
    try {
      const reply = await call<{ report: SaveReport; committed: boolean }>("delete", { firstCombo: register, uniqueKey: restored, commit: true });
      if (reply.committed) {
        windowLink.changed();
        await say(`${reply.report.summary.fullDocNo} deleted.`, "Entry Deleted");
        blankEntry();
        setBook(null);
        setValues({});
        setAccountHelp(null);
      } else {
        await say(`Delete checked, NOTHING was changed (saving is switched off on this server).

${reply.report.summary.fullDocNo}`, "Delete (dry run)");
      }
    } catch (error) {
      await failed(error);
    } finally {
      setBusy("");
    }
  };
  /** Btn_Log_Click: the entry's special log (every save of it, side by side). */
  const showLog = async () => {
    if (!register || restored === null) return;
    setBusy("Reading the log");
    try {
      const reply = await call<{ log: EntryLogData }>("log", { firstCombo: register, uniqueKey: restored });
      if (reply.log.rows.length === 0) { await say("No log records for this entry.", "No Data"); return; }
      setLogView(reply.log);
    } catch (error) {
      await failed(error);
    } finally {
      setBusy("");
    }
  };
  /** Btn_Refresh_Click's Fill_AddonGridCombo("A"): the party's addon lists (transport, sub ledger ...) are read again; what was typed in the addon grid stays. */
  const refreshAddonLists = async () => {
    if (!register || !party || !book) return;
    try {
      const body = await call<{ party: PartyDetails }>("party", { firstCombo: register, editKey: restored ?? 0, code: party.code, date: values.dtp_date ?? "", addressId: party.addressId });
      setParty((now) => (now ? { ...now, addon: now.addon.map((item) => ({ ...item, options: body.party.addon.find((fresh) => fresh.key === item.key)?.options ?? item.options })) } : now));
    } catch (error) {
      await failed(error);
    }
  };

  // ---- Btn_Range_Click / Btn_Range_print_ok_Click: the entries from number to number of the series are ticked in Find / Edit, to print together
  const applyRange = async (from: number, to: number) => {
    if (!register) return;
    setRangeOpen(false);
    let list = preview;
    if (!list) {
      setBusy("Entries");
      try {
        list = (await call<{ preview: HelpData }>("preview", { firstCombo: register, series: values.cmb_series ?? "" })).preview;
        setPreview(list);
      } catch (error) {
        await failed(error);
        return;
      } finally {
        setBusy("");
      }
    }
    const series = (values.cmb_series ?? "").trim();
    const wanted = new Set<string>();
    for (let number = from; number <= Math.min(to, from + 5000); number += 1) wanted.add(`${series}/${number}`);
    const found = list.rows.filter((row) => wanted.has((row.full_docno ?? "").trim())).sort((a, b) => Number(a.doc_no) - Number(b.doc_no) || (a.doc_no ?? "").localeCompare(b.doc_no ?? "")).map((row) => Number(row.unique_key));
    setTicked(found);
    setTab("find");
    if (found.length === 0) await say(`No entries of ${series} from ${from} to ${to} are in the list.`, "Range Print");
  };
  const tickEntry = (key: number) => setTicked((now) => (now.includes(key) ? now.filter((item) => item !== key) : [...now, key]));
  /** The bill (Standard print) of the ticked entries, one after the other as one document; else of the opened entry. */
  const loadBills = async () => {
    if (!register) return "";
    const keys = ticked.length > 0 ? ticked : restored !== null ? [restored] : [];
    const bills: string[] = [];
    for (const key of keys) bills.push(standardBillHtml((await call<{ bill: Bill }>("bill", { firstCombo: register, uniqueKey: key })).bill));
    return combineBills(bills);
  };
  /** The number the exported file is named with: the opened entry's, or the first and last of the ticked ones. */
  const printNumber = () => {
    if (ticked.length === 0) return (values.tbx_number ?? "").trim();
    const numbers = ticked.map((key) => (preview?.rows.find((row) => Number(row.unique_key) === key)?.doc_no ?? "").trim()).filter(Boolean);
    return numbers.length > 1 ? `${numbers[0]}-${numbers[numbers.length - 1]}` : numbers[0] ?? "";
  };

  // ---- btn_UploadDocument_Click: up to five JPEG / PDF files kept with the entry (written when the entry is saved)
  const askDocuments = (initial: DocRow[]) => new Promise<DocRow[] | null>((resolve) => setDocsAsk({ initial, resolve }));
  const documentPayload = (rows: readonly DocRow[]) => rows.map((row) => ({ key: row.key, path: row.path, remark: row.remark, fileName: row.path, data: row.data }));
  /** The rows to the entry's own documents (after its Save); says so when this server only checks. */
  const saveDocuments = async (entryId: number, rows: readonly DocRow[]) => {
    if (!register || !rows.some((row) => row.key > 0 || row.path !== "")) return;
    const reply = await call<{ committed: boolean; saved: { inserted: number; updated: number; deleted: number } }>("doc-save", { firstCombo: register, uniqueKey: entryId, documents: documentPayload(rows) });
    if (!reply.committed) await say("Documents checked, NOTHING was written (saving is switched off on this server).", "Upload Document");
  };
  const uploadDocuments = async () => {
    if (!register || restored === null) return;
    let rows: DocRow[] | undefined = docPending ?? undefined;
    if (!rows) {
      setBusy("Documents");
      try {
        rows = (await call<{ documents: DocRow[] }>("doc-list", { firstCombo: register, uniqueKey: restored })).documents;
      } catch (error) {
        await failed(error);
        return;
      } finally {
        setBusy("");
      }
    }
    const result = await askDocuments(docRowsFor(rows));
    if (result) setDocPending(result);
  };
  /** F7 on a stored row: the file is read from the server; the window shows it (it is not downloaded). */
  const fetchStoredDocument = async (row: DocRow): Promise<Blob | null> => {
    if (!register || restored === null) return null;
    try {
      const { file } = await call<{ file: { name: string; type: string; data: string } }>("doc-file", { firstCombo: register, uniqueKey: restored, key: row.key });
      return new Blob([Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0))], { type: file.type });
    } catch (error) {
      await failed(error);
      return null;
    }
  };
  const notPorted = (what: string) => () => void say(`${what} is not ported to the web yet. Product entry and opening entries are done; saving comes next.`, "Entry");

  /** Credit days run 0 to 365, or 366 when the accounting year takes in a 29 February. */
  const maxCreditDays = yearHasLeapDay(yearStart, yearEnd) ? 366 : 365;
  /** The series offered: a voucher offers the picked book side's own series. */
  const seriesList = (item: InvoiceControl) => (voucher ? view?.sides?.find((side) => side.text === values.cmb_side)?.series ?? item.options : item.options);
  /** The days a date box takes: the entry date stays in the series' period; the challan date is never after the entry date and goes back no more than 120 days before the series starts. */
  const dateRange = (name: string) => {
    if (name === "dtp_date" && period) return { min: parseDesktopDate(period.from), max: parseDesktopDate(period.upto) };
    if (name === "dtp_chlndate") return { min: period ? parseDesktopDate(period.chlnFrom) : null, max: parseDesktopDate(values.dtp_date ?? "") };
    if (name === "dtp_entrydate") return { min: yearStart, max: yearEnd };
    return undefined;
  };
  /** Tbx_Credit_Days_Enter's TDS amount: the run total before the tax slab (slab_master Y, not linked) at the party's TDS %, rounded to the rupee. */
  const tdsAmountFor = (info: TdsInfo): string => {
    if (info.perc <= 0) return "";
    const LIMIT = 5000000;
    const even = (value: number) => { const down = Math.floor(value); const part = value - down; return part > 0.5 + 1e-9 ? down + 1 : part < 0.5 - 1e-9 ? down : down % 2 === 0 ? down : down + 1; };
    let out = "";
    slab.forEach((row, index) => {
      if (!(row.master && row.link < 0)) return;
      const before = (slabResult.runTotals[index] ?? 0) - (slabResult.amounts[index] ?? 0);
      if (info.purchaseSlab > 0) {
        if (info.purchaseYear < LIMIT && info.purchaseYear + before > LIMIT) out = String(even((info.purchaseYear + before - LIMIT) * info.perc / 100));
        else if (info.purchaseYear > LIMIT) out = String(even(before * info.perc / 100));
      } else out = String(even(before * info.perc / 100));
    });
    return out;
  };
  // ---- Voucher header keys
  /** An opened voucher shows its Series and Book Side only (changing them is not allowed). */
  const frozenOnEdit = (name: string) => voucher && isRestored && (name === "cmb_series" || name === "cmb_side");
  /** The last box of the voucher's header (Number, or Entry No. when the book has it): Enter / Tab goes to the first account row, whose help opens on its account. */
  const lastHeadBox = (book ?? ghost)?.controls.some((item) => item.name === "tbx_entryno") ? "tbx_entryno" : "tbx_number";
  const voucherLastBoxKey = (event: ReactKeyboardEvent<HTMLElement>, name: string) => {
    if (!voucher || name !== lastHeadBox || (event.key !== "Enter" && !(event.key === "Tab" && !event.shiftKey))) return;
    event.preventDefault();
    event.stopPropagation();
    focusEntryCell(formRef.current, "0:name");
  };
  const control = (item: InvoiceControl) => {
    const value = values[item.name] ?? "";
    if (item.tds && !tdsNow) return [];
    const set = (next: string) => setValues((current) => ({ ...current, [item.name]: next }));
    const shift = item.place === "B" ? DESKTOP_FOOT_TOP - FOOT_TOP : 0;
    const place = item.place === "T" ? headerPlace(item) : null;
    const labelStyle: CSSProperties = place?.label ?? { left: item.label_.left, top: item.label_.top - shift, width: item.label_.right ? Math.max(24, item.box.left - item.label_.left) : item.label_.width, height: item.label_.height, textAlign: item.label_.right ? "right" : "left" };
    const placedBox: CSSProperties = place?.box ?? { left: item.box.left, top: item.box.top - shift, width: item.box.width, ...(item.name === "tbx_narration" ? { height: Math.min(item.box.height, FORM_HEIGHT - 2 - (item.box.top - shift)) } : {}) };
    const boxStyle: CSSProperties = voucher && item.type === "DT" && item.place === "T" ? { ...placedBox, width: Number(placedBox.width) + VOUCHER_DATE_BUTTON } : placedBox;
    return [
      <label key={`${item.name}-label`} className={`ent-label ${item.compulsory ? "ent-compulsory" : ""}`} style={labelStyle} title={item.tooltip || undefined} htmlFor={`ent-${item.name}`}>{item.label}</label>,
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the box only hears focus, blur and keys bubble up from the entry control inside it
      <span
        key={item.name} data-box={item.name} className={`ent-box ent-box-${item.type}${frozenOnEdit(item.name) ? " ent-locked" : ""}`} style={boxStyle} {...(item.name === "cmb_series" ? { "data-first": "" } : {})}
        inert={frozenOnEdit(item.name)}
        onBlur={(event) => leaveBox(event, item.name)}
        onKeyDownCapture={(event) => voucherLastBoxKey(event, item.name)}
      >
        {item.type === "CB" ? (
          item.place === "E" ? (
            <EntryCell kind="combo" cellId={`eway:${item.name}`} value={value} options={item.options} tools={tools} ariaLabel={item.label} onChange={set} onEnter={() => ewayAfter(`eway:${item.name}`)} />
          ) : item.name === "cmb_series" ? (
            <SearchCombo ariaLabel={item.label} options={seriesList(item)} value={seriesList(item).find((option) => option.text === value) ?? null} onChoose={(option) => void chooseSeries(option.text)} />
          ) : (
            <SearchCombo
              ariaLabel={item.label}
              options={item.options}
              value={item.options.find((option) => option.text === value) ?? (value !== "" ? { text: value, value } : null)}
              onChoose={(option) => {
                if (item.name === "cmb_side") chooseSide(option.text); else set(option.text);
                if (item.place === "E") setTimeout(() => nextEway(document.activeElement), 0);
              }}
            />
          )
        ) : item.type === "DT" ? (
          <DateField
            ariaLabel={item.label}
            value={value}
            tools={tools}
            required={item.compulsory}
            range={dateRange(item.name)}
            onRefuse={(refused) => say(item.name === "dtp_chlndate" ? (period && refused < (parseDesktopDate(period.chlnFrom) ?? refused) ? `Challan date can not be earlier than ${period.chlnFrom} (120 days before the series starts)` : `Challan date can not be greater than the entry date ${values.dtp_date ?? ""}`) : item.name === "dtp_entrydate" ? "Date out of Accounting Year..." : "Date out of Series Period...", item.name === "dtp_chlndate" ? "Challan Date Warning" : "Date Warning")}
            onChange={(next) => {
              set(next);
              // A challan date is never after the entry date: moving the entry date back brings it along.
              if (item.name === "dtp_date" && values.dtp_chlndate) {
                const chln = parseDesktopDate(values.dtp_chlndate);
                const entry = parseDesktopDate(next);
                if (chln && entry && chln > entry) setValues((current) => ({ ...current, dtp_date: next, dtp_chlndate: next }));
              }
            }}
          />
        ) : item.name === "tbx_partyname" ? (
          <input
            id={`ent-${item.name}`}
            ref={partyRef}
            className="mp-control"
            aria-label={item.label}
            aria-haspopup="listbox"
            autoComplete="off"
            value={value}
            title="Type to search the account help · ↓ or F2 opens it · Enter takes the highlighted account"
            onChange={(event) => { set(event.target.value); setHelpAt(0); if (helpKind !== "account") void openHelp("account"); }}
            onKeyDown={partyKeys}
            onFocus={partyFocus}
            onBlur={(event) => leaveField(event, "account")}
          />
        ) : item.name === "tbx_narration" ? (
          <textarea id={`ent-${item.name}`} className="mp-control ent-narration" aria-label={item.label} maxLength={item.maxLength > 0 ? item.maxLength : undefined} value={value} onChange={(event) => set(event.target.value.replace(/'/g, ""))} />
        ) : item.name === "tbx_distancekm" ? (
          <EntryCell kind="number" positiveInteger cellId="eway:distance" value={value} onChange={set} tools={tools} ariaLabel={item.label} rules={WHOLE_NUMBER_RULES} align="right" clearable onEnter={() => ewayAfter("eway:distance")} />
        ) : item.name === "tbx_credit_days" && tdsNow ? (
          <>
            <input id={`ent-${item.name}`} className="mp-control ent-number" aria-label={item.label} inputMode="numeric" maxLength={12} value={value}
              title={`TDS at ${tdsNow.perc}%`}
              onFocus={(event) => { set(tdsAmountFor(tdsNow)); event.target.select(); }}
              onChange={(event) => set(event.target.value.split(".")[0].replace(/\D/g, ""))} />
            <span className="ent-label ent-tdsperc" style={{ position: "absolute", left: "100%", top: 0, marginLeft: 8, height: 22, lineHeight: "22px", whiteSpace: "nowrap" }}>TDS Perc : {tdsNow.perc}</span>
          </>
        ) : item.name === "tbx_credit_days" ? (
          <input id={`ent-${item.name}`} className="mp-control ent-number" aria-label={item.label} inputMode="numeric" maxLength={item.maxLength > 0 ? item.maxLength : 4} value={value}
            title={`Credit days: 0 to ${maxCreditDays}`} onFocus={(event) => event.target.select()}
            onChange={(event) => {
              const days = event.target.value.split(".")[0].replace(/\D/g, "");
              if (days !== "" && Number(days) > maxCreditDays) { void say(`Credit Days allowed from 0 to ${maxCreditDays}`, "Entry Warning"); return; }
              set(days);
            }} />
        ) : (
          <input id={`ent-${item.name}`} className="mp-control" aria-label={item.label} maxLength={item.maxLength > 0 ? item.maxLength : undefined} value={value} onChange={(event) => set(event.target.value)} />
        )}
      </span>,
    ];
  };

  const view = book ?? ghost;
  const voucherColumns = useMemo(() => (book ?? ghost)?.product.columns.filter((column) => column.visible && !/^addon_/i.test(column.key)) ?? [], [book, ghost]);
  const shownColumns = book ? productColumns : (ghost?.product.columns.filter((column) => column.visible) ?? []);
  const headControls = view?.controls.filter((item) => item.place === "T") ?? [];
  const footControls = view?.controls.filter((item) => item.place === "B") ?? [];
  const ewayControls = view?.controls.filter((item) => item.place === "E" && (def?.ewayDates || !["dtp_ewaydate", "tbx_ewayvalid"].includes(item.name))) ?? [];
  const showParty = Boolean(view?.party && headControls.some((item) => item.name === "tbx_partyname"));
  /** The address box: the party's, or on a voucher the address of the account the keyboard is on. */
  const showAddress = showParty || voucher;
  // The Particulars column 30% wider than the setup gives it; the slab grid grows by as much.
  const slabColumns = (view?.grids.slab ?? []).map((column) => (column.key === "slab_desc" ? { ...column, width: Math.round(column.width * 1.3) } : column));
  const slabWidth = slabColumns.reduce((sum, column) => sum + column.width, 0) + 20;
  const slabGridRows = slab.map((row, index) => ({
    slab_order: String(row.order), slab_mathoper: row.sign, slab_desc: row.desc, slab_perc: row.perc,
    slab_amount: fixed(slabResult.amounts[index] ?? 0, 2), s_lastot: fixed(slabResult.runTotals[index] ?? 0, 2),
  }));
  /**
   * Enter in the slab or addon grid: the next open cell (row by row, so the end of a row goes to
   * the next row); after the grid's last one, the addon grid (from the slab) or the narration.
   */
  /** C1dg_OutClear_AfterEdit: a set-off cannot pass the bill's pending amount, nor the sum of them the entry's amount. */
  const entryAmount = voucher ? rowAmount(outRow) : slabResult.final;
  /** A voucher row whose amount is not typed (it follows the set-offs): the set-offs have no amount to stay under yet. */
  const amountFollows = voucher && (vlines[outRow]?.cells._auto === "1" || rowAmount(outRow) === 0);
  const checkSetoff = async (row: number) => {
    const pending = money(party?.outstanding[row]?.out_pending);
    const mine = money(setoff[row]);
    const others = outstandingSetoff - mine;
    const left = amountFollows ? Number.POSITIVE_INFINITY : Math.max(0, entryAmount - others);
    let fixedTo: number | null = null;
    if (mine > pending) { await say("Outstanding Setoff Amount can not be greater than Balance Pending Amount...", "Entry Warning"); fixedTo = Math.min(pending, left); }
    else if (!amountFollows && others + mine > entryAmount + 0.005) { await say("Outstanding Setoff Amount can not be greater than Entry Amount...", "Entry Warning"); fixedTo = left; }
    if (fixedTo !== null) { setSetoff((current) => ({ ...current, [row]: fixedTo > 0 ? fixed(fixedTo, 2) : "" })); return false; }
    return true;
  };
  /** F4 / F8 on an empty set-off: the row's pending amount, or what is left of the entry amount. */
  /** Enter in a set-off box: the set-off is over only when the set-offs add up to the entry amount (or F5 is pressed); else the next bill's box, and after the last bill the first one again. */
  const nextSetoffCell = (cellId: string) => {
    const form = formRef.current;
    const box = form?.querySelector(`.ent-grid[aria-label=Outstanding]`);
    const cells = [...(box?.querySelectorAll<HTMLElement>("[data-cell]") ?? [])];
    const at = cells.findIndex((cell) => cell.getAttribute("data-cell") === cellId);
    const tallied = !amountFollows && entryAmount > 0 && Math.abs(outstandingSetoff - entryAmount) < 0.005;
    const next = cells[at + 1];
    if (tallied) { finishSetoff(); return; }
    (next ?? cells[0])?.focus();
  };
  const fillSetoff = (row: number) => {
    if (money(setoff[row]) !== 0) return;
    const pending = money(party?.outstanding[row]?.out_pending);
    const left = amountFollows ? Number.POSITIVE_INFINITY : entryAmount - outstandingSetoff;
    const amount = Math.min(pending, left);
    if (amount > 0) setSetoff((current) => ({ ...current, [row]: fixed(amount, 2) }));
  };
  const nextSideCell = (grid: "Slab" | "Addon" | "Outstanding", cellId: string) => {
    const form = formRef.current;
    const box = form?.querySelector(`.ent-grid[aria-label=${grid}]`);
    const cells = [...(box?.querySelectorAll<HTMLElement>("[data-cell], [data-cell-wrap]") ?? [])];
    const at = cells.findIndex((cell) => (cell.getAttribute("data-cell") ?? cell.getAttribute("data-cell-wrap")) === cellId);
    const next = cells[at + 1];
    if (next) { focusEntryCell(box, next.getAttribute("data-cell") ?? next.getAttribute("data-cell-wrap") ?? ""); return; }
    if (grid === "Slab" && focusFirstCell(form?.querySelector("[aria-label=Addon]"))) return;
    afterGrids();
  };
  /** The last round-off row works its amount out (slab_calc A, or B with no decimals): nothing to type. */
  const roundsOff = (row: number) => { const item = slab[row]; return Boolean(item) && row === slab.length - 1 && item.mathOp === "U" && item.calc === "A"; };
  /** slab_calc B (auto + manual): the last row works the round-off out, the keyboard halts there, and a figure typed replaces it. */
  const roundsAuto = (row: number) => { const item = slab[row]; return Boolean(item) && row === slab.length - 1 && item.mathOp === "U" && item.calc === "B" && item.roundPlaces === 0; };
  /** A slab row's own % is typed (a % row) or chosen (a tax row); its amount is typed where the row allows it. */
  /** C1dg_Slab_AfterEdit: the SGST (UTGST) tax chosen must be the CGST row's percentage. */
  const chooseSlabTax = async (row: number, perc: string) => {
    const item = slab[row];
    const percOf = (candidate: SlabRow, text: string) => view?.taxPercs[candidate.options?.find((option) => option.text === text)?.value ?? ""] ?? 0;
    if (book && /SGST|UTGST/i.test(item.desc) && !item.itemWise) {
      const central = slab.find((candidate) => !candidate.itemWise && /CGST/i.test(candidate.desc));
      const chosen = percOf(item, perc);
      const cgst = central ? percOf(central, central.perc) : 0;
      if (chosen > 0 && cgst > 0 && Math.abs(cgst - chosen) > 0.0001) {
        await say(`CGST And ${/UTGST/i.test(item.desc) ? "UTGST" : "SGST"} Tax Percentage Different not allowed...`, "Entry Warning");
        // Ok on the warning: editing goes on in the same slab row.
        setTimeout(() => focusEntryCell(formRef.current, `s${row}:slab_perc`), 0);
        return;
      }
    }
    setSlabRow(row, { perc });
    // The CGST % chosen puts the same % on the SGST (UTGST) row, which only takes that %.
    if (book && /CGST/i.test(item.desc) && !/SGST|UTGST/i.test(item.desc) && !item.itemWise) {
      const linked = slab.findIndex((candidate) => !candidate.itemWise && /SGST|UTGST/i.test(candidate.desc));
      const wanted = percOf(item, perc);
      const same = linked >= 0 && wanted > 0 ? slab[linked].options?.find((option) => (view?.taxPercs[option.value] ?? 0) === wanted) : undefined;
      if (same) setSlabRow(linked, { perc: same.text });
    }
  };
  /** Enter in an E-Way Bill box: the next box of the tab; after the last, the narration. */
  /** The tab's editable boxes in the order the eye reads them (row by row, left to right), not in the order the setup lists them. */
  const ewayBoxes = () => {
    const found = [...(formRef.current?.querySelectorAll<HTMLElement>(".ent-eway input:not([disabled]):not([readonly]), .ent-eway button[data-cell]:not([disabled])") ?? [])].filter((box) => box.offsetParent !== null);
    const placed = found.map((box) => { const at = box.getBoundingClientRect(); return { box, top: Math.round(at.top / 8), left: at.left }; });
    return placed.sort((a, b) => a.top - b.top || a.left - b.left).map((item) => item.box);
  };
  /**
   * The box after the one with this cell id. Looked up by id, once the screen has drawn again: a combo's list is open while it is chosen from,
   * so the keyboard is then in the list, not in the box (going by the active element skipped the boxes that follow).
   */
  const ewayAfter = (cellId: string) => setTimeout(() => nextEway(formRef.current?.querySelector(`.ent-eway [data-cell="${cellId}"]`) ?? null), 0);
  const nextEway = (from: Element | null) => {
    const boxes = ewayBoxes();
    const at = boxes.findIndex((box) => box === from || box.contains(from));
    const next = boxes[at + 1];
    if (at >= 0 && next) { next.focus(); return; }
    setTab("all");
    setTimeout(() => formRef.current?.querySelector<HTMLElement>("#ent-tbx_narration")?.focus(), 0);
  };
  /**
   * After the last grid: a sale whose final amount is above the E-Way limit (within the company state, or out of it) on or after the E-Way start date
   * takes the E-Way Bill tab, the keyboard on its first box; any other entry goes on to the narration (Invoice_Tab_EwayBill.Show()).
   */
  const ewayDue = (): boolean => {
    const limit = party?.taxGroup === "G" ? def?.ewayLimits.within ?? 0 : party?.taxGroup === "I" ? def?.ewayLimits.out ?? 0 : 0;
    const date = parseDesktopDate(values.dtp_date);
    return Boolean(def?.tabs.eway && book?.stockNat === "L" && book.bookActual !== false && limit > 0 && slabResult.final > limit && date && date >= EWAY_START && !/^(LQTN-ORD|ORD-IN)$/i.test(register?.text ?? ""));
  };
  const afterOutstanding = () => {
    const due = ewayDue();
    if (due) {
      setTab("eway");
      setTimeout(() => ewayBoxes()[0]?.focus(), 60);
      return;
    }
    formRef.current?.querySelector<HTMLElement>("#ent-tbx_narration")?.focus();
  };
  /**
   * After the last grid (Fill_Display_OutstandingScreen): a debit / credit note goes on to the Outstanding tab, the keyboard on the first set-off box;
   * anything else carries on as afterOutstanding does.
   */
  const afterGrids = () => {
    if (book?.setoff && (party?.outstanding.length ?? 0) > 0) {
      setTab("outstanding");
      setTimeout(() => formRef.current?.querySelector<HTMLElement>(".ent-grid[aria-label=Outstanding] input[data-cell^=os]")?.focus(), 80);
      return;
    }
    afterOutstanding();
  };
  /** Narration_Generate (O): "Setoff for Bill: <bill numbers>" from the bills that have a set-off, when the narration is still empty. */
  const generateSetoffNarration = () => {
    const rows = party?.outstanding ?? [];
    let text = "";
    rows.forEach((row, index) => {
      if (money(setoff[index]) <= 0) return;
      const full = (row.out_fulldocno ?? "").trim();
      const series = (row.doc_series ?? "").trim();
      const number = (row.doc_no ?? "").trim();
      const own = (row.doc_no1 ?? "").trim();
      const seen = text.includes(series);
      let shown: string;
      if (def?.licence === 21) shown = !seen ? (own === "" ? full : own) : own === "" ? number : own;
      else shown = !seen ? full : number;
      if (def?.licence === 20) shown += ` DATED: ${row.out_date ?? ""}`;
      text += (text.trim() === "" ? "" : ",") + shown;
    });
    if (text === "") return;
    const label = def?.licence === 20 ? "SETOFF FOR BILL" : "Setoff for Bill";
    // A narration that already has the "Setoff for Bill: ..." words (an entry being edited) gets its list of bills replaced, the other words kept.
    // Only the party's own bill numbers count as the list, so words the user typed right after it ("DSAL/25-26/9577-Being CN ...") are never taken for part of it.
    const names = new Set<string>();
    for (const row of rows) for (const name of [row.out_fulldocno, row.doc_no, row.doc_no1]) if ((name ?? "").trim() !== "") names.add((name ?? "").trim());
    const escapeRx = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const bill = `(?:${[...names].sort((a, b) => b.length - a.length).map(escapeRx).join("|")})(?: DATED: [^\\s,]+)?`;
    const listed = new RegExp(`(setoff for bill:\\s*)${bill}(?:,${bill})*`, "i");
    setValues((current) => {
      const narration = current.tbx_narration ?? "";
      if (narration.trim() === "") return { ...current, tbx_narration: `${label}: ${text}` };
      return listed.test(narration) ? { ...current, tbx_narration: narration.replace(listed, (_all, lead: string) => `${lead}${text}`) } : current;
    });
  };
  /** Run_Outclear_f5: the set-off is over - the narration is made and the keyboard goes on (E-Way Bill or narration). */
  const finishSetoff = () => {
    generateSetoffNarration();
    if (!voucher) { afterOutstanding(); return; }
    setTab("all");
    setTimeout(() => focusEntryCell(formRef.current, `${outRow + 1}:name`), 80);
  };
  /**
   * Product code, Qty, Q.Uom and the item-wise GST are compulsory; Rate and R.Uom too unless the book (book_properties stkm_ropt O) leaves them optional.
   * Enter on one of them left blank stays there with the reason.
   */
  /** The value each product cell held when the keyboard came to it, by `row:key`. */
  const cellWas = useRef<Record<string, string>>({});
  const requiredLeave = async (row: number, key: string): Promise<boolean> => {
    if (!book || !lines[row]?.product) return true;
    const column = productColumns.find((candidate) => candidate.key === key);
    if (!column || !column.editable) return true;
    const lower = key.toLowerCase();
    const gst = slab.some((item) => item.itemWise && item.master && item.short === key);
    const needed = lower === "quantity" || lower === "uomentry_id" || gst || ((lower === "rate" || lower === "rateuom_id") && !book.productRules.rateOptional);
    if (!needed) return true;
    const value = (lines[row]?.cells[key] ?? "").trim();
    if (value !== "" && (lower !== "quantity" || toNumber(value) !== 0)) return true;
    await say(`${column.caption.replace(/%$/, "")} is compulsory, enter a value`, "Entry Warning");
    // What the cell held before it was emptied comes back, so the entry is not lost.
    const was = cellWas.current[`${row}:${key}`] ?? "";
    if (was.trim() !== "") void editCell(row, key, was);
    setTimeout(() => focusEntryCell(formRef.current, `${row}:${key}`), 30);
    return false;
  };
  /**
   * Compulsory stock checking (C1dg_Inputdata_ValidateEdit): leaving Qty, a quantity above the product's stock is refused ("Quantity Greater than N not allowed")
   * and put back to the stock; with no stock the quantity is cleared and the keyboard goes back to the Product. An opened bill counts what it already holds.
   */
  const stockLeave = async (row: number, key = "quantity"): Promise<boolean> => {
    if (!(await requiredLeave(row, key))) return false;
    if (key !== "quantity") return true;
    if (!book?.productRules.stockCheck) return true;
    const line = lines[row];
    if (!line?.product) return true;
    const quantity = toNumber(line.cells.quantity);
    const stock = toNumber(line.cells.stock_1);
    const allowed = stock + toNumber(line.cells._orig_qty);
    if (quantity <= allowed) return true;
    await say(`Quantity Greater than ${fixed(stock, book.decimals.qty)} not allowed`, "Entry Warning");
    if (allowed > 0) {
      void editCell(row, "quantity", fixed(allowed, book.decimals.qty));
      setTimeout(() => focusEntryCell(formRef.current, `${row}:quantity`), 30);
    } else {
      void editCell(row, "quantity", "");
      setTimeout(() => focusEntryCell(formRef.current, `${row}:prod_key`), 30);
    }
    return false;
  };
  /** C1dg_Inputdata: an item-wise discount's amount cell opens (the keyboard stops there) while its % is left blank; with a % it is worked out. */
  const itemAmountOpen = (column: EntryColumn, row: number): boolean | undefined => {
    const lower = column.key.toLowerCase();
    const item = slab.find((candidate) => candidate.itemWise && !candidate.master && `${candidate.short}_amt`.toLowerCase() === lower);
    if (!item) return undefined;
    return toNumber(lines[row]?.cells[item.short]) === 0;
  };
  const slabCell = (row: number, key: string) => {
    const item = slab[row];
    const shown = slabGridRows[row];
    const cellId = `s${row}:${key}`;
    const onEnter = () => nextSideCell("Slab", cellId);
    if (key === "slab_perc" && !item.itemWise && item.options && item.options.length > 0) {
      return <EntryCell kind="combo" cellId={cellId} value={item.perc} options={item.options} tools={tools} ariaLabel={`${item.desc} tax`} onChange={(perc) => void chooseSlabTax(row, perc)} onEnter={onEnter} />;
    }
    if (key === "slab_perc" && item.percEditable && !item.itemWise) {
      return <EntryCell kind="number" cellId={cellId} value={item.perc} align="right" rules={PERCENT_RULES} tools={tools} ariaLabel={`${item.desc} %`} onChange={(perc) => setSlabRow(row, { perc })} onEnter={onEnter} />;
    }
    const typedAmount = item.amountEditable && !item.itemWise && !roundsOff(row) && !(row === 0 && view?.inventory && item.calc !== "M") && !(toNumber(item.perc) > 0 && item.percEditable);
    if (key === "slab_amount" && typedAmount) {
      const auto = roundsAuto(row);
      const shownAmount = auto && !item.manual ? fixed(slabResult.amounts[row] ?? 0, 2) : item.amount === "0.00" ? "" : item.amount;
      return <EntryCell kind="number" cellId={cellId} value={shownAmount} align="right" rules={AMOUNT_RULES} tools={tools} ariaLabel={`${item.desc} amount`} onChange={(amount) => setSlabRow(row, auto ? { amount, manual: amount.trim() !== "" } : { amount })} onEnter={onEnter} />;
    }
    const value = shown[key as keyof typeof shown] ?? "";
    return key === "slab_amount" || key === "s_lastot" ? amountText(value, 2) : value;
  };

  /** The window smaller than the form: the form shrinks to fit (down to 70%) instead of scrolling. */
  const [fit, setFit] = useState(1);
  useEffect(() => {
    const box = screenRef.current?.querySelector<HTMLElement>(".ent-scroll");
    if (!box) return;
    const measure = () => {
      const width = (box.clientWidth - 12) / FORM_MIN_WIDTH;
      const height = (box.clientHeight - 10) / (FORM_HEIGHT + 2);
      const next = Math.max(0.7, Math.min(1, width, height));
      setFit((current) => (Math.abs(current - next) < 0.005 ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  /** The part of the entry screen the operator can see (the form is wider than a small window): a help opens inside it, so the screen need not be scrolled to read it. */
  const [seen, setSeen] = useState<{ left: number; width: number } | null>(null);
  useEffect(() => {
    const box = screenRef.current?.querySelector<HTMLElement>(".ent-scroll");
    if (!box || !helpKind) return;
    const measure = () => setSeen(box.scrollWidth > box.clientWidth + 1 ? { left: box.scrollLeft, width: box.clientWidth } : null);
    measure();
    box.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    return () => { box.removeEventListener("scroll", measure); window.removeEventListener("resize", measure); };
  }, [helpKind]);
  const helpStyle = (kind: HelpKind): CSSProperties => ({
    ...(seen ? { top: kind === "account" ? (voucher ? VOUCHER_HELP_TOP : 28) : TAB_TOP + 60, left: seen.left + 8, right: "auto", bottom: "auto" }
      : kind === "account" ? { top: voucher ? VOUCHER_HELP_TOP : 28, right: PARTY_RIGHT, left: "auto", bottom: "auto" } : { left: 40, top: TAB_TOP + 60, right: "auto", bottom: "auto" }),
    maxHeight: "none", maxWidth: seen ? seen.width - 16 : "calc(100% - 16px)", zIndex: 30,
    ...((kind === "account" ? accountDrag.style : productDrag.style) ?? {}),
  });

  if (fatal) return <div className="mp-screen"><p className="mp-error">{fatal}</p><button type="button" className="mp-btn mp-btn-red" onClick={onClose}><Icon name="quit" />Quit</button></div>;

  return (
    <div ref={screenRef} className={`mp-screen ent-screen ${locked && def ? "mp-locked" : ""}`} role="region" aria-label={def?.caption || title}>
      {linkPick && <LinkPick key={linkPick.step} title={linkPick.step === "entries" ? "LINK - PENDING ENTRIES" : "LINK - PENDING LINES"} list={linkPick.list} onDone={(rows) => void linkDone(rows)} onClose={() => setLinkPick(null)} />}
      {stockView && <PartyStock stock={stockView} onClose={closeStock} />}
      {ledgerView && <AccountLedger ledger={ledgerView} onClose={closeLedger} />}
      {details && <MasterDetails details={details.data} kind={details.kind} onClose={closeDetails} />}
      {logView && <EntryLog log={logView} docNo={(values.tbx_number ?? "").trim()} title={register?.text ?? title} onClose={() => setLogView(null)} />}
      <div className="ent-scroll">
        <div ref={formRef} className="ent-form" style={{ height: FORM_HEIGHT, ...(fit < 1 ? { zoom: fit } : {}) }} role="group" aria-label={def?.caption || title}>
          <div className="ent-head" role="group" aria-label={`${def?.caption || title} header`}>
            <label className="ent-label ent-register-label" style={{ left: 2, top: 6, width: 84 }} htmlFor="ent-register">{def?.firstCombo.label ?? "Register"}</label>
            <span className="ent-box ent-register" style={{ left: 86, top: 6, width: voucher ? VOUCHER_REGISTER_WIDTH : 317 }} id="ent-register">
              <SearchCombo
                ariaLabel={def?.firstCombo.label ?? "Register"}
                options={def?.firstCombo.options ?? []}
                value={register ?? defaultRegister}
                reselect
                disabled={locked || !def || Boolean(book) || Boolean(busy && busy !== "")}
                focus={!locked && !book && Boolean(def)}
                onChoose={(option) => void chooseRegister(option)}
              />
            </span>
            {view && <span className="ent-side" style={{ left: voucher ? VOUCHER_SIDE_LEFT : 406, top: 6 }} title="Book posting side">{view.side}</span>}
            {view?.balance && <span className="ent-balance" style={{ left: 238, top: 28 }} title="Book balance as on the last date of the year">{view.balance}</span>}
            <div style={{ display: "contents" }} inert={!book}>{headControls.flatMap(control)}</div>
            {view && headControls.some((item) => item.name === "dtp_date") && (() => {
              const dateBox = headControls.find((item) => item.name === "dtp_date")!.box;
              return <span className="ent-day" style={voucher ? { left: dateBox.left + dateBox.width + VOUCHER_DATE_BUTTON + 6, top: dateBox.top } : { left: 204, top: 50 }}>{dayOf(values.dtp_date ?? "")}</span>;
            })()}
            {view && headControls.some((item) => item.name === "dtp_chlndate") && <span className="ent-day" style={{ left: 204, top: 72 }}>{dayOf(values.dtp_chlndate ?? "")}</span>}
            {view && headControls.some((item) => item.name === "dtp_entrydate") && <span className="ent-day" style={{ left: 616, top: 50 }}>{dayOf(values.dtp_entrydate ?? "")}</span>}
            {showAddress && (
              <>
                <span className="ent-label" style={{ right: PARTY_RIGHT + PARTY_WIDTH + 6, top: voucher ? VOUCHER_ADDRESS.top : 28, width: 74 }}>Address</span>
                <dl className="ent-address" style={{ right: PARTY_RIGHT, top: voucher ? VOUCHER_ADDRESS.top : 28, width: PARTY_WIDTH, height: voucher ? VOUCHER_ADDRESS.height : TAB_TOP - 32 }} aria-label="Party address" title={(party?.addresses.length ?? 0) > 1 ? "Double-click to choose another address of the party" : "Closing balance, address, telephone, GST number, opening balance, credit days and limit"} onDoubleClick={() => { if (book && party && !voucher && party.addresses.length > 1) setAddressPick(party); }}>
                  {addressFields(party?.address ?? []).map((item, index) => (
                    <div key={index} className={`ent-addr-item ${item.value.length > 26 || /^(address|ship to|email id|emil id|website)$/i.test(item.label) ? "ent-addr-wide" : ""}`}>
                      <dt>{item.label}</dt>
                      <dd title={item.value}>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
            {/* The mode (EDIT for an entry opened from Find / Edit, else ADD) sits after the Debit / Credit label on the register's row, with a margin. */}
            {book && <span className={`ent-mode ${isRestored ? "" : "ent-mode-add"}`} style={{ left: (voucher ? VOUCHER_SIDE_LEFT : 406) + 55 + 12, top: 6 }} title={isRestored ? "An entry opened from Find / Edit" : "A new entry"}>{isRestored ? "EDIT" : "ADD"}</span>}
          </div>

          {helpKind && shownHelp && (
            <div className="ent-help-host" onBlur={leaveHelp}>
            <HelpList
              help={shownHelp}
              focusRow={Math.min(helpAt, shownHelp.rows.length - 1)}
              onFocusRow={setHelpAt}
              onChoose={(index) => (helpKind === "account" ? (voucher ? voucherRow !== null && void chooseVoucherAccount(voucherRow, shownHelp.rows[index]) : void choosePartyRow(shownHelp.rows[index])) : productRow !== null && void chooseProductRow(productRow, shownHelp.rows[index]))}
              searchKey={HELP_MAIN[helpKind]}
              onClose={() => closeHelp()}
              onEscape={() => focusHelpField(helpKind)}
              onKey={(event) => {
                if (event.key === "F1") { event.preventDefault(); void showDetails(helpKind); return true; }
                // The product-type filter sits above the first row: ↑ on it goes there.
                if (helpKind === "product" && productHelp?.filter && event.key === "ArrowUp" && helpAt === 0) { event.preventDefault(); formRef.current?.querySelector<HTMLInputElement>(".ent-filter-bar input")?.focus(); return true; }
                if (event.key === "F7" && helpKind === "account") { event.preventDefault(); void (voucher ? showPartyOutstanding() : showPartyStock()); return true; }
                if (event.key === "F5" && helpKind === "account" && voucher) { event.preventDefault(); void endVoucherRows(); return true; }
                if (event.key === "F6" && helpKind === "product") { event.preventDefault(); void togglePartyProducts(); return true; }
                if (event.key === "F7" && helpKind === "product") { event.preventDefault(); productHelpStock(); return true; }
                if (event.key === "F8" && helpKind === "account") { event.preventDefault(); void showLedger(); return true; }
                if (helpKind === "product" && event.key === "F5") { event.preventDefault(); void endProducts(); return true; }
                // The product help has the keyboard while a row is being filled: "+" or "-" before any search text marks the row (stock in / out).
                if (helpKind === "product" && book?.stockNatBoth && productRow !== null && (event.key === "+" || event.key === "-") && typed.trim() === "" && !lines[productRow]?.product) { event.preventDefault(); markRow(productRow, event.key); return true; }
                return false;
              }}
              onHeadingClick={helpView.sortBy}
              sortMark={helpView.sortMark}
              headingTools={helpView.headingTools}
              filteredColumn={helpView.filteredColumn}
              title={helpKind === "account" ? "ACCOUNT HELP" : "PRODUCT HELP"}
              highlight={typed}
              freezeSearch
              style={helpStyle(helpKind)}
              dragHandle={helpKind === "account" ? accountDrag.handle : productDrag.handle}
              onResetPosition={helpKind === "account" ? accountDrag.reset : productDrag.reset}
              formatCell={helpCell}
              f1
              f7={helpKind === "account" ? (voucher ? "Outstanding" : true) : "Party-Product"}
              topSlot={helpKind === "product" && productHelp ? (
                // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the bar keeps the keys of its own controls from reaching the help list around it
                <div className="ent-filter-bar" onKeyDown={(event) => event.stopPropagation()} onKeyDownCapture={(event) => {
                  if (event.key === "F6") { event.preventDefault(); event.stopPropagation(); void togglePartyProducts(); }
                  else if (event.key === "F5") { event.preventDefault(); event.stopPropagation(); void endProducts(); }
                  else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeHelp(); }
                }}>
                  {productHelp.filter && productHelp.filter.options.length > 0 && (
                    <>
                      <label>{properHeading(productHelp.filter.caption)}</label>
                      <SearchCombo ariaLabel={productHelp.filter.caption} options={productHelp.filter.options} value={prodFilter} reselect onChoose={(option) => { if (option.value !== prodFilter?.value) { setProdFilter(option); setHelpAt(0); } setTimeout(enterHelp, 30); }} />
                    </>
                  )}
                  {productRow !== null && (() => {
                    const line = lines[productRow];
                    return <span className="ent-rowinfo" title="The row being entered">Sr.{productRow + 1} · Prod: {line?.product?.short ?? "-"} · Qty: {line?.cells.quantity || "-"} · Rate: {line?.cells.rate || "-"}</span>;
                  })()}
                  <kbd className={`mp-help-f1 ent-f6${partyOnly ? " ent-f6-on" : ""}`} title="F6 shows the products this party has already taken; F6 again, every product"><b>F6</b>-Help-Party-Product</kbd>
                </div>
              ) : undefined}
              f8={helpKind === "account"}
              shown={helpKind === "product" ? PRODUCT_HELP_ROWS : voucher ? VOUCHER_HELP_ROWS : HELP_ROWS}
            />
            </div>
          )}

          {addressPick && <AddressPick name={addressPick.name} rows={addressPick.addresses} current={addressPick.addressId} onChoose={(id) => void pickAddress(id)} onEscape={() => void pickAddress(null)} />}

          {view && (
            <div className="ent-tabs" style={{ top: TAB_TOP, height: PAGE_HEIGHT + 20 }} inert={!book}>
              <div className="ent-tab-strip" role="tablist">
                <button type="button" role="tab" aria-selected={tab === "all"} data-hotkey={voucher ? "v" : undefined} className={tab === "all" ? "ent-tab-on" : ""} onClick={() => void openTab("all")}>{voucher ? <HotkeyLabel text="Voucher" hotkey="v" /> : "Product & Slab"}</button>
                {def?.tabs.outstanding && <button type="button" role="tab" aria-selected={tab === "outstanding"} data-hotkey="o" className={tab === "outstanding" ? "ent-tab-on" : ""} onClick={() => void openTab("outstanding")}><HotkeyLabel text="Outstanding" hotkey="o" /></button>}
                <button type="button" role="tab" aria-selected={tab === "find"} data-hotkey="e" className={tab === "find" ? "ent-tab-on" : ""} onClick={() => void openTab("find")}><HotkeyLabel text="Find / Edit" hotkey="e" /></button>
                {def?.tabs.eway && <button type="button" role="tab" aria-selected={tab === "eway"} className={tab === "eway" ? "ent-tab-on" : ""} onClick={() => void openTab("eway")}>E-Way Bill</button>}
              </div>
              <div className="ent-page" style={{ height: PAGE_HEIGHT }} role="tabpanel">
                {tab === "all" && (
                  <>
                    {voucher ? (
                      <VoucherGrid
                        columns={voucherColumns}
                        lines={vlines}
                        singleRow={!journal && !book?.voucherMulti?.daybook && filledVoucherLines(vlines).length <= 1}
                        finishAfter={(row) => isRestored && !(vlines[row + 1]?.code > 0)}
                        debitOpen={journal || sideDbcode === 1}
                        creditOpen={journal || sideDbcode === 2}
                        style={{ left: 3, right: 6, top: PRODUCT_TOP, height: VOUCHER_HEIGHT }}
                        totalsStyle={{ left: 3, right: 6, top: PRODUCT_TOP + VOUCHER_HEIGHT + 2, height: 20 }}
                        addonItems={view.voucherAddon?.row ?? []}
                        onAddon={editVoucherAddon}
                        onAmountEnter={voucherAmountEntered}
                        onAccountDouble={landOnAccount}
                        onEnd={() => void endVoucherRows()}
                        accountText={accountText}
                        locked={locked || !book}
                        accountLocked={contra && restored !== null}
                        tools={tools}
                        totals={voucherTotals}
                        onCell={editVoucherCell}
                        onAccountText={(row, text) => { setAccountText({ row, text }); setVoucherRow(row); setHelpAt(0); if (helpKind !== "account") void openHelp("account"); }}
                        onAccountKeys={accountKeys}
                        onAccountFocus={accountFocus}
                        onAccountBlur={(event) => leaveField(event, "account")}
                        onDeleteRow={deleteVoucherRow}
                      />
                    ) : view.inventory ? (
                      <ProductGrid
                        amountOpen={itemAmountOpen}
                        onCellFocus={(row, key) => { cellWas.current[`${row}:${key}`] = lines[row]?.cells[key] ?? ""; }}
                        beforeLeave={stockLeave}
                        columns={shownColumns}
                        frozen={view.product.frozen}
                        lines={lines}
                        uoms={view.uoms}
                        totals={totals}
                        decimals={decimalsOf}
                        style={{ left: 3, right: 6, top: PRODUCT_TOP, height: PRODUCT_HEIGHT }}
                        totalsStyle={{ left: 3, right: 6, top: PRODUCT_TOP + PRODUCT_HEIGHT + 2, height: 20 }}
                        productText={productText}
                        locked={locked || !book}
                        onCell={editCell}
                        onProductText={(row, text) => { setProductText({ row, text }); setProductRow(row); setHelpAt(0); if (helpKind !== "product") void openHelp("product"); }}
                        onProductKeys={productKeys}
                        onRateStock={rateStock}
                        onRateFocus={setOnRate}
                        onProductFocus={productFocus}
                        onProductBlur={(event) => leaveField(event, "product")}
                        tools={tools}
                        onDeleteRow={(row) => void deleteRow(row)}
                        lastEditRow={restored !== null && restoredRows > 0 ? restoredRows - 1 : undefined}
                        onLeaveProducts={() => void endProducts()}
                      />
                    ) : (
                      <div className="ent-note" style={{ left: 3, right: 6, top: PRODUCT_TOP }}>This book takes no product rows: the amount goes in the slab grid&apos;s first row.</div>
                    )}
                    {view.slab && !voucher && (
                      <SideGrid
                        label="Slab"
                        searchKey="slab_desc"
                        fill
                        style={{ left: 3, top: SLAB_TOP, width: `calc(50% - ${3 + SIDE_GAP / 2}px)`, minWidth: slabWidth, height: SLAB_HEIGHT }}
                        columns={slabColumns}
                        cellClass={(row, column) => {
                          const item = slab[row];
                          const percOpen = !item?.itemWise && (item?.percEditable || (item?.options?.length ?? 0) > 0);
                          const amountOpen = !item?.itemWise && item?.amountEditable && !roundsOff(row) && !(row === 0 && view.inventory && item.calc !== "M");
                          return (column.key === "slab_perc" && !percOpen) || (column.key === "slab_amount" && !amountOpen) ? "ent-disabled" : column.editable ? "ent-open" : "";
                        }}
                        rows={slabGridRows}
                        cell={(row, column) => slabCell(row, column.key)}
                      />
                    )}
                    <SideGrid
                      label="Addon"
                      searchKey="addon_label"
                      fill
                      style={voucher ? { left: 3, top: VOUCHER_ADDON_TOP, width: view.grids.addon.reduce((sum, column) => sum + column.width, 0) + 24, height: SLAB_HEIGHT } : view.slab ? { left: `calc(50% + ${SIDE_GAP / 2}px)`, right: 6, top: SLAB_TOP, height: SLAB_HEIGHT } : { left: 3, right: 6, top: SLAB_TOP, height: SLAB_HEIGHT }}
                      columns={view.grids.addon}
                      rows={(voucher ? view.voucherAddon?.header ?? [] : party?.addon ?? []).map((item) => ({ addon_label: item.label, addon_input: addon[item.key] ?? (voucher ? item.value : "") }))}
                      empty={showParty ? "Choose the party: its addon fields show here" : undefined}
                      cell={(row, column) => {
                        const item = (voucher ? view.voucherAddon!.header : party!.addon)[row];
                        if (column.key !== "addon_input") return item.label;
                        const value = addon[item.key] ?? (voucher ? item.value : "");
                        const set = (next: string) => setAddon((current) => ({ ...current, [item.key]: next }));
                        const cellId = `a${row}`;
                        return <EntryCell kind={item.options ? "combo" : item.date ? "date" : "text"} optional={!item.compulsory || Boolean(item.date)} cellId={cellId} value={value} options={item.options} tools={tools} ariaLabel={item.label} onChange={set} onEnter={() => nextSideCell("Addon", cellId)} />;
                      }}
                    />
                  </>
                )}
                {tab === "outstanding" && (
                  <>
                    <SideGrid
                      label="Outstanding"
                      style={{ left: 11, top: 6, width: view.grids.outstanding.reduce((sum, column) => sum + column.width, 0) + 20, height: ROW * 10 + 22 }}
                      columns={view.grids.outstanding}
                      rows={party?.outstanding ?? []}
                      anyColumn sortable filterable
                      onF5={finishSetoff}
                      cellClass={(_row, column) => (column.key === "out_setoff" ? "ent-open ent-always-tools" : column.editable ? "ent-open" : "")}
                      totals={outstandingTotals}
                      empty={party ? (voucher ? "No pending entries for this account" : "No pending entries for this party") : voucher ? "Choose the account row first" : "Choose the party first"}
                      cell={(row, column) => {
                        const given = party?.outstanding[row]?.[column.key] ?? "";
                        if (column.key === "out_setoff" && !book?.setoff) return amountText(setoff[row] ?? "", column.decimals);
                        if (column.key !== "out_setoff") return column.align === "R" && column.decimals > 0 ? amountText(given, column.decimals) : given;
                        const cellId = `os${row}`;
                        return (
                          <EntryCell
                            kind="number" clearable cellId={cellId} value={setoff[row] ?? ""} align="right" rules={SETOFF_RULES} tools={tools} ariaLabel="Setoff amount"
                            onChange={(next) => setSetoff((current) => ({ ...current, [row]: next }))}
                            onKeys={(event) => { if (event.key === "F4" || event.key === "F8") { event.preventDefault(); fillSetoff(row); return true; } if (event.key === "F5") { event.preventDefault(); finishSetoff(); return true; } if (event.key === "Tab" && !event.shiftKey) { event.preventDefault(); void checkSetoff(row).then((ok) => { if (ok) nextSetoffCell(cellId); }); return true; } return false; }}
                            onEnter={() => void checkSetoff(row).then((ok) => { if (ok) nextSetoffCell(cellId); })}
                          />
                        );
                      }}
                      below={(
                        <>
                          <label className="ent-total-label">Entry Amount<output>{amountText(fixed(entryAmount, 2), 2)}</output></label>
                          <label className="ent-total-label">O/s Bal.<output>{amountText(fixed(entryAmount - outstandingSetoff, 2), 2)}</output></label>
                        </>
                      )}
                    />
                  </>
                )}
                {(tab === "find" || preview) && <FindList preview={(findMode && previewAll[findMode]) || preview} mode={findMode} onMode={(next) => void chooseFindMode(next)} outstanding={voucher} ticked={ticked} onTick={tickEntry} style={{ left: 3, right: 3, top: 3, bottom: 3, ...(tab === "find" ? {} : { display: "none" }) }} onOpen={(row) => void openEntry(row)} />}
                {tab === "eway" && (() => { const needed = ewayDue() || (isRestored && ewayControls.some((item) => item.type === "TB" && (values[item.name] ?? "").trim() !== "")); return <div className={needed ? "ent-eway" : "ent-eway ent-eway-off"} inert={!needed} title={needed ? undefined : "E-Way Bill is not required for this entry"}>{ewayControls.flatMap(control)}</div>; })()}
              </div>
            </div>
          )}

          {view && (
            <div className="ent-foot" inert={!book}>
              {(() => {
                // "TDS Amt.: 178.00": the one amount of the TDS auto journal - the typed TDS Amount on a new entry, the saved journal's on an opened one.
                // A new entry has the TDS Amount box itself, so the label is only for an opened one (else the amount shows twice).
                const amount = isRestored ? restoredTds : "";
                return toNumber(amount) > 0 ? <span className="ent-against ent-against-book" style={{ left: footControls.find((item) => item.name === "cmb_rev_entry")?.label_.left ?? 892, top: FOOT_TOP + 30, width: 188 }} title="The TDS amount of the entry's auto journal (TDS JV)">{`TDS Amt.: ${amountText(fixed(toNumber(amount), 2), 2)}`}</span> : null;
              })()}
              {against && (book ?? ghost)?.entryFor === "DrCr" && (
                <>
                  <span className="ent-against ent-against-nature" style={{ left: 873, top: FOOT_TOP, width: 188 }} title="Nature of the entry">{against.nature}</span>
                  <span className="ent-against ent-against-book" style={{ left: 873, top: FOOT_TOP + 20, width: 188 }} title="The book the entry is against">{against.book}</span>
                </>
              )}
              <span className="ent-label ent-final-label" style={{ left: 2, top: FOOT_TOP, width: 130 }}>Entry Final Amt.:</span>
              <output className="ent-final" style={{ left: 138, top: FOOT_TOP, width: 101 }} aria-label="Entry final amount">{amountText(String(voucher ? voucherTotals.final : slabResult.final), 2) || "0.00"}</output>
              {footControls.flatMap(control)}
            </div>
          )}
        </div>
      </div>

      <div className="ent-toolbar" role="toolbar" aria-label="Entry buttons">
        <button type="button" className="mp-btn mp-btn-green" data-hotkey="s" aria-keyshortcuts="Alt+S" disabled={!canSave} title="Save the invoice (checked on the server; written only when saving is switched on)" onClick={() => void saveEntry()}><Icon name="save" /><HotkeyLabel text="Save" hotkey="s" /></button>
        <button type="button" className="mp-btn mp-btn-blue" data-hotkey="c" aria-keyshortcuts="Alt+C" onClick={() => void cancelEntry()}><Icon name="cancel" /><HotkeyLabel text="Cancel" hotkey="c" /></button>
        <button type="button" className="mp-btn mp-btn-blue" data-hotkey="d" aria-keyshortcuts="Alt+D" disabled={!isRestored} title="Delete the opened invoice" onClick={() => void deleteEntry()}><Icon name="clear" /><HotkeyLabel text="Delete" hotkey="d" /></button>
        <button type="button" className="mp-btn mp-btn-blue" data-hotkey="p" aria-keyshortcuts="Alt+P" disabled={!isRestored && ticked.length === 0} title="Print the opened invoice, or the entries ticked by Range: Standard (bill preview with a Print button) or Special (later)" onClick={() => setPrinting(true)}><Icon name="print" /><HotkeyLabel text="Print" hotkey="p" /></button>
        <button type="button" className="mp-btn mp-btn-blue" data-hotkey="r" aria-keyshortcuts="Alt+R" title="Read the helps, the addon lists and the Find / Edit list again" onClick={() => { setAccountHelp(null); setProductHelp(null); setPreview(null); setPreviewAll({ fields: null, products: null }); setFindMode(""); setHelpKind(null); void refreshAddonLists(); if (tab === "find") void openTab("find"); }}><Icon name="refresh" /><HotkeyLabel text="Refresh" hotkey="r" /></button>
        <button type="button" className="mp-btn mp-btn-blue" data-hotkey="g" aria-keyshortcuts="Alt+G" disabled={!book || voucher} title="Range print: tick the entries from a number to a number of the series, then Print" onClick={() => setRangeOpen(true)}><Icon name="list" /><HotkeyLabel text="Range" hotkey="g" /></button>
        {def?.buttons.upload && <button type="button" className="mp-btn mp-btn-blue" data-hotkey="u" aria-keyshortcuts="Alt+U" disabled={!isRestored} title="Keep up to five JPEG / PDF files with this entry (written when the entry is saved)" onClick={() => void uploadDocuments()}><Icon name="image" /><HotkeyLabel text="Upload Document" hotkey="u" /></button>}
        {def?.buttons.einvoice && <button type="button" className="mp-btn mp-btn-blue" disabled={!isRestored} title="E-invoice is not ported yet" onClick={notPorted("E-invoice")}><Icon name="export" />E-Invoice</button>}
        {def?.buttons.log && <button type="button" className="mp-btn mp-btn-blue" data-hotkey="l" aria-keyshortcuts="Alt+L" disabled={!isRestored} title="The entry's log: every save of it, side by side" onClick={() => void showLog()}><Icon name="log" /><HotkeyLabel text="Log" hotkey="l" /></button>}
        <div className="ent-status" aria-live="polite">
          {busy && <span className="mp-busy">{busy}…</span>}
          {onRate && <span title="F7 in the Rate cell shows this product's rate in every book and party, newest first"><b>F7</b>-Product Rate</span>}
          {book && <span>{def?.statusHead} · {register?.text} · {voucher ? values.cmb_side : book.entryFor}{book.slab && !voucher ? ` · ${book.taxGroup === "G" ? "CGST" : book.taxGroup === "I" ? "IGST" : "VAT"}` : ""}{isRestored ? " · Edit" : ""}</span>}
          {warnings.map((warning) => <span key={warning} className="ent-warning" title={warning}>⚠ {warning}</span>)}
        </div>
        <button type="button" className="mp-btn mp-btn-red" data-hotkey="q" aria-keyshortcuts="Alt+Q" onClick={() => void quit()}><Icon name="quit" /><HotkeyLabel text="Quit" hotkey="q" /></button>
      </div>
      {printing && (restored !== null || ticked.length > 0) && register && (
        <InvoicePrint
          docNo={printNumber()}
          onClose={() => setPrinting(false)}
          load={loadBills}
        />
      )}
      {returnsAsk && <ReturnsPanel choices={returnsAsk.choices} onDone={returnsAsk.resolve} />}
      {rangeOpen && <RangePanel series={(values.cmb_series ?? "").trim()} onOk={(from, to) => void applyRange(from, to)} onQuit={() => setRangeOpen(false)} />}
      {docsAsk && <UploadDocuments initial={docsAsk.initial} onOk={(rows) => { docsAsk.resolve(rows); setDocsAsk(null); }} onQuit={() => { docsAsk.resolve(null); setDocsAsk(null); }} fetchFile={fetchStoredDocument} say={(message) => void say(message, "Upload Document")} />}
      {tools.popups}
    </div>
  );
}
