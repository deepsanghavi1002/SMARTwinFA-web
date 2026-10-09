/**
 * Cls_Report_Output: what Report_Combine.GenerateReport hands SP_REPORT_STANDARD /
 * SP_REPORT_FORMATING, named as the procedures name their parameters. The SQL fragments in it are
 * PostgreSQL (the desktop's are SQL Server's); everything else is as the C# fills it.
 */
export type ReportCall = {
  reportKey: number;
  /** @var_formatting: the format item's formating_sp_id (MONTHLY, DAILY ...); "" for the standard report. */
  formating: string;
  closingNeeded: boolean;
  /** @date_dtFrom / @date_dtUpto. */
  from: Date;
  upto: Date;
  /** @var_selected_datefld (str_DateFld): the sort's date column, or output_defa_datecol. */
  dateField: string;
  /** @var_SelectStartStr: the fixed columns, then the output columns. */
  queryStart: string;
  /** @var_SelectEndStr: the ticked groups' own columns (SELECTED_BOOK ...). */
  queryEnd: string;
  /** @nvar_CS_From, starting " from ". */
  from_: string;
  /** @var_CS_Where, starting " where ". */
  where: string;
  groupBy: string;
  orderBy: string;
  /** @var_CHECK_QUREY: the ticked, visible options' names, each followed by a comma. */
  checkQuery: string;
  filterText: string;
  sortingText: string;
  seriesText: string;
  acAddonRelate: string;
  prodAddonRelate: string;
  acAddonRepdefa: string;
  prodAddonRepdefa: string;
  addonEntryPos: string;
  addonMasterPos: string;
  /** @var_select_key1 .. 4: the ticked addon subs of each addon group, "(1,2)"; key5 the accounts (or products). */
  selectKey: [string, string, string, string, string];
  selectBookKey: string;
  selectScheduleKey: string;
  selectIdoptKey: string;
  /** @var_heading_addon1-4, @var_selected_addon1-4, @var_addon1-4. */
  headingAddon: [string, string, string, string];
  selectedAddon: [string, string, string, string];
  addon: [string, string, string, string];
  /** @var_text1 .. 10: values typed in the sort's runtime boxes. */
  text: string[];
  filterId: string;
  book: number;
  againstBook: number;
  fcValue: number;
  fcText: string;
  /** @nvar_DatabaseName: "<schema>." */
  database: string;
  prvDatabase: string;
  /** @nvar_NameOpening_From: "(SYS.FIXDB)" wrapped in the groups' joins. */
  openingFrom: string;
  slabKey: number;
  slabsKey: string;
  slabsCount: number;
  slabText: string;
  tarikh1: Date;
  tarikh2: Date;
  yearId: string;
  userMachineNo: string;
  userNo: string;
  licence: number;
  companyKey: number;
  /** @var_union_select_list: each output column's outputcol_narration (the narration row's value). */
  unionQuery: string;
  /** @var_union_groups: the ticked groups' run selects ("ac.name,bookmst.book_desc,"). */
  unionGroups: string;
  /** @var_fixcols: the fixed columns alone (Join_Cols_For_Sql of fix_columns). */
  fixCols: string;
  sorting: string;
  showNarration: boolean;
  useUnion: boolean;
  groupsAsHeadings: boolean;
  printAllSlabs: boolean;
  jvDetailsRequired: boolean;
  fromDateEnabled: boolean;
  /** The keys ticked in the first combo's own help grid (REP_CONTROL_ID -1): the bank / sale accounts of the Form Summary and the like. */
  firstHelpKeys: string[];
};

/** One row of a report's result table: column name (as the procedure names it) to value. */
export type ResultRow = Record<string, unknown>;

/**
 * A result table: its columns in order (SELECT * order) and its rows. Column names compare
 * case-insensitively, as SQL Server's and a DataTable's do.
 */
export class ResultTable {
  readonly columns: string[] = [];
  rows: ResultRow[] = [];
  /** Columns that hold numbers (a DataTable's decimal / Int32 columns): "decimal" or "int". */
  readonly numberKinds = new Map<string, "decimal" | "int">();

  setKind(column: string, kind: "decimal" | "int"): void {
    this.numberKinds.set(this.addColumn(column), kind);
  }

  kind(column: string): "decimal" | "int" | "text" {
    const name = this.name(column);
    return name === undefined ? "text" : this.numberKinds.get(name) ?? "text";
  }

  /** The column's name as the table spells it, or undefined. */
  name(column: string): string | undefined {
    const lower = column.toLowerCase();
    return this.columns.find((candidate) => candidate.toLowerCase() === lower);
  }

  has(column: string): boolean {
    return this.name(column) !== undefined;
  }

  addColumn(column: string): string {
    const existing = this.name(column);
    if (existing) return existing;
    this.columns.push(column);
    return column;
  }

  get(row: ResultRow, column: string): unknown {
    const name = this.name(column);
    return name === undefined ? undefined : row[name];
  }

  set(row: ResultRow, column: string, value: unknown): void {
    row[this.addColumn(column)] = value;
  }

  /** A new row with every column null, then the given values (an INSERT naming some columns). */
  insert(values: Readonly<Record<string, unknown>>): ResultRow {
    const row: ResultRow = Object.fromEntries(this.columns.map((column) => [column, null]));
    for (const [column, value] of Object.entries(values)) {
      const name = this.name(column);
      if (name !== undefined) row[name] = value;
    }
    this.rows.push(row);
    return row;
  }
}
