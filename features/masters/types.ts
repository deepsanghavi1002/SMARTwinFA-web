/**
 * The shape every master's Update/Delete grid is described in.
 *
 * The desktop program drives one C1FlexGrid from a per-master column list, so the
 * web app does the same: a master supplies its fields and its records, and the
 * shared grid supplies the behaviour. Nothing here is addon-specific, which is what
 * lets Account, Product and the rest reuse it without a second grid being written.
 */

import type { FieldRules } from "./field-rules";

/** Every master record is identified by the key its table stores it under. */
export type MasterRow = { id: number };

export type MasterField<T extends MasterRow> = {
  key: Extract<keyof T, string>;
  label: string;
  /**
   * What this column accepts as it is typed - numbers only, a character whitelist, a
   * length cap, forced case. These come from the master's own program_body row rather
   * than from code, so they follow whatever the installation is set up to allow.
   */
  rules?: FieldRules;
  /** Blank is refused when the cell is edited. */
  required?: boolean;
  /**
   * Never editable in the grid. Identity columns and anything the master derives
   * rather than stores belong here - the operator changes those on the form.
   */
  readOnly?: boolean;
  /** Right-aligned, and refused when an edit does not parse as a number. */
  numeric?: boolean;
  /** A closed list edits as a dropdown instead of a free input. */
  options?: readonly string[];
  /** Starting column width; the operator's own width wins once they drag one. */
  width?: number;
};

/**
 * The columns of a record that a cell edit may touch: the ones actually held as text.
 * Keys like the record id are numbers and are never typed over, so leaving them out
 * lets a parent apply an edit by spreading it over the record without widening it.
 */
export type MasterEditableKey<T> = Extract<
  { [K in keyof T]: T[K] extends string ? K : never }[keyof T],
  string
>;

/** One record the operator changed, as the parent needs it to write the change away. */
export type MasterEdit<T extends MasterRow> = {
  id: number;
  /** Only the columns that actually changed, as displayed text. */
  changes: Partial<Record<MasterEditableKey<T>, string>>;
  /** The record as it stood when it was read, so the parent can compare or audit. */
  original: T;
};
