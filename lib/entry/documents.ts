import type { Client } from "pg";
import { Loader } from "../master-program/load";
import { toInt, toText } from "../master-program/legacy";
import { bookContext } from "./invoice";
import type { EntryOption } from "./types";

/**
 * The Upload Document window of Comman_Entry (btn_UploadDocument_Click / GridForm): up to five JPEG or PDF files kept with an
 * entry in <company>_IMAGE.DOCUMENT_UPLOAD (ENTRY_MODE L for a ledger entry, P for a stock register's process row; ENTRY_ID the
 * entry's own key). Saving follows Comman_Entry's rules: a kept row whose path is blanked is deleted, a kept row with a path is
 * updated, a new row with a path is inserted.
 */

type Row = Record<string, unknown>;
const field = Loader.field;

/** Largest file taken (the desktop reads the whole file into the row; a browser request carries it as text, so it is limited). */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const DOCUMENT_ROWS = 5;

export type DocumentRow = Readonly<{ key: number; path: string; remark: string; hasFile: boolean }>;
export type DocumentInput = Readonly<{ key: number; path: string; remark: string; fileName?: string; /** base64 of a file picked now; absent keeps the stored file. */ data?: string }>;

const imageSchema = (loader: Loader) => `${loader.session.companySchema}_image`;

async function modeOf(loader: Loader, entryName: string, firstCombo: EntryOption): Promise<"L" | "P"> {
  return (await bookContext(loader, entryName, firstCombo)).values.bookActual ? "L" : "P";
}

/** Whether the company keeps uploaded documents (setup DOC_UPLOAD has a Y). */
export function documentsEnabled(loader: Loader): boolean {
  return toText(loader.session.setup.doc_upload).toUpperCase().includes("Y");
}

export async function listDocuments(loader: Loader, entryName: string, firstCombo: EntryOption, entryId: number): Promise<DocumentRow[]> {
  if (!documentsEnabled(loader)) throw new Error("Document upload is not switched on for this company");
  const mode = await modeOf(loader, entryName, firstCombo);
  const result = await loader.client.query(
    `SELECT doc_image_key, COALESCE(document_path, '') AS document_path, COALESCE(document_remark, '') AS document_remark, (document_image IS NOT NULL AND length(document_image) > 0) AS has_file
       FROM ${imageSchema(loader)}.document_upload WHERE entry_mode = $1 AND entry_id = $2 ORDER BY doc_image_key`, [mode, entryId]);
  return result.rows.map((row: Row) => ({ key: toInt(row.doc_image_key), path: toText(row.document_path).trim(), remark: toText(row.document_remark).trim(), hasFile: row.has_file === true }));
}

/** F7 in the window: the stored file of one row. */
export async function documentFile(loader: Loader, entryName: string, firstCombo: EntryOption, entryId: number, key: number): Promise<{ name: string; type: string; data: string }> {
  if (!documentsEnabled(loader)) throw new Error("Document upload is not switched on for this company");
  const mode = await modeOf(loader, entryName, firstCombo);
  const row = (await loader.client.query(
    `SELECT document_path, document_image FROM ${imageSchema(loader)}.document_upload WHERE doc_image_key = $1 AND entry_mode = $2 AND entry_id = $3`, [key, mode, entryId])).rows[0] as Row | undefined;
  const image = row?.document_image;
  if (!row || !(image instanceof Buffer) || image.length === 0) throw new Error("No file is stored for this row");
  const path = toText(row.document_path).trim();
  const name = path.split(/[\\/]/).pop() || "document";
  return { name, type: /\.pdf$/i.test(name) ? "application/pdf" : "image/jpeg", data: image.toString("base64") };
}

/** Applies the window's rows to an entry (inside the caller's transaction). */
export async function saveDocuments(client: Client, loader: Loader, entryName: string, firstCombo: EntryOption, entryId: number, docs: readonly DocumentInput[]): Promise<{ inserted: number; updated: number; deleted: number }> {
  if (!documentsEnabled(loader)) throw new Error("Document upload is not switched on for this company");
  if (!Number.isInteger(entryId) || entryId <= 0) throw new Error("Open the entry first");
  const mode = await modeOf(loader, entryName, firstCombo);
  const table = `${imageSchema(loader)}.document_upload`;
  const kept = new Set(((await client.query(`SELECT doc_image_key FROM ${table} WHERE entry_mode = $1 AND entry_id = $2`, [mode, entryId])).rows as Row[]).map((row) => toInt(row.doc_image_key)));
  const counts = { inserted: 0, updated: 0, deleted: 0 };
  for (const doc of docs.slice(0, 20)) {
    const path = String(doc.path ?? "").trim().slice(0, 500);
    const remark = String(doc.remark ?? "").trim().slice(0, 500);
    const key = Number(doc.key) || 0;
    const bytes = doc.data ? Buffer.from(doc.data, "base64") : null;
    if (bytes && bytes.length > MAX_DOCUMENT_BYTES) throw new Error(`${path || "The file"} is larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB`);
    if (path !== "" && !/\.(jpe?g|pdf)$/i.test(path)) throw new Error(`${path}: only JPEG and PDF files are kept`);
    if (key > 0) {
      if (!kept.has(key)) continue;
      if (path === "") { await client.query(`DELETE FROM ${table} WHERE doc_image_key = $1`, [key]); counts.deleted += 1; continue; }
      if (bytes) await client.query(`UPDATE ${table} SET document_path = $2, document_remark = $3, document_image = $4 WHERE doc_image_key = $1`, [key, path, remark || null, bytes]);
      else await client.query(`UPDATE ${table} SET document_path = $2, document_remark = $3 WHERE doc_image_key = $1`, [key, path, remark || null]);
      counts.updated += 1;
    } else if (path !== "") {
      if (!bytes) throw new Error(`${path}: the file was not sent`);
      await client.query(`INSERT INTO ${table} (entry_id, document_path, entry_mode, document_remark, document_image) VALUES ($1, $2, $3, $4, $5)`, [entryId, path, mode, remark || null, bytes]);
      counts.inserted += 1;
    }
  }
  const left = Number((await client.query(`SELECT COUNT(*) AS n FROM ${table} WHERE entry_mode = $1 AND entry_id = $2`, [mode, entryId])).rows[0]?.n ?? 0);
  if (left > DOCUMENT_ROWS) throw new Error(`An entry keeps ${DOCUMENT_ROWS} documents at most (this would make ${left}). Blank a path to remove one first.`);
  return counts;
}

/** The entry was deleted: its documents go with it (Btn_Delete → Delete from DOCUMENT_UPLOAD). */
export async function deleteDocuments(client: Client, loader: Loader, entryName: string, firstCombo: EntryOption, entryId: number): Promise<void> {
  if (!documentsEnabled(loader)) return;
  const mode = await modeOf(loader, entryName, firstCombo);
  await client.query(`DELETE FROM ${imageSchema(loader)}.document_upload WHERE entry_mode = $1 AND entry_id = $2`, [mode, entryId]);
}
