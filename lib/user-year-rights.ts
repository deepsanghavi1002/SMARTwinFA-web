import type { Client } from "pg";
import { SYSTEM_SCHEMA } from "./master-program/session";
import { toText } from "./master-program/legacy";

/**
 * Setup > Security > User Year Rights (Utility_User_Year_Rights.cs): which financial years a user may open. The years are the distinct
 * smart_system.year_ac texts; the user's choice is the comma separated list kept in smart_system.user_master.user_year.
 */

export type YearUser = Readonly<{ name: string; no: number }>;

export async function yearUsers(client: Client): Promise<YearUser[]> {
  const result = await client.query(`SELECT user_no, login_name FROM ${SYSTEM_SCHEMA}.user_master WHERE user_pos <> 'D' ORDER BY login_name`);
  return result.rows.map((row) => ({ name: toText(row.login_name).trim(), no: Number(row.user_no) }));
}

/** Every year and the years the user already has. */
export async function loadYearRights(client: Client, userNo: number): Promise<{ years: string[]; allowed: string[] }> {
  const user = (await client.query(`SELECT user_year FROM ${SYSTEM_SCHEMA}.user_master WHERE user_no = $1 AND user_pos <> 'D'`, [userNo])).rows[0];
  if (!user) throw new Error("User not found");
  const years = (await client.query(`SELECT DISTINCT BTRIM(year_ac) AS year_ac FROM ${SYSTEM_SCHEMA}.year_ac WHERE BTRIM(COALESCE(year_ac, '')) <> '' ORDER BY 1`)).rows.map((row) => toText(row.year_ac).trim());
  const allowed = toText(user.user_year).split(",").map((year) => year.trim()).filter((year) => year !== "");
  return { years, allowed };
}

export async function saveYearRights(client: Client, userNo: number, years: readonly string[]): Promise<void> {
  const clean: string[] = [];
  for (const year of years) {
    const text = year.trim();
    if (text !== "" && !text.includes(",") && !clean.includes(text)) clean.push(text);
  }
  const updated = await client.query(`UPDATE ${SYSTEM_SCHEMA}.user_master SET user_year = $1 WHERE user_no = $2 AND user_pos <> 'D'`, [clean.join(","), userNo]);
  if (updated.rowCount === 0) throw new Error("User not found");
}
