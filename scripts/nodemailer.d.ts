/** The small part of nodemailer the report mailer uses (the package ships no types). */
declare module "nodemailer" {
  import type { Transport } from "../lib/report-mail/send.ts";
  const nodemailer: { createTransport: (options: Record<string, unknown>) => Transport };
  export default nodemailer;
}
