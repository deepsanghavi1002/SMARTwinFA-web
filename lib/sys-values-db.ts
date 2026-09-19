import type { Client } from "pg";
import type { SysValueLookups } from "./sys-values";

/**
 * The three lookups Func_ReplaceSysVal_CtrlValue makes against addon_fld, run on the
 * connection the caller already holds so they share its request and its transaction.
 *
 * The desktop builds these with the id pasted into the text; here it is a parameter.
 * account_help is a bit column in PostgreSQL, so it is compared with B'1', not 1.
 */
export function sysValueLookups(client: Client, companySchema: string): SysValueLookups {
  if (!/^[A-Za-z0-9_]+$/.test(companySchema)) throw new Error("The company schema name is not valid");
  const schema = companySchema;

  const firstSave = async (text: string, params: unknown[]) => {
    const result = await client.query(text, params);
    const save = result.rows[0]?.fiel_save;
    return save === null || save === undefined ? null : String(save);
  };

  return {
    async accountHelpAddons() {
      const result = await client.query(
        `SELECT fiel_save, fiel_short FROM ${schema}.addon_fld
          WHERE fiel_relate = 'A' AND fiel_pos <> 'D' AND account_help = B'1'`,
      );
      return result.rows.map((row) => ({ save: String(row.fiel_save ?? ""), short: String(row.fiel_short ?? "") }));
    },
    addonSaveByKey(fielKey) {
      return firstSave(`SELECT fiel_save FROM ${schema}.addon_fld WHERE fiel_key = $1`, [fielKey]);
    },
    addonSaveBySubCode(subCode) {
      return firstSave(
        `SELECT fiel_save FROM ${schema}.addon_fld
          WHERE fiel_key = (SELECT para_id FROM ${schema}.addon_sub WHERE sub_code = $1)`,
        [subCode],
      );
    },
  };
}
