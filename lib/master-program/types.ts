import type { PublicProgramBodySetup } from "../master-rules";

/**
 * What the generic master screen exchanges with its server.
 *
 * Master_ProgramGrid keeps three grids in memory: c1dg_MasterGrid (the Add tab, one row
 * per field), c1dg_UpdateGrid (the Update tab, one column per field) with c1_PropertyGrid
 * holding each column's program_body row, and c1dg_SaveGrid describing what a save
 * writes. The browser gets the first two, keyed by field name rather than position; the
 * save grid is rebuilt on the server at save time from the same setup.
 */

export type ComboOption = Readonly<{ text: string; value: string }>;

/** How a field edits. "1" is the group combo itself; "N" (or blank) is plain input. */
export type ComboKind = "1" | "C" | "F" | "L" | "N" | "Q" | "S" | "V" | "X" | "";

export type SessionKey = Readonly<{ companyId: number; yearKey: number; loginName: string }>;

export type FirstCombo = Readonly<{
  label: string;
  options: readonly ComboOption[];
  /** The desktop binds a DataSource for query/fixvalue combos; a combo_list combo is only text. */
  bound: boolean;
  /** Typing allowed (DropDown) rather than pick-only (DropDownList). */
  editable: boolean;
}>;

export type ProgramDefinition = Readonly<{
  programId: number;
  programName: string;
  heading: string;
  menuShortName: string;
  firstCombo: FirstCombo | null;
  /** Programs 21, 22, 23, 26, 28, 29, 32, 36, 42, 49, 50, 51 pick a second value first. */
  usesSecondCombo: boolean;
  rights: Readonly<{ add: boolean; edit: boolean; delete: boolean; restricted: boolean }>;
  /** A module password is asked before the screen opens (u_module_pass). */
  needsModulePassword: boolean;
  licence: number;
  imageReq: boolean;
}>;

/** One column of the Update grid: its program_body row plus what Setting_GridCol decided. */
export type UpdateColumn = Readonly<{
  /** The lowercased result column the value arrives under. */
  key: string;
  caption: string;
  width: number;
  visible: boolean;
  editable: boolean;
  align: "L" | "C" | "R" | "";
  /** Display format Setting_GridCol assigns: "N2", "#,##0.00", "dd/MM/yyyy", "HH:mm", "#,###". */
  format: string;
  comboKind: ComboKind;
  options: readonly ComboOption[] | null;
  /** field_update_order: the desktop's column number, used by |sys.pkv| and friends. */
  position: number;
  /** STATUS_DISPLAY: the typing rules summarised for the status bar. */
  statusDisplay: string;
  setup: PublicProgramBodySetup;
}>;

/** One row of the Add grid (c1dg_MasterGrid): the field, the typed value and its combo id. */
export type AddRow = Readonly<{
  fieldName: string;
  headLabel: string;
  fieldInput: string;
  fieldComboValue: string;
  visible: boolean;
  editable: boolean;
  comboKind: ComboKind;
  options: readonly ComboOption[] | null;
  /** ArrStr_DefaComboText / Value: what Cancel restores a Q/X combo to. */
  defaultText: string;
  defaultValue: string;
  styleName: "" | "curr" | "date" | "Decimal_1" | "Decimal_2" | "Decimal_3" | "Decimal_4" | "Pos_Integer";
  /** field_carry_name set at runtime for licence 30's description rows. */
  carryName: string;
  /** STATUS_DISPLAY: the typing rules summarised for the status bar. */
  statusDisplay: string;
  setup: PublicProgramBodySetup;
}>;

/** A record of the Update grid, values as text keyed by lowercased column name. */
export type UpdateRecord = Record<string, string>;

export type GroupState = Readonly<{
  firstCombo: ComboOption;
  secondCombo: ComboOption | null;
}>;

export type GroupLoad =
  | Readonly<{ kind: "second-combo"; label: string; options: readonly ComboOption[] }>
  | Readonly<{
      kind: "grids";
      heading: string;
      addTabVisible: boolean;
      updateTabVisible: boolean;
      addCloseOnUpdateExist: boolean;
      frozen: number;
      columns: readonly UpdateColumn[];
      records: readonly UpdateRecord[];
      /** c1_Update_Backup: the values as read, for Ctrl+Z, restore and combo ids. */
      backup: readonly UpdateRecord[];
      addRows: readonly AddRow[];
      firstAddRow: number;
      lastAddRow: number;
      /** The record-exists checks this program has, so the grid knows when to ask. */
      recordExistChecks: boolean;
      memoField: string;
      hotKeys: string;
      message: string;
      /** fld_value_1..9 read by add_defavalue_query when the add screen is hidden. */
      fieldValues: readonly string[];
      coreEntry: boolean;
      levelMaster: Readonly<Record<string, unknown>> | null;
      /** str_pkvColumn: the key column the edit-log viewer looks up; "" when none. */
      pkvKey: string;
    }>;

/** A saved master licence 7 sends to Ezeone: a debtor or a product, by name. */
export type CloudPush = Readonly<{ kind: "debtor" | "product"; name: string }>;
