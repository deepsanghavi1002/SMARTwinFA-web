import { constants, publicEncrypt, randomBytes } from "node:crypto";
import type { Client } from "pg";
import { YEAR_COUNT } from "./gst-check";
import { SYSTEM_SCHEMA } from "./master-program/session";
import type { MasterSession } from "./master-program/session";

/**
 * UTILITY > Get E Invoice Token (Main_Menu_New "EINVOICE_TOKEN"): when the company's stored e-invoice token has run out (an earlier day, or
 * today past its expiry time) a new one is asked of the Alankit gateway: the login and a new random AES key are sealed with the gateway's
 * RSA public key, and the answer's token, session key (SEK) and expiry are kept on the company with the AES key (read by Check Gst No).
 */

const AUTH_URL = "https://www.alankitgst.com/eInvoiceGateway/eivital/v1.04/auth";

/** einv_production.pem (EINVOICE/PublicKey, the same file the RPI licence reads from ConsumeEwayBillAPI). */
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAjo1FvyiKcQ9hDR2+vH0+
O2XazuLbo2bPfRiiUnpaPhE3ly+Pwh05gvEuzo2UhUIDg98cX4E0vbfWOF1po2wW
TBxb8jMY1nAJ8fz1xyHc1Wa7KZ0CeTvAGeifkMux7c22pMu6pBGJN8f3q7MnIW/u
SJloJF6+x4DZcgvnDUlgZD3Pcoi3GJF1THbWQi5pDQ8U9hZsSJfpsuGKnz41QRsK
s7Dz7qmcKT2WwN3ULWikgCzywfuuREWb4TVE2p3e9WuoDNPUziLZFeUfMP0NqYsi
GVYHs1tVI25G42AwIVJoIxOWys8Zym9AMaIBV6EMVOtQUBbNIZufix/TwqTlxNPQ
VwIDAQAB
-----END PUBLIC KEY-----`;

type Login = Readonly<{ userName: string; password: string; subscriptionKey: string; gstin: string }>;
export type TokenPlan =
  | Readonly<{ kind: "fresh"; expiry: string }>
  | Readonly<{ kind: "refresh"; login: Login; gstNo: string }>;
export type RefreshPlan = Extract<TokenPlan, { kind: "refresh" }>;

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());
const pad = (value: number) => String(value).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The expiry as the desktop shows it (dd/MMM/yyyy hh:mm:ss tt). */
function showExpiry(stamp: string): string {
  const [date, time = "00:00:00"] = stamp.split(" ");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second] = time.split(":").map(Number);
  return `${pad(day)}/${MONTHS[month - 1]}/${year} ${pad(hour % 12 === 0 ? 12 : hour % 12)}:${pad(minute)}:${pad(second)} ${hour < 12 ? "AM" : "PM"}`;
}

/** Decides, as the desktop does, whether a new token is due; throws the desktop's message when the login or the count stops it. */
export async function planToken(client: Client, session: MasterSession): Promise<TokenPlan> {
  const row = (await client.query(
    `SELECT einv_userid, einv_password, einv_domain, einv_systemid, BTRIM(COALESCE(gst_no, '')) AS gst_no,
            to_char(einv_token_date, 'YYYY-MM-DD') AS token_date, to_char(einv_token_expiry, 'YYYY-MM-DD HH24:MI:SS') AS token_expiry
       FROM ${SYSTEM_SCHEMA}.company WHERE co_key = $1`,
    [session.companyKey],
  )).rows[0];
  const login: Login = { userName: text(row?.einv_userid), password: text(row?.einv_password), subscriptionKey: text(row?.einv_domain), gstin: text(row?.einv_systemid) };
  if (login.userName === "" || login.subscriptionKey === "") throw new Error("This company has no e-invoice login, so an e-invoice token cannot be generated.");
  const allowed = YEAR_COUNT[session.companyGroup.toUpperCase()] ?? 0;
  const used = Number((await client.query(`SELECT COALESCE(einv_count, 0) AS used FROM ${SYSTEM_SCHEMA}.year_ac WHERE year_key = $1`, [session.yearKey])).rows[0]?.used ?? 0);
  if (allowed > 0 && used >= allowed) throw new Error("EINVOICE Count Complete Pl. Purchase EINVOICE Count First");

  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const nowTime = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const tokenDate = text(row?.token_date);
  const tokenExpiry = text(row?.token_expiry);
  const expiredToday = tokenDate === today && tokenExpiry.slice(11) < nowTime;
  if (tokenDate !== "" && tokenDate >= today && !expiredToday) return { kind: "fresh", expiry: tokenExpiry === "" ? tokenDate : showExpiry(tokenExpiry) };
  return { kind: "refresh", login, gstNo: text(row?.gst_no) };
}

/** What a refresh got back, ready to keep. */
export type NewToken = Readonly<{ authToken: string; sek: string; expiry: string; aesKey: string }>;

function find(value: unknown, name: string): string {
  if (value === null || typeof value !== "object") return "";
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (key.toLowerCase() === name.toLowerCase() && typeof inner === "string") return inner;
    const deeper = find(inner, name);
    if (deeper !== "") return deeper;
  }
  return "";
}

/** Asks the gateway for a token. Returns the new token, or the gateway's own answer when it did not give one. */
export async function requestToken(plan: RefreshPlan): Promise<{ token: NewToken } | { failure: string }> {
  const aes = randomBytes(32);
  const inner = JSON.stringify({ UserName: plan.login.userName, Password: plan.login.password, AppKey: aes.toString("base64"), ForceRefreshAccessToken: true });
  const data = publicEncrypt({ key: PUBLIC_KEY, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(Buffer.from(inner, "utf8").toString("base64"), "utf8")).toString("base64");
  const response = await fetch(AUTH_URL, {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${plan.login.userName}:${plan.login.password}`).toString("base64")}`,
      "Ocp-Apim-Subscription-Key": plan.login.subscriptionKey,
      gstin: plan.login.gstin,
    },
    body: JSON.stringify({ Data: data }),
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.text();
  let body: unknown = null;
  try { body = JSON.parse(result); } catch { /* shown as it came */ }
  const status = body && typeof body === "object" ? Number((body as { Status?: unknown }).Status) : NaN;
  const authToken = find(body, "AuthToken");
  const sek = find(body, "Sek");
  const expiry = find(body, "TokenExpiry");
  if (status !== 1 || authToken === "" || sek === "" || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(expiry)) return { failure: result };
  return { token: { authToken, sek, expiry: expiry.slice(0, 19).replace("T", " "), aesKey: `${[...aes].join(",")},` } };
}

/** Keeps the new token on the company (the desktop matches the company's GST number; the company's own row is matched too) and counts it. */
export async function keepToken(client: Client, session: MasterSession, plan: RefreshPlan, token: NewToken): Promise<string> {
  await client.query(`UPDATE ${SYSTEM_SCHEMA}.year_ac SET einv_count = COALESCE(einv_count, 0) + 1 WHERE year_key = $1`, [session.yearKey]);
  await client.query(
    `UPDATE ${SYSTEM_SCHEMA}.company SET einv_token = $1, einv_sek = $2, einv_aeskey = $3, einv_token_date = $4::date, einv_token_expiry = $5::timestamp
      WHERE co_key = $6 OR ($7 <> '' AND einv_systemid = $7)`,
    [token.authToken, token.sek, token.aesKey, token.expiry.slice(0, 10), token.expiry, session.companyKey, plan.gstNo],
  );
  return showExpiry(token.expiry);
}
