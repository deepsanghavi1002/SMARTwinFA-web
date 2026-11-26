# Emailing reports: setup and use

A saved **Trial Balance** view can be emailed with **Send Now** as PDF or Excel. Timed sending is not built yet.
Design and limits: `docs/SCHEDULED-REPORTS-PLAN.md`.

## Set up (once)

Do this on **one** PC: the one that runs the web server.

1. In PowerShell:

   ```powershell
   cd D:\SMARTwinFA-web; npm install
   ```

2. Open `.env.local` and add these lines with your own values. Type the password yourself. Do not send it in
   chat or put it in any other file.

   ```text
   SMTP_HOST=smtp.example.com
   SMTP_PORT=587
   SMTP_USER=reports@example.com
   SMTP_PASSWORD=
   SMTP_FROM=SMARTwinFA Reports <reports@example.com>
   REPORT_MAILER_TOKEN=
   ```

   - Port 587 upgrades to an encrypted connection; port 465 is encrypted from the start. Unencrypted sending is
     refused.
   - Gmail: `smtp.gmail.com`, port 587, and an **App Password**, not the normal password.
   - `REPORT_MAILER_TOKEN` is any random text of 32 characters or more. This makes one:

     ```powershell
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```

   - Optional: `REPORT_MAILER_SERVER` (default `http://127.0.0.1:3000`), `SMTP_MAX_MB` (default 15),
     `SMTP_SECURE` (`true` or `false`; by default true only for port 465).

3. Restart the web server, so it reads the token.

4. Check the mail sign-in. This sends nothing:

   ```powershell
   cd D:\SMARTwinFA-web; node --experimental-strip-types scripts/report-mailer.mts --check
   ```

5. Start the mailer and leave the window open:

   ```powershell
   cd D:\SMARTwinFA-web; node --experimental-strip-types scripts/report-mailer.mts
   ```

## Start with Windows

After a test email has arrived, run this once to start the mailer at logon. It restarts the mailer if it stops.

```powershell
schtasks /Create /TN "SMARTwinFA Report Mailer" /SC ONLOGON /TR "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File D:\SMARTwinFA-web\scripts\run-report-mailer.ps1"
```

Close the window started in step 5 first. The log is `.wrangler\logs\report-mailer.log`.

## Who may be emailed

- A user may send to the email saved on their own web user (**Admin > Users**).
- Any other address must be approved by the **platform admin**: open a Trial Balance, **Saved views**,
  **Email** on any view, then **Approved addresses**.

## Use

1. Open Trial Balance, make the selection and save it in **Saved views**.
2. Press **Email** beside the view, choose PDF or Excel, check the addresses and press **Send Now**.
3. **My sends** shows the result.

The dates are the ones saved in the view. Sending needs export rights. If the menu has a module password, it
is asked at Send Now.

| Result | Meaning |
|---|---|
| Waiting | Not taken yet, or waiting to be tried again (3 tries, 2 minutes apart). After 24 hours it fails |
| Sending | The mailer has it |
| Sent | The mail server accepted it. This does not prove it reached the inbox |
| Failed | Not sent. The reason is shown |
| Check inbox | It may or may not have gone. It is not sent again automatically |

## If it does not work

| Message | What to do |
|---|---|
| The mailer program is not running | Start it (step 5 or the scheduled task) |
| The server has no REPORT_MAILER_TOKEN set | Add the token and restart the web server |
| The server refused the token | The server and the mailer read different tokens. Restart both |
| Mail server: ... | Check the SMTP lines, then run the check in step 4 |

## If other PCs reach this server through a proxy

Block `/api/report-mailer` at the proxy. Only the mailer on this PC needs it.
