/**
 * The Payroll module's tables, made in every company schema (rishabh_plastic27 and each client's own).
 *
 * Payroll never keeps a second copy of a staff member: a profile points at the company's own `account` row (code), and the name and opening
 * balance are always read from `account` / `ac_balance`. Every statement is idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING), is written
 * without a schema name, and is run with the company schema first on the search_path - by scripts/payroll-setup.mts for every company, and by
 * the web API on first use for the company it serves.
 *
 * To add tables in a later phase, append a new entry to PAYROLL_STEPS with the next version; a company already at that version skips it.
 */

/** The menu_para (smart_system.setup) word that switches the module on, written like the other *_para lists: "PAYROLL,". */
export const PAYROLL_ACTIVATION = "PAYROLL,";

export type PayrollStep = Readonly<{ version: number; name: string; statements: readonly string[] }>;

export const PAYROLL_STEPS: readonly PayrollStep[] = [
  {
    version: 1,
    name: "Phase 1: setup, components, staff profile, salary structure",
    statements: [
      // The company's one payroll setting row (setup_id is always 1).
      `CREATE TABLE IF NOT EXISTS pay_setup (
         setup_id        smallint      PRIMARY KEY DEFAULT 1 CHECK (setup_id = 1),
         jv_mode         varchar(2)    NOT NULL DEFAULT 'AB' CHECK (jv_mode IN ('A', 'B', 'AB')),
         salary_exp_code integer       NULL,
         days_basis      varchar(3)    NOT NULL DEFAULT 'CAL' CHECK (days_basis IN ('CAL', 'FIX')),
         fixed_days      numeric(5,2)  NOT NULL DEFAULT 26,
         pf_pct          numeric(6,3)  NOT NULL DEFAULT 12,
         pf_emp_pct      numeric(6,3)  NOT NULL DEFAULT 12,
         pf_ceiling      numeric(14,2) NOT NULL DEFAULT 15000,
         esi_pct         numeric(6,3)  NOT NULL DEFAULT 0.75,
         esi_emp_pct     numeric(6,3)  NOT NULL DEFAULT 3.25,
         esi_ceiling     numeric(14,2) NOT NULL DEFAULT 21000,
         pt_amount       numeric(14,2) NOT NULL DEFAULT 200,
         pt_from_gross   numeric(14,2) NOT NULL DEFAULT 0,
         updated_by      varchar(60)   NULL,
         updated_at      timestamp     NOT NULL DEFAULT now()
       )`,
      `INSERT INTO pay_setup (setup_id) VALUES (1) ON CONFLICT (setup_id) DO NOTHING`,

      // The pay heads. calc_mode F: the structure holds an amount; P: it holds a percentage of BASIC.
      `CREATE TABLE IF NOT EXISTS pay_component (
         component_id  serial       PRIMARY KEY,
         comp_name     varchar(40)  NOT NULL UNIQUE,
         comp_type     char(1)      NOT NULL CHECK (comp_type IN ('E', 'D')),
         calc_mode     char(1)      NOT NULL DEFAULT 'F' CHECK (calc_mode IN ('F', 'P')),
         pf_applicable  boolean     NOT NULL DEFAULT false,
         esi_applicable boolean     NOT NULL DEFAULT false,
         seq           smallint     NOT NULL DEFAULT 0,
         is_system     boolean      NOT NULL DEFAULT false,
         active        boolean      NOT NULL DEFAULT true
       )`,
      `INSERT INTO pay_component (comp_name, comp_type, calc_mode, pf_applicable, esi_applicable, seq, is_system) VALUES
         ('BASIC',           'E', 'F', true,  true,  1, true),
         ('HRA',             'E', 'P', false, true,  2, false),
         ('ALLOWANCE',       'E', 'F', false, true,  3, false),
         ('OTHER DEDUCTION', 'D', 'F', false, false, 9, false)
       ON CONFLICT (comp_name) DO NOTHING`,

      // One row per enrolled staff ledger. code IS the account's code: no name, no balance here.
      `CREATE TABLE IF NOT EXISTS pay_staff_profile (
         code         integer      PRIMARY KEY REFERENCES account (code),
         designation  varchar(60)  NULL,
         department   varchar(60)  NULL,
         join_date    date         NULL,
         exit_date    date         NULL,
         pay_basis    char(1)      NOT NULL DEFAULT 'M' CHECK (pay_basis IN ('M', 'D')),
         bank_name    varchar(60)  NULL,
         bank_ac_no   varchar(30)  NULL,
         bank_ifsc    varchar(15)  NULL,
         pan_no       varchar(15)  NULL,
         pf_no        varchar(30)  NULL,
         uan_no       varchar(20)  NULL,
         esi_no       varchar(30)  NULL,
         pf_on        boolean      NOT NULL DEFAULT false,
         esi_on       boolean      NOT NULL DEFAULT false,
         pt_on        boolean      NOT NULL DEFAULT false,
         active       boolean      NOT NULL DEFAULT true,
         remark       varchar(200) NULL,
         created_by   varchar(60)  NULL,
         created_at   timestamp    NOT NULL DEFAULT now(),
         updated_by   varchar(60)  NULL,
         updated_at   timestamp    NOT NULL DEFAULT now()
       )`,

      // What a staff member earns / is cut, by pay head, from a date. A raise adds rows with a later effective_from and closes the old ones.
      `CREATE TABLE IF NOT EXISTS pay_salary_structure (
         struct_id      serial        PRIMARY KEY,
         code           integer       NOT NULL REFERENCES pay_staff_profile (code) ON DELETE CASCADE,
         component_id   integer       NOT NULL REFERENCES pay_component (component_id),
         amount         numeric(14,2) NOT NULL DEFAULT 0,
         effective_from date          NOT NULL,
         effective_to   date          NULL,
         UNIQUE (code, component_id, effective_from)
       )`,
      `CREATE INDEX IF NOT EXISTS ix_pay_salary_structure_code ON pay_salary_structure (code, effective_from)`,
    ],
  },
  {
    version: 2,
    name: "Phase 2: periods, attendance, slips",
    statements: [
      // One row per calendar month being paid. open -> processed -> locked.
      `CREATE TABLE IF NOT EXISTS pay_period (
         period_id   serial      PRIMARY KEY,
         pay_year    smallint    NOT NULL CHECK (pay_year BETWEEN 2000 AND 2100),
         pay_month   smallint    NOT NULL CHECK (pay_month BETWEEN 1 AND 12),
         from_date   date        NOT NULL,
         to_date     date        NOT NULL,
         status      char(1)     NOT NULL DEFAULT 'O' CHECK (status IN ('O', 'P', 'L')),
         created_by  varchar(60) NULL,
         created_at  timestamp   NOT NULL DEFAULT now(),
         UNIQUE (pay_year, pay_month)
       )`,
      // Days paid for a staff member in a period. No row: the month's default (full, or from joining / to exit).
      `CREATE TABLE IF NOT EXISTS pay_attendance (
         period_id  integer       NOT NULL REFERENCES pay_period (period_id) ON DELETE CASCADE,
         code       integer       NOT NULL REFERENCES pay_staff_profile (code),
         paid_days  numeric(5,2)  NOT NULL CHECK (paid_days >= 0 AND paid_days <= 31),
         remark     varchar(100)  NULL,
         saved_by   varchar(60)   NULL,
         saved_at   timestamp     NOT NULL DEFAULT now(),
         PRIMARY KEY (period_id, code)
       )`,
      // One slip per staff member per month (the unique key). The salary credit's ledger line is linked in a later phase, never copied.
      `CREATE TABLE IF NOT EXISTS pay_slip (
         slip_id       serial        PRIMARY KEY,
         period_id     integer       NOT NULL REFERENCES pay_period (period_id) ON DELETE CASCADE,
         code          integer       NOT NULL REFERENCES pay_staff_profile (code),
         paid_days     numeric(5,2)  NOT NULL,
         month_days    numeric(5,2)  NOT NULL,
         gross         numeric(14,2) NOT NULL,
         pf_emp        numeric(14,2) NOT NULL DEFAULT 0,
         esi_emp       numeric(14,2) NOT NULL DEFAULT 0,
         pt            numeric(14,2) NOT NULL DEFAULT 0,
         other_ded     numeric(14,2) NOT NULL DEFAULT 0,
         total_ded     numeric(14,2) NOT NULL,
         net_payable   numeric(14,2) NOT NULL,
         pf_er         numeric(14,2) NOT NULL DEFAULT 0,
         esi_er        numeric(14,2) NOT NULL DEFAULT 0,
         jv_led_key    integer       NULL,
         processed_by  varchar(60)   NULL,
         processed_at  timestamp     NOT NULL DEFAULT now(),
         UNIQUE (period_id, code)
       )`,
      `CREATE TABLE IF NOT EXISTS pay_slip_line (
         line_id      serial        PRIMARY KEY,
         slip_id      integer       NOT NULL REFERENCES pay_slip (slip_id) ON DELETE CASCADE,
         component_id integer       NULL REFERENCES pay_component (component_id),
         line_name    varchar(40)   NOT NULL,
         line_type    char(1)       NOT NULL CHECK (line_type IN ('E', 'D')),
         seq          smallint      NOT NULL DEFAULT 0,
         amount       numeric(14,2) NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS ix_pay_slip_line_slip ON pay_slip_line (slip_id)`,
    ],
  },
  {
    version: 3,
    name: "Phase 3: voucher tags",
    statements: [
      // A tag points at an existing voucher line of a staff ledger (ledger.led_key = ledger_post.led_id) and says which period and kind of payment it is
      // for, and how much of the line. It copies no voucher data. A line can be split across tags; their sum can never pass the line (the service
      // checks it under a lock on the staff member). A reversed tag stays for the record and counts for nothing.
      `CREATE TABLE IF NOT EXISTS pay_voucher_tag (
         tag_id       serial        PRIMARY KEY,
         led_id       integer       NOT NULL,
         code         integer       NOT NULL REFERENCES pay_staff_profile (code),
         period_id    integer       NOT NULL REFERENCES pay_period (period_id),
         tag_type     char(3)       NOT NULL CHECK (tag_type IN ('SAL', 'PAY', 'ADV', 'REC', 'OTH')),
         amount       numeric(14,2) NOT NULL CHECK (amount > 0),
         note         varchar(100)  NULL,
         tagged_by    varchar(60)   NULL,
         tagged_at    timestamp     NOT NULL DEFAULT now(),
         reversed     boolean       NOT NULL DEFAULT false,
         reversed_by  varchar(60)   NULL,
         reversed_at  timestamp     NULL
       )`,
      `CREATE INDEX IF NOT EXISTS ix_pay_voucher_tag_line ON pay_voucher_tag (code, led_id) WHERE NOT reversed`,
      `CREATE INDEX IF NOT EXISTS ix_pay_voucher_tag_period ON pay_voucher_tag (period_id) WHERE NOT reversed`,
    ],
  },
  {
    version: 4,
    name: "Phase 4: salary journal link",
    statements: [
      // How a slip's salary credit got into the accounts: A, payroll made the journal; B, an existing journal line was mapped (jv_led_key is the line).
      `ALTER TABLE pay_slip ADD COLUMN IF NOT EXISTS jv_mode char(1) NULL CHECK (jv_mode IN ('A', 'B'))`,
      `ALTER TABLE pay_slip ADD COLUMN IF NOT EXISTS jv_doc varchar(40) NULL`,
    ],
  },
  {
    version: 5,
    name: "Phase 5: loans",
    statements: [
      // A staff loan repaid by a fixed instalment taken from the salary each month from its start month. What has been taken is in pay_loan_deduct.
      `CREATE TABLE IF NOT EXISTS pay_loan (
         loan_id      serial        PRIMARY KEY,
         code         integer       NOT NULL REFERENCES pay_staff_profile (code),
         loan_date    date          NOT NULL,
         principal    numeric(14,2) NOT NULL CHECK (principal > 0),
         emi          numeric(14,2) NOT NULL CHECK (emi > 0),
         start_year   smallint      NOT NULL CHECK (start_year BETWEEN 2000 AND 2100),
         start_month  smallint      NOT NULL CHECK (start_month BETWEEN 1 AND 12),
         note         varchar(100)  NULL,
         active       boolean       NOT NULL DEFAULT true,
         created_by   varchar(60)   NULL,
         created_at   timestamp     NOT NULL DEFAULT now()
       )`,
      // Written when a slip is made and removed with it (processing again, or the period's slips going), so the loan's balance is always what the slips say.
      `CREATE TABLE IF NOT EXISTS pay_loan_deduct (
         slip_id  integer       NOT NULL REFERENCES pay_slip (slip_id) ON DELETE CASCADE,
         loan_id  integer       NOT NULL REFERENCES pay_loan (loan_id),
         amount   numeric(14,2) NOT NULL CHECK (amount > 0),
         PRIMARY KEY (slip_id, loan_id)
       )`,
      `CREATE INDEX IF NOT EXISTS ix_pay_loan_deduct_loan ON pay_loan_deduct (loan_id)`,
    ],
  },
];

export const PAYROLL_VERSION = PAYROLL_STEPS[PAYROLL_STEPS.length - 1].version;

/** The version table every company carries; made before any step, outside the steps. */
export const PAYROLL_VERSION_TABLE = `CREATE TABLE IF NOT EXISTS pay_schema_version (
  version    integer      PRIMARY KEY,
  step_name  varchar(120) NOT NULL,
  applied_at timestamp    NOT NULL DEFAULT now()
)`;

/** Tables a schema must already have for payroll to link to it. */
export const PAYROLL_NEEDS = ["account", "ac_balance", "ledger"] as const;

type Query = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };

/** A schema name that is safe to put in SET search_path: the lower-case identifiers the desktop uses. */
export function safeSchema(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`Invalid schema name: ${name}`);
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * Brings one company schema up to PAYROLL_VERSION. Call inside a transaction. Returns the versions applied (empty when it was current).
 * A schema without the accounting tables payroll links to is refused rather than half made.
 */
export async function applyPayroll(client: Query, schema: string, log: (text: string) => void = () => undefined): Promise<number[]> {
  const quoted = safeSchema(schema);
  const present = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = ANY($2)",
    [schema, [...PAYROLL_NEEDS]],
  );
  const have = new Set(present.rows.map((row) => String(row.table_name)));
  const missing = PAYROLL_NEEDS.filter((table) => !have.has(table));
  if (missing.length > 0) throw new Error(`${schema} lacks ${missing.join(", ")}; it is not a company schema`);

  await client.query(`SET LOCAL search_path TO ${quoted}, public`);
  await client.query(PAYROLL_VERSION_TABLE);
  const done = new Set((await client.query("SELECT version FROM pay_schema_version")).rows.map((row) => Number(row.version)));
  const applied: number[] = [];
  for (const step of PAYROLL_STEPS) {
    if (done.has(step.version)) continue;
    for (const statement of step.statements) await client.query(statement);
    await client.query("INSERT INTO pay_schema_version (version, step_name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING", [step.version, step.name]);
    applied.push(step.version);
    log(`  ${schema}: version ${step.version} - ${step.name}`);
  }
  return applied;
}
