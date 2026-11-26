#!/usr/bin/env node

/**
 * The report mailer: sends the emails asked for with Send Now (docs/operations/report-email.md).
 *
 * It asks the web server for the next waiting report, sends the file it gets through the company's SMTP account, and tells the server what
 * happened. Run it on one PC only.
 *
 *   node --experimental-strip-types scripts/report-mailer.mts            keep running
 *   node --experimental-strip-types scripts/report-mailer.mts --check    only sign in to the mail server, send nothing
 *
 * Settings from .env.local (or the environment): SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, SMTP_FROM,
 * REPORT_MAILER_TOKEN, REPORT_MAILER_SERVER (default http://127.0.0.1:3000), SMTP_MAX_MB (default 15).
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import nodemailer from "nodemailer";
import { sendMailJob } from "../lib/report-mail/send.ts";
import type { MailJob } from "../lib/report-mail/send.ts";
import { MIN_TOKEN_LENGTH } from "../lib/report-mail/token.ts";

const POLL_MS = 30_000;
const REPORT_TRIES = 5;

function settings(): Record<string, string | undefined> {
  const file = path.resolve(".env.local");
  const local = fs.existsSync(file)
    ? Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => /^\w+=/.test(line)).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]))
    : {};
  return { ...local, ...process.env };
}

const env = settings();

function need(name: string): string {
  const value = env[name]?.trim();
  if (!value) { console.error(`${name} is not set in .env.local (see docs/operations/report-email.md)`); process.exit(2); }
  return value;
}

const log = (message: string) => console.log(`${new Date().toISOString()}  ${message}`);
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const port = Number(env.SMTP_PORT || 587);
const secure = env.SMTP_SECURE ? env.SMTP_SECURE.toLowerCase() === "true" : port === 465;
const transport = nodemailer.createTransport({
  host: need("SMTP_HOST"),
  port,
  secure,
  // Without TLS from the start, the connection must be upgraded before anything is sent; certificates are always checked.
  requireTLS: !secure,
  auth: { user: need("SMTP_USER"), pass: need("SMTP_PASSWORD") },
  connectionTimeout: 30_000,
  greetingTimeout: 30_000,
  socketTimeout: 120_000,
});
const from = env.SMTP_FROM?.trim() || need("SMTP_USER");

if (process.argv.includes("--check")) {
  try { await transport.verify(); log("The mail server accepted the sign-in. Nothing was sent."); process.exit(0); }
  catch (error) { log(`The mail server refused: ${reason(error)}`); process.exit(1); }
}

const token = need("REPORT_MAILER_TOKEN");
if (token.length < MIN_TOKEN_LENGTH) { console.error(`REPORT_MAILER_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`); process.exit(2); }
const server = (env.REPORT_MAILER_SERVER?.trim() || "http://127.0.0.1:3000").replace(/\/+$/, "");
const maxBytes = (Number(env.SMTP_MAX_MB) > 0 ? Number(env.SMTP_MAX_MB) : 15) * 1024 * 1024;

async function call(body: Record<string, unknown>): Promise<{ status: number; body: { job?: MailJob | null; more?: boolean; error?: string } }> {
  const response = await fetch(`${server}/api/report-mailer`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) as { job?: MailJob | null; more?: boolean; error?: string } };
}

/** The result is told again a few times: a job whose result never arrives is shown as "check inbox" and is not sent again. */
async function report(job: MailJob, outcome: string, error: string): Promise<void> {
  for (let attempt = 1; attempt <= REPORT_TRIES; attempt += 1) {
    try {
      const reply = await call({ action: "result", jobId: job.id, jobKey: job.key, outcome, error });
      if (reply.status === 200 || reply.status === 409) return;
    } catch { /* the server is away: try again */ }
    await wait(10_000);
  }
  log(`Job ${job.id}: the result (${outcome}) could not be told to the server`);
}

log(`Report mailer started; server ${server}`);
let lastProblem = "";
for (;;) {
  let more = false;
  try {
    const reply = await call({ action: "next" });
    if (reply.status !== 200) throw new Error(reply.status === 404 ? "The server has no REPORT_MAILER_TOKEN set (or needs a restart)" : reply.status === 401 ? "The server refused the token" : `The server answered ${reply.status}`);
    lastProblem = "";
    more = reply.body.more === true;
    const job = reply.body.job;
    if (job) {
      const result = await sendMailJob(job, { from, maxBytes, transport });
      log(`Job ${job.id}: ${result.outcome}${result.error ? ` (${result.error})` : ""}`);
      await report(job, result.outcome, result.error);
      more = true;
    }
  } catch (error) {
    // The same trouble is written once, not every 30 seconds.
    if (reason(error) !== lastProblem) log(`Waiting: ${reason(error)}`);
    lastProblem = reason(error);
  }
  if (!more) await wait(POLL_MS);
}
