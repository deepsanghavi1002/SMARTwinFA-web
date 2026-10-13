import type { EntryColumn, EntryOption } from "../small-entry/types";

/**
 * The desktop's Entry form (Comman_Entry, Entry.cs) on the web: the screen behind the
 * TRANSACTION menu's Invoice (and later Voucher). Its setup is the same smart_setup tables the
 * small entry reads: entry_properties (INVOICE = entry 1), entry_control (header controls and
 * where they sit), control_event (what choosing the register runs) and entry_grid_body (the
 * grids' columns).
 */

export type { EntryColumn, EntryOption };

/** Opening the menu (Comman_Entry_Load): the register list and what the company shows. */
export type InvoiceDefinition = Readonly<{
  entryId: number;
  entryName: string;
  caption: string;
  statusHead: string;
  /** "I" invoice or "V" voucher: the first letter of the program name (str_Entry_Style). */
  style: "I" | "V";
  /** The first combo: label (REGISTER) and its account books. */
  firstCombo: Readonly<{ label: string; options: readonly EntryOption[] }>;
  rights: Readonly<{ restricted: boolean; add: boolean; edit: boolean; delete: boolean; modulePassword: boolean }>;
  /** Toolbar buttons the company setup shows (DOC_UPLOAD, logfile S, e-invoice). */
  buttons: Readonly<{ upload: boolean; einvoice: boolean; log: boolean }>;
  /** Tabs the company shows: Outstanding (not licence 17), E-Way Bill (GST companies, invoices). */
  tabs: Readonly<{ outstanding: boolean; eway: boolean }>;
  /** E-invoice companies hide the E-Way date and validity boxes. */
  ewayDates: boolean;
  licence: number;
  /** Setup the web cannot run yet, named so the screen can say so. */
  unsupported: readonly string[];
}>;

/** Where a control sits: the header (T), the foot under the tabs (B), or the E-Way Bill tab (E). */
export type ControlPlace = "T" | "B" | "E";

/** A header / foot control from entry_control, placed where the setup puts it on the desktop form. */
export type InvoiceControl = Readonly<{
  /** control_name, lowercase: cmb_series, dtp_date, tbx_number, tbx_partyname ... */
  name: string;
  label: string;
  /** CB a list, DT a date, TB a text box. */
  type: "CB" | "DT" | "TB";
  place: ControlPlace;
  label_: Readonly<{ left: number; top: number; width: number; height: number; right: boolean }>;
  box: Readonly<{ left: number; top: number; width: number; height: number }>;
  tabIndex: number;
  compulsory: boolean;
  /** update_editable false: the box is closed on an Edit. */
  editableOnEdit: boolean;
  options: readonly EntryOption[];
  initial: string;
  maxLength: number;
  tooltip: string;
}>;

/** One row of the slab (bill sundry) grid. */
export type SlabRow = Readonly<{
  key: number;
  order: number;
  sign: string;
  desc: string;
  short: string;
  /** Tax master rows have a tax list in the % column. */
  master: boolean;
  /** Item-wise: the figure comes from the product rows (slab_pos P). */
  itemWise: boolean;
  /** slab_mathop: A add, L less, U round off... */
  mathOp: string;
  perc: string;
  amount: string;
  percEditable: boolean;
  amountEditable: boolean;
  options?: readonly EntryOption[];
}>;

/** Choosing a register (Cmb_FirstCombo_Leave): everything the screen shows for that book. */
export type BookScreen = Readonly<{
  bookCode: number;
  bookKey: number;
  /** book_actual Y: an account book (sale, purchase...); else a stock module (order, challan...). */
  bookActual: boolean;
  /** int_type: the stock module's own book key (0 for an account book). */
  type: number;
  /** lbl_Display_Book_Side: Debit or Credit. */
  side: string;
  /** str_Entry_for: Bill, DrCr, Chln, Order, Qtn ... */
  entryFor: string;
  stkmShort: string;
  /** stkm_pcode: the book takes a party. */
  party: boolean;
  /** str_Inventory: product rows are entered (else only the slab's first row takes the amount). */
  inventory: boolean;
  /** stkm_slab: the slab grid is shown. */
  slab: boolean;
  /** lbl_Book_Balance, or "" when hidden (HIDEBAL, a_posting N). */
  balance: string;
  /** "G" CGST+SGST, "I" IGST, "V" VAT: str_Entry_AddTaxGroup. */
  taxGroup: "G" | "I" | "V";
  controls: readonly InvoiceControl[];
  /** The product grid (c1dg_Inputdata): its columns and how many rows it offers. */
  product: Readonly<{ columns: readonly EntryColumn[]; rows: number; frozen: number; totals: readonly string[] }>;
  slabRows: readonly SlabRow[];
  /** The visible columns of the slab, addon and outstanding grids (entry_grid_body of their fill events). */
  grids: Readonly<{ slab: readonly GridColumn[]; addon: readonly GridColumn[]; outstanding: readonly GridColumn[] }>;
  /** str_Ac_Help: the books the party help lists. */
  partyBooks: string;
  /** Defaults for the first series: date and number. */
  defaults: SeriesDefaults;
  warnings: readonly string[];
}>;

/** A column of the side grids, as Setting_GridCol shows it. */
export type GridColumn = Readonly<{ key: string; caption: string; width: number; align: "L" | "R" | "C"; decimals: number; editable: boolean }>;

export type SeriesDefaults = Readonly<{ date: string; number: string }>;

/** The party help list (HELP_ENT_ACCOUNT through Help_Design). */
export type HelpList = Readonly<{
  columns: readonly Readonly<{ key: string; caption: string; width: number; align: string; format: string }>[];
  rows: readonly Readonly<Record<string, string>>[];
  frozen: number;
  total: string;
}>;

/** Leaving the party (Tbx_PartyName_Leave): its address lines and its addon fields. */
export type PartyDetails = Readonly<{
  code: number;
  name: string;
  address: readonly string[];
  addon: readonly Readonly<{ key: number; label: string; value: string; options?: readonly EntryOption[] }>[];
  creditDays: string;
  /** The party's pending bills (c1dg_OutClear's query), shown on the Outstanding tab. */
  outstanding: readonly Readonly<Record<string, string>>[];
}>;
