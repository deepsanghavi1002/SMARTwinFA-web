"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useStartupSelection } from "../startup/StartupGate";
import { parseDesktopDate } from "../../lib/master-program/legacy";
import { fixed, toNumber } from "../../lib/entry/calc";
import type { BookScreen, EntryOption, HelpList as HelpData, InvoiceControl, InvoiceDefinition, PartyDetails, ProductChoice, RestoredEntry, SeriesDefaults, SlabRow } from "../../lib/entry/types";
import { entryCall } from "./api";
import { useEditorTools } from "../grid/EditorTools";
import { DateField } from "../grid/DateField";
import { HelpList } from "../grid/HelpList";
import { useHelpView } from "../grid/useHelpView";
import { useDraggable } from "../grid/useDraggable";
import { messageBox } from "../ui/MessageBox";
import { HotkeyLabel, useAltHotkeys } from "../ui/hotkeys";
import { Icon } from "../ui/Icon";
import { SearchCombo } from "../ui/SearchCombo";
import { FindList } from "./FindList";
import { amountText, helpCell } from "./format";
import { chooseProduct, filledLines, lineTotals, recalcLine, slabFromLines } from "./lines";
import type { Line } from "./lines";
import { ProductGrid } from "./ProductGrid";
import { EntryCell, focusEntryCell } from "./EntryCell";
import { properHeading } from "../../lib/master-program/heading";
import { SideGrid } from "./SideGrid";

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
type BookReply = { book: BookScreen & { asksTaxGroup: boolean }; warnings: string[] };
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
const HELP_ROWS = 12;
/** A slab %: up to three places, never below nought; a slab amount: two places, a round-off or add / less may be negative. */
const PERCENT_RULES = { decimals: 3, positiveOnly: true, rangeFrom: 0, rangeUpto: 0 };
const AMOUNT_RULES = { decimals: 2, positiveOnly: false, rangeFrom: 0, rangeUpto: 0 };
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
  const right = (top: number) => ({ label: { right: PARTY_RIGHT + PARTY_WIDTH + 6, left: "auto", top, width: 74, textAlign: "left" as const }, box: { right: PARTY_RIGHT, left: "auto", top, width: PARTY_WIDTH } });
  switch (item.name) {
    case "tbx_partyname": return right(item.box.top);
    case "dtp_entrydate": return { label: { left: 412, top: 50, width: 86, textAlign: "right" }, box: { left: 500, top: 50, width: 112 } };
    case "tbx_entryno": return { label: { left: 412, top: 72, width: 86, textAlign: "right" }, box: { left: 500, top: 72, width: 88 } };
    default: return null;
  }
}

export function Entry({ entryName, menuShortName, title, onClose }: { entryName: string; menuShortName: string; title: string; onClose: () => void }) {
  const selection = useStartupSelection();
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
  const [tab, setTab] = useState<Tab>("all");
  const [party, setParty] = useState<PartyDetails | null>(null);
  const [addon, setAddon] = useState<Record<number, string>>({});
  const [accountHelp, setAccountHelp] = useState<HelpData | null>(null);
  const [productHelp, setProductHelp] = useState<HelpData | null>(null);
  const [helpKind, setHelpKind] = useState<HelpKind | null>(null);
  const [helpAt, setHelpAt] = useState(0);
  const [productText, setProductText] = useState<{ row: number; text: string } | null>(null);
  /** The product row whose Product cell the product help belongs to. */
  const [productRow, setProductRow] = useState<number | null>(null);
  const [preview, setPreview] = useState<HelpData | null>(null);
  /** The entry opened from Find / Edit (its unique key), or null for a new entry. */
  const [restored, setRestored] = useState<number | null>(null);
  const screenRef = useRef<HTMLDivElement>(null);
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
  const blankEntry = useCallback(() => {
    setSlab([]);
    setLines([]);
    setParty(null);
    setAddon({});
    setHelpKind(null);
    setProductText(null);
    setPreview(null);
    setRestored(null);
    setTab("all");
  }, []);

  /** The register's book (for a tax group: Fill_Slab_and_Addon again with CGST, IGST or VAT). */
  const loadBook = useCallback(async (option: EntryOption, taxGroup?: BookScreen["taxGroup"]): Promise<BookReply> => {
    let body = await call<BookReply>("book", { firstCombo: option, ...(taxGroup ? { taxGroup } : {}) });
    if (!taxGroup && body.book.asksTaxGroup) {
      // "CGST [Yes] / IGST [No] / VAT [Cancel] Entry...": the desktop asks before the slab grid is filled.
      const answer = await messageBox.ask("CGST [Yes] / IGST [No] / VAT [Cancel] Entry...", "GST Entry Type", ["Yes", "No", "Cancel"], { defaultButton: "Yes" });
      body = await call<BookReply>("book", { firstCombo: option, taxGroup: answer === "Yes" ? "G" : answer === "No" ? "I" : "V" });
    }
    return body;
  }, [call]);

  // ---- Cmb_FirstCombo_Leave: the register sets the screen up
  const chooseRegister = useCallback(async (option: EntryOption) => {
    setRegister(option);
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
      initial.dtp_date = next.defaults.date;
      initial.tbx_number = next.defaults.number;
      for (const name of ["dtp_chlndate", "dtp_entrydate", "dtp_ewaydate"]) if (next.controls.some((control) => control.name === name)) initial[name] = next.defaults.date;
      setValues(initial);
      setWarnings([...(def?.unsupported ?? []), ...next.warnings, ...body.warnings]);
      Promise.resolve().then(() => screenRef.current?.querySelector<HTMLElement>(".ent-head [data-first] input, .ent-head [data-first] button")?.focus());
    } catch (error) {
      setBook(null);
      await failed(error);
    } finally {
      setBusy("");
    }
  }, [loadBook, blankEntry, def, failed]);

  // ---- Cmb_Series_Leave: another series has its own last date and number
  const chooseSeries = useCallback(async (series: string) => {
    setValues((current) => ({ ...current, cmb_series: series }));
    setPreview(null);
    if (!register) return;
    try {
      const body = await call<{ defaults: SeriesDefaults }>("series", { firstCombo: register, series });
      setValues((current) => ({ ...current, dtp_date: body.defaults.date, tbx_number: body.defaults.number, dtp_chlndate: current.dtp_chlndate !== undefined ? body.defaults.date : current.dtp_chlndate }));
    } catch (error) {
      await failed(error);
    }
  }, [call, register, failed]);

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

  /** What the field the help belongs to has typed: the help keeps the entries that start with it. */
  const typedName = values.tbx_partyname ?? "";
  const typed = helpKind === "account" ? (party?.name === typedName ? "" : typedName) : helpKind === "product" && productText?.row === productRow ? productText.text : "";
  const typedHelp = useMemo((): HelpData | null => {
    const help = helpKind === "account" ? accountHelp : helpKind === "product" ? productHelp : null;
    if (!help || !helpKind) return null;
    const main = HELP_MAIN[helpKind];
    // The main column's heading in capitals, the others in Proper Case.
    const columns = help.columns.map((column) => ({ ...column, caption: column.key === main ? column.caption.toUpperCase() : properHeading(column.caption) }));
    const needle = typed.trim().toUpperCase();
    if (needle === "") return { ...help, columns };
    const rows = help.rows.filter((row) => (row[main] ?? "").trim().toUpperCase().startsWith(needle));
    return { ...help, columns, rows, total: `${help.total} · ${rows.length} found` };
  }, [helpKind, accountHelp, productHelp, typed]);
  // Each help keeps its own column filters and sort (useHelpView); the list on screen is the one Enter takes from.
  const accountView = useHelpView(helpKind === "account" ? typedHelp : null, helpCell);
  const productView = useHelpView(helpKind === "product" ? typedHelp : null, helpCell);
  const helpView = helpKind === "account" ? accountView : productView;
  const shownHelp = helpView.view;

  /** The field a help belongs to: the party box, or the Product cell it opened from. */
  const focusHelpField = useCallback((kind: HelpKind | null) => {
    if (kind === "account") partyRef.current?.focus();
    else if (kind === "product" && productRow !== null) focusEntryCell(formRef.current, `${productRow}:prod_key`);
  }, [productRow]);
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

  // ---- Tbx_PartyName_Leave: address, addons, pending bills, and the tax group the party's state gives
  const choosePartyRow = useCallback(async (row: Readonly<Record<string, string>> | undefined) => {
    if (!row || !register || !book) return;
    setHelpKind(null);
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
      setParty(next);
      setValues((current) => ({ ...current, tbx_partyname: next.name, tbx_credit_days: current.tbx_credit_days !== undefined ? next.creditDays : current.tbx_credit_days }));
      setAddon(Object.fromEntries(next.addon.map((item) => [item.key, item.value])));
      setTimeout(() => { if (formRef.current && partyRef.current) moveOn(formRef.current, partyRef.current); }, 0);
    } catch (error) {
      await failed(error);
    } finally {
      setBusy("");
    }
  }, [register, book, call, values.dtp_date, lines, loadBook, say, failed]);

  const partyKeys = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (helpKeys(event, "account", (row) => void choosePartyRow(row))) return;
    if (event.key === "Enter" && formRef.current) { event.preventDefault(); setHelpKind(null); moveOn(formRef.current, event.currentTarget); }
  };
  /** The party box got the keyboard: its help shows (on the party already chosen); the keyboard stays in the box. */
  const partyFocus = () => {
    const at = accountHelp?.rows.findIndex((row) => row.NAME === party?.name) ?? -1;
    setHelpAt(at >= 0 ? at : 0);
    void openHelp("account");
  };

  // ---- The product rows (C1dg_Inputdata): Product_Selection and the recalculation after each cell
  const productColumns = useMemo(() => book?.product.columns.filter((column) => column.visible) ?? [], [book]);
  const context = useMemo(() => (book ? { book, columns: productColumns } : null), [book, productColumns]);

  const chooseProductRow = useCallback(async (row: number, helpRow: Readonly<Record<string, string>> | undefined) => {
    if (!helpRow || !register || !context) return;
    setHelpKind(null);
    setBusy("Product");
    try {
      const body = await call<{ product: ProductChoice }>("product", { firstCombo: register, prodKey: Number(helpRow.prod_key), acCode: party?.code ?? 0, date: values.dtp_date ?? "" });
      const product = { ...body.product, stock1: helpRow.stock_1 ?? body.product.stock1, stock2: helpRow.stock_2 ?? body.product.stock2 };
      setLines((current) => {
        const copy = [...current];
        while (copy.length <= row) copy.push({ cells: {}, product: null });
        copy[row] = chooseProduct(copy[row], product, context, slab);
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
  }, [register, context, call, party, values.dtp_date, slab, productColumns, failed]);

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
    if (focusFirstCell(form?.querySelector("[aria-label=Slab]")) || focusFirstCell(form?.querySelector("[aria-label=Addon]"))) return;
    form?.querySelector<HTMLElement>("#ent-tbx_narration")?.focus();
  };

  const productKeys = (event: ReactKeyboardEvent<HTMLInputElement>, row: number): boolean => {
    if (event.key === "F5") { event.preventDefault(); void endProducts(); return true; }
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
    void openHelp("product");
  };

  /** A cell to put the keyboard on once the product rows are drawn again (the next cell after a product is taken). */
  const focusAfterDraw = useRef<string | null>(null);
  useEffect(() => {
    if (focusAfterDraw.current && focusEntryCell(formRef.current, focusAfterDraw.current)) focusAfterDraw.current = null;
  }, [lines]);

  const editCell = useCallback((row: number, key: string, value: string) => {
    if (!context) return;
    setLines((current) => current.map((line, index) => (index === row ? recalcLine({ ...line, cells: { ...line.cells, [key]: value } }, key, context, slab) : line)));
  }, [context, slab]);

  const deleteRow = useCallback(async (row: number) => {
    if (!lines[row]?.product) return;
    const answer = await messageBox.ask(`Remove row ${row + 1} (${lines[row].cells.prod_key ?? ""})?`, "Delete Row", ["Yes", "No"], { defaultButton: "No" });
    if (answer === "Yes") setLines((current) => current.filter((_line, index) => index !== row));
  }, [lines]);

  // ---- Slab_RunTotal: from the product rows and the slab rows' own % / amounts
  const slabResult = useMemo(() => (book ? slabFromLines(book, slab, lines) : { amounts: [], runTotals: [], final: 0 }), [book, slab, lines]);
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
  }, [preview, register, call, values.cmb_series, failed]);

  // ---- C1Help_EntryPreview_DoubleClick → Restore_Entry: the entry opens, ready to edit
  const openEntry = useCallback(async (row: Readonly<Record<string, string>>) => {
    if (!register || !book) return;
    if (String(row.name ?? "").toLowerCase().includes("cancel invoice")) { await say("A cancelled invoice number opens for editing on the desktop only (not ported yet).", "Entry"); return; }
    if (filledLines(lines).length > 0 && restored === null) {
      const answer = await messageBox.ask("The entry on screen is not saved. Open the chosen entry instead?", "Find / Edit", ["Yes", "No"], { defaultButton: "No" });
      if (answer !== "Yes") return;
    }
    setBusy("Opening the entry");
    try {
      const { entry } = await call<{ entry: Restored }>("restore", { firstCombo: register, uniqueKey: Number(row.unique_key) });
      let screenBook = book;
      if (book.slab && entry.taxGroup !== book.taxGroup) screenBook = (await loadBook(register, entry.taxGroup)).book;
      // Header and foot: a list box's saved key shows as its text.
      const next: Record<string, string> = {};
      for (const control of screenBook.controls) {
        const saved = entry.values[control.name];
        if (saved === undefined) { next[control.name] = control.initial; continue; }
        const option = control.type === "CB" && !control.options.some((candidate) => candidate.text === saved) ? control.options.find((candidate) => candidate.value === saved) : undefined;
        next[control.name] = option ? option.text : saved;
      }
      let partyDetails: PartyDetails | null = null;
      if (entry.partyCode > 0 && screenBook.party) partyDetails = (await call<{ party: PartyDetails }>("party", { firstCombo: register, code: entry.partyCode, date: next.dtp_date ?? "" })).party;
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
        return { cells, product: line.product };
      });
      blankEntry();
      setBook(screenBook);
      setSlab(slabRows);
      setValues(next);
      setParty(partyDetails);
      setAddon({ ...Object.fromEntries((partyDetails?.addon ?? []).map((item) => [item.key, item.value])), ...entry.addon });
      setLines(restoredLines);
      setRestored(entry.uniqueKey);
    } catch (error) {
      await failed(error);
    } finally {
      setBusy("");
    }
  }, [register, book, lines, restored, call, loadBook, blankEntry, say, failed]);

  // Enter moves to the next box of the header, as the desktop's KeyPreview did (the grids, the helps and the party box,
  // whose help is always showing, move on their own).
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const enter = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.defaultPrevented) return;
      const target = event.target as HTMLElement;
      if (target.tagName === "TEXTAREA" || target.id === "ent-tbx_partyname" || target.closest(".mp-combo-list, .ent-grid, .ent-find, .mp-help")) return;
      if (moveOn(form, target)) event.preventDefault();
    };
    form.addEventListener("keydown", enter);
    return () => form.removeEventListener("keydown", enter);
  }, []);

  const quit = async () => {
    if (book && (party || filledLines(lines).length > 0 || (values.tbx_narration ?? "") !== "")) {
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
    blankEntry();
    setBook(null);
    setValues({});
    setAccountHelp(null);
  };
  // Save opens once series, date and number are filled (or an entry is open from Find / Edit); Delete, Print, Range,
  // Upload Document, E-Invoice and Log only for an entry opened from Find / Edit. Cancel, Refresh and Quit always.
  const isRestored = restored !== null;
  const canSave = Boolean(book) && (isRestored || ((values.cmb_series ?? "").trim() !== "" && (values.dtp_date ?? "").trim() !== "" && (values.tbx_number ?? "").trim() !== ""));
  const notPorted = (what: string) => () => void say(`${what} is not ported to the web yet. Product entry and opening entries are done; saving comes next.`, "Entry");

  /** Credit days run 0 to 365, or 366 when the accounting year takes in a 29 February. */
  const maxCreditDays = yearHasLeapDay(yearStart, yearEnd) ? 366 : 365;
  const control = (item: InvoiceControl) => {
    const value = values[item.name] ?? "";
    const set = (next: string) => setValues((current) => ({ ...current, [item.name]: next }));
    const shift = item.place === "B" ? DESKTOP_FOOT_TOP - FOOT_TOP : 0;
    const place = item.place === "T" ? headerPlace(item) : null;
    const labelStyle: CSSProperties = place?.label ?? { left: item.label_.left, top: item.label_.top - shift, width: item.label_.width, height: item.label_.height, textAlign: item.label_.right ? "right" : "left" };
    const boxStyle: CSSProperties = place?.box ?? { left: item.box.left, top: item.box.top - shift, width: item.box.width, ...(item.name === "tbx_narration" ? { height: Math.min(item.box.height, FORM_HEIGHT - 2 - (item.box.top - shift)) } : {}) };
    return [
      <label key={`${item.name}-label`} className={`ent-label ${item.compulsory ? "ent-compulsory" : ""}`} style={labelStyle} title={item.tooltip || undefined} htmlFor={`ent-${item.name}`}>{item.label}</label>,
      <span key={item.name} className={`ent-box ent-box-${item.type}`} style={boxStyle} {...(item.name === "cmb_series" ? { "data-first": "" } : {})}>
        {item.type === "CB" ? (
          item.name === "cmb_series" ? (
            <SearchCombo ariaLabel={item.label} options={item.options} value={item.options.find((option) => option.text === value) ?? null} onChoose={(option) => void chooseSeries(option.text)} />
          ) : (
            <select id={`ent-${item.name}`} className="mp-control" aria-label={item.label} value={value} onChange={(event) => set(event.target.value)}>
              {!item.options.some((option) => option.text === value) && value !== "" && <option value={value}>{value}</option>}
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

  const headControls = book?.controls.filter((item) => item.place === "T") ?? [];
  const footControls = book?.controls.filter((item) => item.place === "B") ?? [];
  const ewayControls = book?.controls.filter((item) => item.place === "E" && (def?.ewayDates || !["dtp_ewaydate", "tbx_ewayvalid"].includes(item.name))) ?? [];
  const showParty = Boolean(book?.party && headControls.some((item) => item.name === "tbx_partyname"));
  // The Particulars column 30% wider than the setup gives it; the slab grid grows by as much.
  const slabColumns = (book?.grids.slab ?? []).map((column) => (column.key === "slab_desc" ? { ...column, width: Math.round(column.width * 1.3) } : column));
  const slabWidth = slabColumns.reduce((sum, column) => sum + column.width, 0) + 20;
  const slabGridRows = slab.map((row, index) => ({
    slab_order: String(row.order), slab_mathoper: row.sign, slab_desc: row.desc, slab_perc: row.perc,
    slab_amount: fixed(slabResult.amounts[index] ?? 0, 2), s_lastot: fixed(slabResult.runTotals[index] ?? 0, 2),
  }));
  /**
   * Enter in the slab or addon grid: the next open cell (row by row, so the end of a row goes to
   * the next row); after the grid's last one, the addon grid (from the slab) or the narration.
   */
  const nextSideCell = (grid: "Slab" | "Addon", cellId: string) => {
    const form = formRef.current;
    const box = form?.querySelector(`[aria-label=${grid}]`);
    const cells = [...(box?.querySelectorAll<HTMLElement>("[data-cell], [data-cell-wrap]") ?? [])];
    const at = cells.findIndex((cell) => (cell.getAttribute("data-cell") ?? cell.getAttribute("data-cell-wrap")) === cellId);
    const next = cells[at + 1];
    if (next) { focusEntryCell(box, next.getAttribute("data-cell") ?? next.getAttribute("data-cell-wrap") ?? ""); return; }
    if (grid === "Slab" && focusFirstCell(form?.querySelector("[aria-label=Addon]"))) return;
    form?.querySelector<HTMLElement>("#ent-tbx_narration")?.focus();
  };
  /** The last round-off row works its amount out (slab_calc A, or B with no decimals): nothing to type. */
  const roundsOff = (row: number) => { const item = slab[row]; return Boolean(item) && row === slab.length - 1 && item.mathOp === "U" && (item.calc === "A" || (item.calc === "B" && item.roundPlaces === 0)); };
  /** A slab row's own % is typed (a % row) or chosen (a tax row); its amount is typed where the row allows it. */
  const slabCell = (row: number, key: string) => {
    const item = slab[row];
    const shown = slabGridRows[row];
    const cellId = `s${row}:${key}`;
    const onEnter = () => nextSideCell("Slab", cellId);
    if (key === "slab_perc" && !item.itemWise && item.options && item.options.length > 0) {
      return <EntryCell kind="combo" cellId={cellId} value={item.perc} options={item.options} tools={tools} ariaLabel={`${item.desc} tax`} onChange={(perc) => setSlabRow(row, { perc })} onEnter={onEnter} />;
    }
    if (key === "slab_perc" && item.percEditable && !item.itemWise) {
      return <EntryCell kind="number" cellId={cellId} value={item.perc} align="right" rules={PERCENT_RULES} tools={tools} ariaLabel={`${item.desc} %`} onChange={(perc) => setSlabRow(row, { perc })} onEnter={onEnter} />;
    }
    const typedAmount = item.amountEditable && !item.itemWise && !roundsOff(row) && !(row === 0 && book?.inventory && item.calc !== "M") && !(toNumber(item.perc) > 0 && item.percEditable);
    if (key === "slab_amount" && typedAmount) {
      return <EntryCell kind="number" cellId={cellId} value={item.amount === "0.00" ? "" : item.amount} align="right" rules={AMOUNT_RULES} tools={tools} ariaLabel={`${item.desc} amount`} onChange={(amount) => setSlabRow(row, { amount })} onEnter={onEnter} />;
    }
    const value = shown[key as keyof typeof shown] ?? "";
    return key === "slab_amount" || key === "s_lastot" ? amountText(value, 2) : value;
  };

  const helpStyle = (kind: HelpKind): CSSProperties => ({
    ...(kind === "account" ? { top: 28, right: PARTY_RIGHT, left: "auto", bottom: "auto" } : { left: 40, top: TAB_TOP + 60, right: "auto", bottom: "auto" }),
    maxHeight: "none", maxWidth: "calc(100% - 16px)", zIndex: 30,
    ...((kind === "account" ? accountDrag.style : productDrag.style) ?? {}),
  });

  if (fatal) return <div className="mp-screen"><p className="mp-error">{fatal}</p><button type="button" className="mp-btn mp-btn-red" onClick={onClose}><Icon name="quit" />Quit</button></div>;

  return (
    <div ref={screenRef} className={`mp-screen ent-screen ${locked && def ? "mp-locked" : ""}`} role="region" aria-label={def?.caption || title}>
      <div className="ent-scroll">
        <div ref={formRef} className="ent-form" style={{ height: FORM_HEIGHT }} role="group" aria-label={def?.caption || title}>
          <div className="ent-head" role="group" aria-label={`${def?.caption || title} header`}>
            <label className="ent-label ent-register-label" style={{ left: 2, top: 6, width: 84 }} htmlFor="ent-register">{def?.firstCombo.label ?? "Register"}</label>
            <span className="ent-box ent-register" style={{ left: 86, top: 6, width: 317 }} id="ent-register">
              <SearchCombo
                ariaLabel={def?.firstCombo.label ?? "Register"}
                options={def?.firstCombo.options ?? []}
                value={register}
                reselect
                disabled={locked || !def || Boolean(book) || Boolean(busy && busy !== "")}
                focus={!locked && !book && Boolean(def)}
                onChoose={(option) => void chooseRegister(option)}
              />
            </span>
            {book && <span className="ent-side" style={{ left: 406, top: 6 }} title="Book posting side">{book.side}</span>}
            {book?.balance && <span className="ent-balance" style={{ left: 238, top: 28 }} title="Book balance as on the last date of the year">{book.balance}</span>}
            {headControls.flatMap(control)}
            {book && headControls.some((item) => item.name === "dtp_date") && <span className="ent-day" style={{ left: 204, top: 50 }}>{dayOf(values.dtp_date ?? "")}</span>}
            {book && headControls.some((item) => item.name === "dtp_chlndate") && <span className="ent-day" style={{ left: 204, top: 72 }}>{dayOf(values.dtp_chlndate ?? "")}</span>}
            {book && headControls.some((item) => item.name === "dtp_entrydate") && <span className="ent-day" style={{ left: 616, top: 50 }}>{dayOf(values.dtp_entrydate ?? "")}</span>}
            {showParty && (
              <>
                <span className="ent-label" style={{ right: PARTY_RIGHT + PARTY_WIDTH + 6, top: 28, width: 74 }}>Address</span>
                <ul className="ent-address" style={{ right: PARTY_RIGHT, top: 28, width: PARTY_WIDTH, height: TAB_TOP - 32 }} aria-label="Party address" title="Closing balance, address, telephone, GST number, opening balance, credit days and limit">
                  {(party?.address ?? []).map((line, index) => <li key={index}>{line}</li>)}
                </ul>
              </>
            )}
            {isRestored && <span className="ent-mode" style={{ left: 406, top: 28 }} title="An entry opened from Find / Edit">EDIT</span>}
          </div>

          {helpKind && shownHelp && (
            <div className="ent-help-host" onBlur={leaveHelp}>
            <HelpList
              help={shownHelp}
              focusRow={Math.min(helpAt, shownHelp.rows.length - 1)}
              onFocusRow={setHelpAt}
              onChoose={(index) => (helpKind === "account" ? void choosePartyRow(shownHelp.rows[index]) : productRow !== null && void chooseProductRow(productRow, shownHelp.rows[index]))}
              searchKey={HELP_MAIN[helpKind]}
              onClose={() => closeHelp()}
              onEscape={() => focusHelpField(helpKind)}
              onKey={(event) => { if (helpKind === "product" && event.key === "F5") { event.preventDefault(); void endProducts(); return true; } return false; }}
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
              shown={HELP_ROWS}
            />
            </div>
          )}

          {book && (
            <div className="ent-tabs" style={{ top: TAB_TOP, height: PAGE_HEIGHT + 20 }}>
              <div className="ent-tab-strip" role="tablist">
                <button type="button" role="tab" aria-selected={tab === "all"} className={tab === "all" ? "ent-tab-on" : ""} onClick={() => void openTab("all")}>Product &amp; Slab</button>
                {def?.tabs.outstanding && <button type="button" role="tab" aria-selected={tab === "outstanding"} className={tab === "outstanding" ? "ent-tab-on" : ""} onClick={() => void openTab("outstanding")}>Outstanding</button>}
                <button type="button" role="tab" aria-selected={tab === "find"} className={tab === "find" ? "ent-tab-on" : ""} onClick={() => void openTab("find")}>Find / Edit</button>
                {def?.tabs.eway && <button type="button" role="tab" aria-selected={tab === "eway"} className={tab === "eway" ? "ent-tab-on" : ""} onClick={() => void openTab("eway")}>E-Way Bill</button>}
              </div>
              <div className="ent-page" style={{ height: PAGE_HEIGHT }} role="tabpanel">
                {tab === "all" && (
                  <>
                    {book.inventory ? (
                      <ProductGrid
                        columns={productColumns}
                        frozen={book.product.frozen}
                        lines={lines}
                        uoms={book.uoms}
                        totals={totals}
                        decimals={decimalsOf}
                        style={{ left: 3, right: 6, top: PRODUCT_TOP, height: PRODUCT_HEIGHT }}
                        totalsStyle={{ left: 3, right: 6, top: PRODUCT_TOP + PRODUCT_HEIGHT + 2, height: 20 }}
                        productText={productText}
                        locked={locked}
                        onCell={editCell}
                        onProductText={(row, text) => { setProductText({ row, text }); setProductRow(row); setHelpAt(0); if (helpKind !== "product") void openHelp("product"); }}
                        onProductKeys={productKeys}
                        onProductFocus={productFocus}
                        onProductBlur={(event) => leaveField(event, "product")}
                        tools={tools}
                        onDeleteRow={(row) => void deleteRow(row)}
                      />
                    ) : (
                      <div className="ent-note" style={{ left: 3, right: 6, top: PRODUCT_TOP }}>This book takes no product rows: the amount goes in the slab grid&apos;s first row.</div>
                    )}
                    {book.slab && (
                      <SideGrid
                        label="Slab"
                        fill
                        style={{ left: 3, top: SLAB_TOP, width: `calc(50% - ${3 + SIDE_GAP / 2}px)`, minWidth: slabWidth, height: SLAB_HEIGHT }}
                        columns={slabColumns}
                        cellClass={(row, column) => {
                          const item = slab[row];
                          const percOpen = !item?.itemWise && (item?.percEditable || (item?.options?.length ?? 0) > 0);
                          const amountOpen = !item?.itemWise && item?.amountEditable && !roundsOff(row) && !(row === 0 && book.inventory && item.calc !== "M");
                          return (column.key === "slab_perc" && !percOpen) || (column.key === "slab_amount" && !amountOpen) ? "ent-disabled" : column.editable ? "ent-open" : "";
                        }}
                        rows={slabGridRows}
                        cell={(row, column) => slabCell(row, column.key)}
                      />
                    )}
                    <SideGrid
                      label="Addon"
                      fill
                      style={book.slab ? { left: `calc(50% + ${SIDE_GAP / 2}px)`, right: 6, top: SLAB_TOP, height: SLAB_HEIGHT } : { left: 3, right: 6, top: SLAB_TOP, height: SLAB_HEIGHT }}
                      columns={book.grids.addon}
                      rows={(party?.addon ?? []).map((item) => ({ addon_label: item.label, addon_input: addon[item.key] ?? "" }))}
                      empty={showParty ? "Choose the party: its addon fields show here" : undefined}
                      cell={(row, column) => {
                        const item = party!.addon[row];
                        if (column.key !== "addon_input") return item.label;
                        const value = addon[item.key] ?? "";
                        const set = (next: string) => setAddon((current) => ({ ...current, [item.key]: next }));
                        const cellId = `a${row}`;
                        return <EntryCell kind={item.options ? "combo" : "text"} cellId={cellId} value={value} options={item.options} tools={tools} ariaLabel={item.label} onChange={set} onEnter={() => nextSideCell("Addon", cellId)} />;
                      }}
                    />
                  </>
                )}
                {tab === "outstanding" && (
                  <SideGrid label="Outstanding" style={{ left: 11, top: 15, width: 582, height: Math.min(249, PAGE_HEIGHT - 20) }} columns={book.grids.outstanding} rows={party?.outstanding ?? []} empty={party ? "No pending entries for this party" : "Choose the party first"} />
                )}
                {tab === "find" && <FindList preview={preview} style={{ left: 3, right: 3, top: 3, bottom: 3 }} onOpen={(row) => void openEntry(row)} />}
                {tab === "eway" && <div className="ent-eway">{ewayControls.flatMap(control)}</div>}
              </div>
            </div>
          )}

          {book && (
            <div className="ent-foot">
              <span className="ent-label ent-final-label" style={{ left: 2, top: FOOT_TOP, width: 130 }}>Entry Final Amt.:</span>
              <output className="ent-final" style={{ left: 138, top: FOOT_TOP, width: 101 }} aria-label="Entry final amount">{amountText(String(slabResult.final), 2) || "0.00"}</output>
              {footControls.flatMap(control)}
            </div>
          )}
        </div>
      </div>

      <div className="ent-toolbar" role="toolbar" aria-label="Entry buttons">
        <button type="button" className="mp-btn mp-btn-green" data-hotkey="s" aria-keyshortcuts="Alt+S" disabled={!canSave} title="Saving an invoice is not ported yet" onClick={notPorted("Save")}><Icon name="save" /><HotkeyLabel text="Save" hotkey="s" /></button>
        <button type="button" className="mp-btn mp-btn-blue" data-hotkey="c" aria-keyshortcuts="Alt+C" onClick={() => void cancelEntry()}><Icon name="cancel" /><HotkeyLabel text="Cancel" hotkey="c" /></button>
        <button type="button" className="mp-btn mp-btn-blue" data-hotkey="d" aria-keyshortcuts="Alt+D" disabled={!isRestored} title="Deleting an invoice is not ported yet" onClick={notPorted("Delete")}><Icon name="clear" /><HotkeyLabel text="Delete" hotkey="d" /></button>
        <button type="button" className="mp-btn mp-btn-blue" data-hotkey="p" aria-keyshortcuts="Alt+P" disabled={!isRestored} title="Printing an invoice is not ported yet" onClick={notPorted("Print")}><Icon name="print" /><HotkeyLabel text="Print" hotkey="p" /></button>
        <button type="button" className="mp-btn mp-btn-blue" data-hotkey="r" aria-keyshortcuts="Alt+R" title="Read the helps and the Find / Edit list again" onClick={() => { setAccountHelp(null); setProductHelp(null); setPreview(null); setHelpKind(null); if (tab === "find") void openTab("find"); }}><Icon name="refresh" /><HotkeyLabel text="Refresh" hotkey="r" /></button>
        <button type="button" className="mp-btn mp-btn-blue" data-hotkey="g" aria-keyshortcuts="Alt+G" disabled={!isRestored} title="Range print is not ported yet" onClick={notPorted("Range print")}><Icon name="list" /><HotkeyLabel text="Range" hotkey="g" /></button>
        {def?.buttons.upload && <button type="button" className="mp-btn mp-btn-blue" disabled={!isRestored} title="Upload document is not ported yet" onClick={notPorted("Upload document")}><Icon name="image" />Upload Document</button>}
        {def?.buttons.einvoice && <button type="button" className="mp-btn mp-btn-blue" disabled={!isRestored} title="E-invoice is not ported yet" onClick={notPorted("E-invoice")}><Icon name="export" />E-Invoice</button>}
        {def?.buttons.log && <button type="button" className="mp-btn mp-btn-blue" disabled={!isRestored} title="The entry log is not ported yet" onClick={notPorted("Log")}><Icon name="log" />Log</button>}
        <div className="ent-status" aria-live="polite">
          {busy && <span className="mp-busy">{busy}…</span>}
          {book && <span>{def?.statusHead} · {register?.text} · {book.entryFor}{book.slab ? ` · ${book.taxGroup === "G" ? "CGST" : book.taxGroup === "I" ? "IGST" : "VAT"}` : ""}{isRestored ? " · Edit" : ""}</span>}
          {warnings.map((warning) => <span key={warning} className="ent-warning" title={warning}>⚠ {warning}</span>)}
        </div>
        <button type="button" className="mp-btn mp-btn-red" data-hotkey="q" aria-keyshortcuts="Alt+Q" onClick={() => void quit()}><Icon name="quit" /><HotkeyLabel text="Quit" hotkey="q" /></button>
      </div>
      {tools.popups}
    </div>
  );
}
