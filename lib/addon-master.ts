import { readOnly } from "./db";

/**
 * The Addon sub master, read from the company's own schema.
 *
 * Two tables carry it, exactly as the desktop's MstAddonSub reads them:
 *
 *   addon_fld  one row per addon - "Area", "Transport", "Sales Man". fiel_key is
 *              the id the records point at. fiel_type 'M' marks the addons that
 *              own a list of records; 'I' ones are single inputs typed during
 *              entry and have no sub master.
 *   addon_sub  the records themselves, para_id pointing back at fiel_key.
 *              sub_pos 'A' is live, 'D' is deleted and must stay hidden.
 *
 * The schema is the company's CO_DATANAME, passed in per request from the
 * startup selection. It is never hardcoded: a different company opens a
 * different schema with no change to this file.
 */

export type AddonGroup = Readonly<{
  id: number;
  name: string;
  short: string;
  /** Live records this addon holds, so the caller can show a count. */
  rows: number;
}>;

/** Field keys match the grid and form; values arrive as text ready to display. */
export type AddonRow = Readonly<{
  id: number;
  groupId: number;
  name: string;
  shortName: string;
  openingBalance: string;
  margin: string;
  address1: string;
  address2: string;
  address3: string;
  city: string;
  pincode: string;
  district: string;
  remark: string;
  contact: string;
  telephone: string;
  mobile: string;
  fax: string;
  localCode: string;
  stdCode: string;
  pan: string;
  aadhaar: string;
  vat: string;
  cst: string;
  gst: string;
  state: string;
  email: string;
  website: string;
  startDate: string;
  lastDate: string;
}>;

/**
 * A schema name cannot travel as a bind parameter, so it is checked against the
 * schemas that actually exist before it is ever put into SQL text.
 */
async function assertSchema(schema: string) {
  const candidate = schema.trim().toLowerCase();
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(candidate)) {
    throw new Error("The company schema name is not a valid PostgreSQL identifier.");
  }
  const found = await readOnly(async (client) => {
    const result = await client.query(
      "SELECT 1 FROM information_schema.schemata WHERE schema_name = $1",
      [candidate],
    );
    return result.rowCount === 1;
  });
  if (!found) {
    throw new Error(`This installation carries no data for company schema "${candidate}".`);
  }
  return candidate;
}

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());

/** Dates are stored as timestamps but the master only ever shows the day. */
function day(value: unknown) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

export async function readAddonGroups(schema: string): Promise<AddonGroup[]> {
  const safe = await assertSchema(schema);
  return readOnly(async (client) => {
    const result = await client.query(`
      SELECT field.fiel_key,
             BTRIM(COALESCE(field.fiel_name, ''))  AS fiel_name,
             BTRIM(COALESCE(field.fiel_short, '')) AS fiel_short,
             (SELECT COUNT(*) FROM "${safe}".addon_sub sub
               WHERE sub.para_id = field.fiel_key AND sub.sub_pos = 'A')::int AS rows
      FROM "${safe}".addon_fld AS field
      WHERE field.fiel_pos = 'A' AND field.fiel_type = 'M'
      ORDER BY BTRIM(COALESCE(field.fiel_name, '')), field.fiel_key
    `);
    return result.rows.map((row) => ({
      id: Number(row.fiel_key),
      name: text(row.fiel_name) || `Addon ${row.fiel_key}`,
      short: text(row.fiel_short),
      rows: Number(row.rows ?? 0),
    }));
  });
}

export async function readAddonRecords(schema: string, groupId: number): Promise<AddonRow[]> {
  const safe = await assertSchema(schema);
  return readOnly(async (client) => {
    // profit_margin is a money column; casting to numeric keeps a currency
    // symbol and thousands separators out of the value.
    const result = await client.query(`
      SELECT sub_code, para_id, sub_name, short_name,
             profit_margin::numeric::text AS profit_margin,
             address_1, address_2, address_3, city, pin_code, district, add_remark,
             contact, tel_no, mobile_no, fax, local_code, std_code,
             pan_no, aadhar_no, lst_no, cst_no, gst_no, state_id,
             e_mail, website, sub_startdt, sub_lastdt
      FROM "${safe}".addon_sub
      WHERE para_id = $1 AND sub_pos = 'A'
      ORDER BY BTRIM(COALESCE(sub_name, '')), sub_code
    `, [groupId]);

    return result.rows.map((row) => ({
      id: Number(row.sub_code),
      groupId: Number(row.para_id),
      name: text(row.sub_name),
      shortName: text(row.short_name),
      // addon_sub carries no opening balance; the column belongs to the account master.
      openingBalance: "",
      margin: text(row.profit_margin),
      address1: text(row.address_1),
      address2: text(row.address_2),
      address3: text(row.address_3),
      city: text(row.city),
      pincode: text(row.pin_code),
      district: text(row.district),
      remark: text(row.add_remark),
      contact: text(row.contact),
      telephone: text(row.tel_no),
      mobile: text(row.mobile_no),
      fax: text(row.fax),
      localCode: text(row.local_code),
      stdCode: text(row.std_code),
      pan: text(row.pan_no),
      aadhaar: text(row.aadhar_no),
      vat: text(row.lst_no),
      cst: text(row.cst_no),
      gst: text(row.gst_no),
      // This installation carries no state lookup table, so the stored id is shown as it is.
      state: text(row.state_id) === "0" ? "" : text(row.state_id),
      email: text(row.e_mail),
      website: text(row.website),
      startDate: day(row.sub_startdt),
      lastDate: day(row.sub_lastdt),
    }));
  });
}
