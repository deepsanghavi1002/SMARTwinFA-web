import type { Client } from "pg";
import { SYSTEM_SCHEMA } from "./master-program/session";
import { toText } from "./master-program/legacy";

/**
 * Setup > Security > User Dashboard Rights (Utility_User_Dashboard_Rights.cs): which dashboard blocks (smart_system.dashboard_detail) a
 * user sees, in what order and with which colours (smart_system.user_dashboard). A ticked row is inserted or updated; an unticked row
 * has its user_dashboard record deleted.
 */

export type DashboardUser = Readonly<{ name: string; no: number }>;
export type DashboardRightRow = Readonly<{ name: string; allowed: boolean; order: string; dashboardColor: string; cardColor: string; chartColor: string; gridColor: string; headerColor: string }>;

export async function dashboardUsers(client: Client): Promise<DashboardUser[]> {
  const result = await client.query(`SELECT user_no, login_name FROM ${SYSTEM_SCHEMA}.user_master WHERE user_pos <> 'D' ORDER BY login_name`);
  return result.rows.map((row) => ({ name: toText(row.login_name).trim(), no: Number(row.user_no) }));
}

export async function loadDashboardRights(client: Client, userNo: number): Promise<DashboardRightRow[]> {
  const result = await client.query(
    `SELECT dd.dashboard_menu AS name, MAX(CASE WHEN ud.dashboard_allowed = 'Yes' THEN 1 ELSE 0 END) AS allowed, MIN(ud.display_order) AS display_order,
            MIN(ud.dashboard_bg_color) AS dashboard_color, MIN(ud.card_bg_color) AS card_color, MIN(ud.chart_bg_color) AS chart_color,
            MIN(ud.grid_bg_color) AS grid_color, MIN(ud.header_bg_color) AS header_color
       FROM ${SYSTEM_SCHEMA}.dashboard_detail dd
       LEFT JOIN ${SYSTEM_SCHEMA}.user_dashboard ud ON dd.dashboard_menu = ud.dashboard_menu AND ud.user_no = $1
      GROUP BY dd.dashboard_menu
      ORDER BY MIN(dd.display_order), dd.dashboard_menu`, [userNo]);
  return result.rows.map((row) => ({
    name: toText(row.name).trim(), allowed: Number(row.allowed) === 1, order: row.display_order === null ? "" : String(row.display_order),
    dashboardColor: toText(row.dashboard_color).trim(), cardColor: toText(row.card_color).trim(), chartColor: toText(row.chart_color).trim(),
    gridColor: toText(row.grid_color).trim(), headerColor: toText(row.header_color).trim(),
  }));
}

export async function saveDashboardRights(client: Client, userNo: number, rows: readonly DashboardRightRow[]): Promise<void> {
  const user = (await client.query(`SELECT 1 FROM ${SYSTEM_SCHEMA}.user_master WHERE user_no = $1 AND user_pos <> 'D'`, [userNo])).rows[0];
  if (!user) throw new Error("User not found");
  const known = new Set((await client.query(`SELECT dashboard_menu FROM ${SYSTEM_SCHEMA}.dashboard_detail`)).rows.map((row) => toText(row.dashboard_menu).trim()));
  const blank = (text: string) => (text.trim() === "" ? null : text.trim());
  for (const row of rows) {
    if (!known.has(row.name)) continue;
    const order = row.order.trim() === "" ? null : Math.trunc(Number(row.order));
    if (order !== null && !Number.isFinite(order)) throw new Error(`Display Order of ${row.name} must be a number`);
    const found = (await client.query(`SELECT user_dashboard_key FROM ${SYSTEM_SCHEMA}.user_dashboard WHERE dashboard_menu = $1 AND user_no = $2 ORDER BY user_dashboard_key LIMIT 1`, [row.name, userNo])).rows[0];
    if (!row.allowed) {
      if (found) await client.query(`DELETE FROM ${SYSTEM_SCHEMA}.user_dashboard WHERE dashboard_menu = $1 AND user_no = $2`, [row.name, userNo]);
      continue;
    }
    const colours = [blank(row.dashboardColor), blank(row.cardColor), blank(row.chartColor), blank(row.gridColor), blank(row.headerColor)];
    if (found) {
      await client.query(`UPDATE ${SYSTEM_SCHEMA}.user_dashboard SET dashboard_allowed = 'Yes', display_order = $1, dashboard_bg_color = $2, card_bg_color = $3, chart_bg_color = $4, grid_bg_color = $5, header_bg_color = $6
        WHERE dashboard_menu = $7 AND user_no = $8`, [order, ...colours, row.name, userNo]);
    } else {
      await client.query(`INSERT INTO ${SYSTEM_SCHEMA}.user_dashboard (user_dashboard_key, dashboard_menu, dashboard_allowed, user_no, display_order, dashboard_bg_color, card_bg_color, chart_bg_color, grid_bg_color, header_bg_color)
        VALUES ((SELECT COALESCE(MAX(user_dashboard_key), 0) + 1 FROM ${SYSTEM_SCHEMA}.user_dashboard), $1, 'Yes', $2, $3, $4, $5, $6, $7, $8)`, [row.name, userNo, order, ...colours]);
    }
  }
}
