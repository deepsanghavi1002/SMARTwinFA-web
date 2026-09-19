import { toInt, toText } from "./legacy";
import { Loader } from "./load";
import { readRights } from "./session";

/**
 * The smaller Master_ProgramGrid features that read on their own: the module password the
 * menu asks before the form opens, the product image tab, the edit-log viewer and the
 * account zoom from an entry or report.
 */

const field = Loader.field;
const identifier = /^[a-z_][a-z0-9_]*$/;

/**
 * Z_Frm_Password for Module_Password: Main_Menu_New decodes u_module_pass and the form
 * compares what was typed. The password never leaves the server; the screen only learns
 * whether it matched.
 */
export async function verifyModulePassword(loader: Loader, menuShortName: string, typed: string): Promise<{ ok: boolean; message: string }> {
  const rights = await readRights(loader.client, loader.session, `Menu-${menuShortName}`);
  if (rights.modulePassword === "" || rights.modulePassword === typed) return { ok: true, message: "" };
  return { ok: false, message: "Incorrect Password... Enter Again" };
}

/** C1dg_UpdateGrid_BeforeRowColChange, image part: product_image.prod_photo for program 8. */
export async function productImage(loader: Loader, prodKey: number): Promise<{ dataUrl: string; fileName: string } | null> {
  const { session } = loader;
  if (!session.flags.imageReq || prodKey <= 0) return null;
  const rows = await loader.readTable(`SELECT prod_photo, image_file_name FROM ${session.companySchema}.product_image WHERE prod_id = $1 LIMIT 1`, [prodKey]);
  const photo = field(rows?.[0], "prod_photo");
  if (!(photo instanceof Uint8Array) || photo.length === 0) return null;
  const bytes = photo;
  const type = bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png"
    : bytes[0] === 0x47 && bytes[1] === 0x49 ? "image/gif"
    : bytes[0] === 0x42 && bytes[1] === 0x4d ? "image/bmp"
    : "image/jpeg";
  return { dataUrl: `data:${type};base64,${base64(bytes)}`, fileName: toText(field(rows?.[0], "image_file_name")) };
}

/** Base64 without Buffer, which the Workers runtime does not always provide. */
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

export type MasterLogTable = Readonly<{ columns: readonly string[]; rows: readonly (readonly string[])[]; message: string }>;

type LogRecord = { lmaster_mode: string; lmaster_top: string; lmaster_new_grid: string };

/**
 * btn_Master_EditLog_Click: ShowGridForm1 with Read_logdata and Write_logdata.
 *
 * The desktop reads LOG_ALLMASTER in <company>_BIGLOG with OPENJSON over LMASTER_TOP and
 * LMASTER_NEW_GRID. Each record's JSON is an array of objects; a property whose name starts
 * with "!" names the position the following properties belong to, and in an Edit record a
 * "!*" property starts the next edit column. The first record (the Add) fills Add_Value,
 * each edit its own Edit_Value_n. Nothing is shown unless the master's Add was logged.
 */
export async function readMasterLog(loader: Loader, programId: number, firstComboText: string, code: number): Promise<MasterLogTable> {
  const { session } = loader;
  const schema = `${session.companySchema}_biglog`;
  const empty = (message: string): MasterLogTable => ({ columns: [], rows: [], message });
  if (code <= 0) return empty("");
  if (!identifier.test(schema)) return empty("The log database name is not valid");
  const exists = await loader.readTable("SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'log_allmaster'", [schema]);
  if (!exists) return empty(`No master log: ${schema}.log_allmaster does not exist`);

  const counts = await loader.readTable(`SELECT COUNT(*) FILTER (WHERE lmaster_mode = 'A') AS added, COUNT(*) AS total FROM ${schema}.log_allmaster WHERE lmaster_id = $1 AND lmaster_code = $2`, [programId, code]);
  const added = toInt(field(counts?.[0], "added"));
  const total = toInt(field(counts?.[0], "total"));
  if (added === 0) return empty("No log was saved when this master was added");

  const records = (await loader.readTable(
    `SELECT lmaster_mode, lmaster_top::text AS lmaster_top, lmaster_new_grid::text AS lmaster_new_grid FROM ${schema}.log_allmaster
      WHERE lmaster_firstname = $1 AND lmaster_id = $2 AND lmaster_code = $3 ORDER BY lmaster_mode`,
    [firstComboText, programId, code],
  )) as LogRecord[] | null;

  const columns = ["FieldName", "Add_Value", ...Array.from({ length: Math.max(0, total - 1) }, (_, index) => `Edit_Value_${index + 1}`)];
  const table = new Map<string, string[]>();
  const parse = (text: string): Record<string, unknown>[] => {
    try {
      const value = JSON.parse(text) as unknown;
      return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null) : [];
    } catch {
      return [];
    }
  };

  // Read_logdata runs once for LMASTER_TOP, then for LMASTER_NEW_GRID, each counting edits afresh.
  for (const [column, prefix] of [["lmaster_top", "TOP"], ["lmaster_new_grid", "BODY"]] as const) {
    let editCount = 0;
    let position = "";
    for (const record of records ?? []) {
      const mode = toText(record.lmaster_mode);
      for (const item of parse(toText(record[column]))) {
        for (const [name, raw] of Object.entries(item)) {
          const value = raw === null || raw === undefined ? "" : String(raw);
          if (name.startsWith("!*") && mode === "E") editCount += 1;
          if (name.startsWith("!")) { position = value; continue; }
          const sort = `${prefix}${position}${name}`;
          if (mode === "A") {
            const row = Array<string>(columns.length).fill("");
            row[0] = name;
            row[1] = value;
            table.set(sort, row);
          } else if (mode === "E") {
            const at = columns.indexOf(`Edit_Value_${editCount}`);
            let row = table.get(sort);
            if (!row) { row = Array<string>(columns.length).fill(""); row[0] = name; table.set(sort, row); }
            if (at >= 0) row[at] = value;
          }
        }
      }
    }
  }
  return { columns, rows: [...table.values()], message: "" };
}

/** Master_ProgramGrid_Activated: Zoom_Book names the account book the group combo selects. */
export async function zoomBook(loader: Loader, book: number): Promise<{ text: string; value: string } | null> {
  const rows = await loader.readTable(`SELECT name, code FROM ${loader.session.companySchema}.account WHERE code = $1`, [book]);
  if (!rows) return null;
  return { text: toText(field(rows[0], "name")), value: String(toInt(field(rows[0], "code"))) };
}
