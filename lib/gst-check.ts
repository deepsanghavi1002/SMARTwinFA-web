import { createDecipheriv } from "node:crypto";
import type { Client } from "pg";
import { SYSTEM_SCHEMA } from "./master-program/session";
import type { MasterSession } from "./master-program/session";

/**
 * UTILITY > Check Gst No Online (Utility_Check_Gstno.cs): the party's GST number is looked up at the Alankit e-invoice gateway with the
 * company's own e-invoice login and token, the answer is decrypted with the session key (SEK), and the trade name, legal name, address,
 * state, pin code, tax payer type and status are shown. Each look-up uses one of the year's e-invoice count, as on the desktop.
 */

const GATEWAY = "https://www.alankitgst.com/eInvoiceGateway/eivital/v1.04/Master/gstin/";

/**
 * Setup_CompanySelect's EINV_Year_Count by CO_GROUP: the e-invoices a year may use. A group not listed has none (the desktop leaves it 0,
 * and the look-up then does nothing).
 */
export const YEAR_COUNT: Readonly<Record<string, number>> = {
  VINAYAK: 5000, DPA: 12000, COMET: 15000, SURF: 160000, SURFDECO: 160000, SJE: 10000, ARIHANT: 7000, USA: 50000, YOGI: 2500, RPI: 100000,
  MOONLAM: 10000, MSUR: 5000, PRITHVI: 30000, OSWAL: 5000, RAINCOAT: 3000, SVC: 3000, ARHAMELE: 2000, RAJGIRI: 10000, SKTIM: 2000, PRIHARI: 3500,
  MANEK: 3500, HITANSHI: 35000, RATNASH: 5000, METADECOR: 3000, ANGEL: 3000, GOLDEN: 3000, EVADECOR: 25000, SIGNATURE: 1000, KITOX: 2000, RAJDECOR: 2000,
};

export type GstDetail = Readonly<{
  name: string; legalName: string; address1: string; address2: string; address3: string; street: string; location: string;
  stateCode: string; pinCode: string; taxPayerType: string; status: string;
}>;

type Login = Readonly<{ userName: string; password: string; subscriptionKey: string; gstin: string; token: string; sek: string; aesKey: string }>;

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());

/** Reads the company's e-invoice login and counts one look-up against the year (the desktop counts before it calls). */
export async function reserveLookup(client: Client, session: MasterSession): Promise<Login> {
  const row = (await client.query(
    `SELECT einv_userid, einv_password, einv_domain, einv_systemid, einv_token, einv_sek, einv_aeskey FROM ${SYSTEM_SCHEMA}.company WHERE co_key = $1`,
    [session.companyKey],
  )).rows[0];
  const login: Login = {
    userName: text(row?.einv_userid), password: text(row?.einv_password), subscriptionKey: text(row?.einv_domain),
    gstin: text(row?.einv_systemid), token: text(row?.einv_token), sek: text(row?.einv_sek), aesKey: text(row?.einv_aeskey),
  };
  if (login.userName === "" || login.subscriptionKey === "") throw new Error("This company has no e-invoice login, so a GST number cannot be checked online.");
  const allowed = YEAR_COUNT[session.companyGroup.toUpperCase()] ?? 0;
  const used = Number((await client.query(`SELECT COALESCE(einv_count, 0) AS used FROM ${SYSTEM_SCHEMA}.year_ac WHERE year_key = $1`, [session.yearKey])).rows[0]?.used ?? 0);
  if (allowed > 0 && used >= allowed) throw new Error("E-INVOICE Count Complete Please Purchase E-INVOICE First");
  if (login.token === "" || login.sek === "" || login.aesKey === "") throw new Error("There is no e-invoice token for this company yet. Generate the e-invoice token first.");
  await client.query(`UPDATE ${SYSTEM_SCHEMA}.year_ac SET einv_count = COALESCE(einv_count, 0) + 1 WHERE year_key = $1`, [session.yearKey]);
  return login;
}

/** AES-256 ECB with PKCS7 padding, the gateway's way of sealing the SEK and the answer. */
function aesDecrypt(cipherText: string, key: Buffer): Buffer {
  const decipher = createDecipheriv("aes-256-ecb", key, null);
  return Buffer.concat([decipher.update(Buffer.from(cipherText, "base64")), decipher.final()]);
}

export async function lookupGst(login: Login, gstNo: string): Promise<GstDetail> {
  const response = await fetch(GATEWAY + encodeURIComponent(gstNo), {
    method: "GET",
    headers: {
      Accept: "*/*",
      Authorization: `Basic ${Buffer.from(`${login.userName}:${login.password}`).toString("base64")}`,
      "Ocp-Apim-Subscription-Key": login.subscriptionKey,
      Gstin: login.gstin,
      user_name: login.userName,
      AuthToken: login.token,
    },
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.text();
  let body: { Status?: unknown; Data?: unknown; ErrorDetails?: unknown } | null = null;
  try { body = JSON.parse(result); } catch { /* shown as it came */ }
  if (!body || Number(body.Status) !== 1 || typeof body.Data !== "string") throw new Error(`Check Gst No Detail Error....${result}`);

  const aesKey = Buffer.from(login.aesKey.split(",").filter((part) => part.trim() !== "").map((part) => Number(part)));
  if (aesKey.length !== 32) throw new Error("The stored e-invoice session key is not valid. Generate the e-invoice token again.");
  const sek = aesDecrypt(login.sek, aesKey);
  const detail = JSON.parse(aesDecrypt(body.Data, sek).toString("utf8")) as Record<string, unknown>;
  return {
    name: text(detail.TradeName), legalName: text(detail.LegalName), address1: text(detail.AddrBnm), address2: text(detail.AddrBno), address3: text(detail.AddrFlno),
    street: text(detail.AddrSt), location: text(detail.AddrLoc), stateCode: text(detail.StateCode), pinCode: text(detail.AddrPncd), taxPayerType: text(detail.TxpType), status: text(detail.Status),
  };
}
