import type { PublicProgramBodySetup } from "../master-rules";

/**
 * The generic small-entry screen (the desktop's Small_Entry form), as the browser and the
 * server exchange it. One screen serves every SMALL_ENTRY menu; which one is named by
 * menumaster.actionmenu, the entry_properties.entry_name.
 */

export type EntryOption = Readonly<{ text: string; value: string }>;

/** A header control from entry_control (cmb_SmallEntry1-3, dtp_Date1-3, tbx_Text1-3). */
export type EntryControl = Readonly<{
  /** control_name, lowercase: cmb_smallentry2, dtp_date, tbx_text1 ... */
  name: string;
  label: string;
  /** LB a list, DT a date, TB a text box. */
  type: "LB" | "DT" | "TB";
  options: readonly EntryOption[];
  compulsory: boolean;
  tooltip: string;
  /** The value the control opens with (a list's first entry, a date's default). */
  initial: string;
}>;

export type EntryDefinition = Readonly<{
  entryId: number;
  entryName: string;
  caption: string;
  statusHead: string;
  firstCombo: Readonly<{ label: string; options: readonly EntryOption[] }> | null;
  controls: readonly EntryControl[];
  rights: Readonly<{ restricted: boolean; edit: boolean; editPassword: boolean; modulePassword: boolean }>;
  /** The company licence (smart_lic), which some typing rules read. */
  licence: number;
  /** The Delete key removes selected rows (Small_Entry KeyUp: entries 7, 36, 75, 100, 111, and 103 for an AD user). */
  canDelete: boolean;
  /** Setup the web cannot run yet, named so the screen can say so rather than misbehave. */
  unsupported: readonly string[];
}>;

/** The header as chosen: first combo and each visible control's text (dates as dd/MMM/yyyy). */
export type EntryState = Readonly<{
  firstCombo: EntryOption | null;
  controls: Readonly<Record<string, string>>;
}>;

export type EntryColumn = Readonly<{
  /** The column name as the query returns it. */
  key: string;
  caption: string;
  width: number;
  align: "L" | "R" | "C";
  visible: boolean;
  editable: boolean;
  /** entry_grid_body.field_type: T text, N number, C currency, D date, I integer. */
  fieldType: string;
  decimals: number;
  positiveOnly: boolean;
  compulsory: boolean;
  /** An addon column (product master addon or a godown's column group). */
  addon: boolean;
  tooltip: string;
  /**
   * Every entry_grid_body setting of the column, named as the table names them (the same columns
   * as program_body, less the SQL ones), so the shared grid rules (features/grid/rules) type and
   * check it as the desktop does.
   */
  setup: PublicProgramBodySetup;
  /** A combo column's list (combo_value F, L, Q or X): the cell holds the text, the key goes with it for saving. */
  options?: readonly EntryOption[];
  /** A true / false column (the query gives a boolean, as Bank Statement's Tick): shown as a tick box, "True" / "False" in the cell. */
  boolean?: boolean;
}>;

/**
 * query_condition (qc_control_event "GV"): ticking `field` fills `target` with a header control's
 * value (dtp_date3, the Bank Reco. Date); unticking empties it when `untickBlank` (sys.false.blank).
 */
export type TickRule = Readonly<{ field: string; target: string; control: string; untickBlank: boolean }>;

export type EntryGrid = Readonly<{
  /** The entry's tick rules (Small_Entry AfterEdit with Arrint_TrueCol). */
  tickRules?: readonly TickRule[];
  columns: readonly EntryColumn[];
  rows: readonly Record<string, string>[];
  /** How many columns from the left stay put while the grid scrolls sideways (Cols.Frozen). */
  frozen: number;
  /** Text for the desktop's lbl_Book_Balance, when a control event fills it. */
  balance: string;
  /** Text for the desktop's tbx_Final_Amt (Bank Statement's balance as per passbook). */
  finalAmount?: string;
}>;

/** One edited grid row, as the screen sends it to Save. */
export type EditedRow = Readonly<{ values: Readonly<Record<string, string>>; deleted: boolean }>;

export type SaveOutcome = Readonly<{ ok: boolean; message: string; statements: readonly string[]; dryRun: boolean; warnings: readonly string[] }>;
