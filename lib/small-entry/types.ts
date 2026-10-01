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
  /** A combo column's list (combo_value F, L, Q or X): the cell holds the text, the key goes with it for saving. */
  options?: readonly EntryOption[];
}>;

export type EntryGrid = Readonly<{
  columns: readonly EntryColumn[];
  rows: readonly Record<string, string>[];
  /** Text for the desktop's lbl_Book_Balance, when a control event fills it. */
  balance: string;
}>;

/** One edited grid row, as the screen sends it to Save. */
export type EditedRow = Readonly<{ values: Readonly<Record<string, string>>; deleted: boolean }>;

export type SaveOutcome = Readonly<{ ok: boolean; message: string; statements: readonly string[]; dryRun: boolean; warnings: readonly string[] }>;
