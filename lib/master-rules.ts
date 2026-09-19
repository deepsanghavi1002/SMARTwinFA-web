import { readOnly } from "./db";
import type { FieldRules } from "../features/masters/field-rules";

/**
 * The per-column setup of a master, read from smart_setup.program_body.
 *
 * This is the table the desktop's Master_ProgramGrid reads through
 * ST_SP_READ_UPDATE_PROGRAMBODY before it draws a master: one row per column, carrying
 * the heading, the order, the width, and every typing rule the operator will meet -
 * whether the column takes numbers only, which characters it accepts or refuses, how
 * long it may be, and what case it is forced to.
 *
 * It is read at runtime and never copied into code, because it is per installation:
 * a client whose program_body says a column is numeric with no decimals gets exactly
 * that, and the web app needs no change to agree with their Windows program.
 */

type ColumnKind = "int" | "text" | "bool" | "money" | "date";

/**
 * Every column of smart_setup.program_body, in the table's own order.
 *
 * The desktop reads these as c1_PropertyGrid.Rows[col]["name"] in about 250 places, so
 * the names are kept exactly as the table spells them: a line of C# can be checked
 * against the web code by searching for the same word. The list is explicit rather than
 * `SELECT *` so a column dropped from the table fails loudly here instead of quietly
 * turning a rule off.
 */
export const PROGRAM_BODY_COLUMNS = {
  program_body_key: "int",
  program_top_id: "int",
  field_unique_name: "text",
  field_add_order: "int",
  field_update_order: "int",
  add_active: "bool",
  update_active: "bool",
  field_save_add: "bool",
  field_save_update: "bool",
  database_name: "text",
  field_in_upd_where: "bool",
  field_name: "text",
  field_save: "text",
  field_savenochr: "int",
  field_restore: "text",
  head_label: "text",
  head_grid: "text",
  head_report: "text",
  head_short: "text",
  display_head: "text",
  print_inmaster: "bool",
  print_inreport: "bool",
  field_input: "text",
  field_combovalue: "text",
  duplicate_chk: "bool",
  duplicate_query: "text",
  duplichk_fldname1: "text",
  duplichk_fldname2: "text",
  duplichk_fldname3: "text",
  duplichk_pkfldname: "text",
  dupliadd_combofld: "text",
  value_diff_than: "text",
  field_type: "text",
  input_type: "text",
  force_inputtype: "text",
  field_length: "int",
  field_length_min: "int",
  field_length_max: "int",
  add_grid_align: "text",
  update_grid_width: "int",
  update_grid_align: "text",
  update_grid_visible: "bool",
  add_grid_visible: "bool",
  update_grid_helpsel: "bool",
  update_grid_editable: "bool",
  add_autocomplete: "bool",
  update_autocomplete: "bool",
  field_carry_name: "text",
  defa_add_disable: "text",
  defa_fixvalue: "text",
  defa_sysvalue: "text",
  defa_formula: "text",
  defa_add_value_query: "text",
  defa_value_query: "text",
  defa_against_field: "text",
  defa_against_for: "text",
  defa_against_query: "text",
  run_compulsory_field: "text",
  run_compulsory_cond: "text",
  field_validation: "text",
  value_search_infld: "text",
  rec_found_forquery: "bool",
  style_case: "text",
  allow_space: "bool",
  date_with_chkbox: "bool",
  date_range_from: "date",
  date_range_upto: "date",
  number_range_from: "money",
  number_range_upto: "money",
  number_positiveonly: "bool",
  decimal_points: "int",
  round_length: "int",
  display_help: "bool",
  help_query: "text",
  value_compulsory: "bool",
  value_notallowed: "text",
  value_allowed: "text",
  combo_key_fldname: "text",
  combo_value: "text",
  combo_query: "text",
  combo_fixvalueid: "text",
  combo_list: "text",
  combo_byfirstcombo: "text",
  run_upd_combofld: "text",
  run_add_combofld: "text",
  combo_fixquery: "text",
  combo_fixwhere: "text",
  combo_fixorder: "text",
  disable_for: "text",
  enable_for: "text",
  disable_by_firstcmbval: "text",
  enable_by_firstcmbval: "text",
  hide_by_firstcmbval: "text",
  visible_by_firstcmbval: "text",
  status_against_fld: "text",
  save_for_disable: "bool",
  visible_against_fld: "text",
  hide_for_value: "text",
  onchange_repl_value_query: "text",
  input_mask: "text",
  must_contain: "text",
  field_prefix: "text",
  field_suffix: "text",
  combo_with_blank: "bool",
  multiple_chkbox: "bool",
  log_short: "text",
  display_other: "text",
  display_other_query: "text",
  formula_for_table: "text",
  formula_name: "text",
  field_tooltips: "text",
  temp_field_order: "int",
  temp_field_upd_order: "int",
  field_label: "text",
} as const satisfies Record<string, ColumnKind>;

export type ProgramBodyColumn = keyof typeof PROGRAM_BODY_COLUMNS;
type ValueOfKind<K extends ColumnKind> =
  K extends "int" | "money" ? number : K extends "bool" ? boolean : K extends "date" ? string | null : string;

/** One program_body row, every setting present, nulls already turned into the desktop's defaults. */
export type ProgramBodySetup = { readonly [C in ProgramBodyColumn]: ValueOfKind<(typeof PROGRAM_BODY_COLUMNS)[C]> };

/**
 * The settings that hold SQL, or a fragment of it.
 *
 * They run on the server with the company's values pasted in, so the browser has no
 * use for their text and should not be handed a map of the schema. It is told only
 * which of them a column has, which is all it needs to know a round trip is due.
 */
export const SERVER_ONLY_COLUMNS = [
  "field_save",
  "field_restore",
  "duplicate_query",
  "defa_add_value_query",
  "defa_value_query",
  "defa_against_query",
  "combo_fixquery",
  "combo_fixwhere",
  "combo_fixorder",
  "onchange_repl_value_query",
  "display_other_query",
] as const satisfies readonly ProgramBodyColumn[];

export type ServerOnlyColumn = (typeof SERVER_ONLY_COLUMNS)[number];

export type PublicProgramBodySetup = Omit<ProgramBodySetup, ServerOnlyColumn> & {
  /** The server-only settings this column has filled in. */
  readonly serverQueries: readonly ServerOnlyColumn[];
};

export type MasterFieldRule<S = ProgramBodySetup> = Readonly<{
  /** The column of the master's own table, lowercased - what the record keys map onto. */
  column: string;
  label: string;
  order: number;
  visible: boolean;
  editable: boolean;
  /** The desktop's own column width, so the grid opens looking familiar. 0 means unset. */
  width: number;
  rules: FieldRules;
  /** Every program_body setting of this column, named as the table names them. */
  setup: S;
}>;

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());

/**
 * program_body holds a few settings as blank rather than null, and the pipe lists carry a
 * trailing separator. Empty is normalised away here so the browser never has to ask
 * whether "" means "no rule" or "refuse everything".
 */
const list = (value: unknown) => {
  const raw = text(value);
  return raw.replace(/\|+$/, "").trim() === "" ? undefined : raw;
};

/**
 * PostgreSQL hands a money column back as text in the server's lc_monetary, currency
 * sign and thousands separators included - and on some restored databases the sign is
 * already a literal "?". Only the number is wanted.
 */
export function parseMoney(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  const raw = String(value).trim();
  const negative = raw.startsWith("-") || /^\(.*\)$/.test(raw);
  const digits = raw.replace(/[^0-9.]/g, "");
  const parsed = Number(digits);
  if (digits === "" || !Number.isFinite(parsed)) return 0;
  return negative ? -parsed : parsed;
}

/**
 * The desktop reads program_body through FieldValueTrfToString / ToInt32 / Convert.ToBoolean,
 * which turn a null into "", 0 and false. The same defaults are applied once here, so no
 * caller has to guard a null the desktop never saw. Text is left untrimmed: several of
 * these settings are SQL, and a trim is the caller's decision, as it is in the C#.
 */
export function toSetup(row: Record<string, unknown>): ProgramBodySetup {
  const setup: Record<string, unknown> = {};
  for (const [column, kind] of Object.entries(PROGRAM_BODY_COLUMNS) as [ProgramBodyColumn, ColumnKind][]) {
    const value = row[column];
    switch (kind) {
      case "int":
        setup[column] = value === null || value === undefined ? 0 : Number(value) || 0;
        break;
      case "money":
        setup[column] = parseMoney(value);
        break;
      case "bool":
        setup[column] = Boolean(value);
        break;
      case "date":
        setup[column] = value === null || value === undefined
          ? null
          : value instanceof Date ? value.toISOString() : String(value);
        break;
      default:
        setup[column] = value === null || value === undefined ? "" : String(value);
    }
  }
  return setup as ProgramBodySetup;
}

/** The setup with its SQL settings removed, fit to send to the browser. */
export function publicSetup(setup: ProgramBodySetup): PublicProgramBodySetup {
  const shown: Record<string, unknown> = { ...setup };
  const serverQueries: ServerOnlyColumn[] = [];
  for (const column of SERVER_ONLY_COLUMNS) {
    if (text(setup[column]) !== "") serverQueries.push(column);
    delete shown[column];
  }
  return { ...(shown as Omit<ProgramBodySetup, ServerOnlyColumn>), serverQueries };
}

export async function readMasterRules(programName: string): Promise<MasterFieldRule[]> {
  const columns = Object.keys(PROGRAM_BODY_COLUMNS).map((column) => `b.${column}`).join(",\n              ");
  return readOnly(async (client) => {
    const result = await client.query(
      `SELECT ${columns}
         FROM smart_setup.program_body AS b
         JOIN smart_setup.program_top  AS t ON t.program_top_key = b.program_top_id
        WHERE t.program_name = $1
          AND b.update_active
          AND b.field_update_order > 0
        ORDER BY b.field_update_order`,
      [programName],
    );

    return result.rows.map((row) => {
      const setup = toSetup(row);
      return {
        // field_name is occasionally qualified ("asub.SUB_CODE"); only the column matters.
        column: text(setup.field_name).split(".").pop()!.toLowerCase(),
        label: text(setup.head_grid),
        order: setup.field_update_order,
        visible: setup.update_grid_visible,
        editable: setup.update_grid_editable,
        width: setup.update_grid_width,
        rules: {
          forceInput: text(setup.force_inputtype) || undefined,
          allowSpace: setup.allow_space,
          valueAllowed: list(setup.value_allowed),
          valueNotAllowed: list(setup.value_notallowed),
          // 0 is the desktop's "no limit", so it is dropped rather than carried as a cap.
          maxLength: setup.field_length_max > 0 ? setup.field_length_max : undefined,
          styleCase: text(setup.style_case) || undefined,
          decimals: setup.decimal_points,
          positiveOnly: setup.number_positiveonly,
          required: setup.value_compulsory,
        },
        setup,
      };
    });
  });
}
