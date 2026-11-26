# Scheduled reports by email: plan for step 1

Prepared 2026-11-26. **Step 1 is built (2026-11-26).** Setup and use: `docs/operations/report-email.md`.

## Step 1: what was checked and what was not

- The saved views table exists on this installation. It is now also created on first use.
- On live data (RISHABH PLASTIC, 2026-27, grouped by Schedule): the report ran read-only with no writes
  and made a PDF and an Excel file; the Excel debit and credit totals equal the report's. Wrong company and
  unknown web user were refused.
- The job store SQL ran on the live database inside a transaction that was rolled back.
- The type check, build and new tests pass.
- [ ] No email has been sent: the mail settings are not filled in.
- [ ] The Email panel has not been used on screen, and screen exports were not compared before and after the
  table code moved.
- [ ] The three-view comparison and a look at the PDF layout (Testing, 2 and 3) are not done.
- [ ] Two mailers taking jobs at the same moment was not tried; one job taken twice in turn was refused.

## Changes from the plan below

- The approved address list is one per installation. `web_auth` does not tie a company admin to companies,
  so only the platform admin changes it.
- The 120 second limit applies to each database query, as on the report screen, not to the whole report.
- A `mailer_state` table records when the mailer last asked for work, for the screen's warning.

## Goal

A signed-in user picks one of their saved Trial Balance views, enters who should receive it, and presses
**Send Now**. The report arrives by email as PDF or Excel, sent from one company email account.

Timed sending (daily, weekly, monthly) is step 2. Step 1 stores everything step 2 will need.

## What the code has today

| Need | Today | Where |
|---|---|---|
| Saved selections | **Saved views** per operator, company and report, holding the selection and Group By | `app/api/report/views/route.ts`, `features/report/SavedViews.tsx` |
| Run a report on the server | `runReport(loader, reportName, selection)` | `lib/report/reportCombine.ts` |
| PDF and Excel | `pdf()` and `xlsx()` return bytes; their code uses no browser objects | `lib/export/` |
| Turn output into a table for export | Inside the screen component (`buildTable`) | `features/report/OutputGrid.tsx` |
| Web users and their email | `web_auth.app_user` (`email`, `operator_login`, `status`) | `lib/auth/schema.ts` |
| Company menu check | `allowedMasterMenu`; the menu is read for the company group, not for the user | `lib/master-program/access.ts` |
| User's print / preview / export rights | `reportRights()`; the screen enforces them when a button is pressed | `lib/report/setup.ts`, `OutputGrid.tsx` |
| User's company and year limits | Applied when the company and year lists are read; `readSession` does not check them | `lib/company-menu.ts`, `lib/master-program/session.ts` |
| Email sending | None found | - |

No script that creates `smart_system.report_saved_view` was found in the repository. Task 1 checks it.

## Design

The web server builds the report. A small separate Node program, the **mailer**, sends it.

```
Screen "Send Now" -> web server: add a job to the queue
Mailer (every 30 s) -> web server: give me the next job
Web server: check rights, run report, make the PDF / Excel -> mailer
Mailer -> SMTP server -> recipients
Mailer -> web server: sent, or failed with the reason
```

Why two parts:

- The web server runs on the Workers runtime (`lib/db.ts`), where work is tied to a request. A timer or a
  long mail connection inside it is not a safe base.
- The mailer calls the web server instead of importing the report code, so it does not depend on plain Node
  being able to load that code (its imports have no file extensions).
- The email password is read only by the mailer.

## Rules for step 1

1. **Trial Balance only.** The server keeps a list of allowed report keys (Trial Balance is 6). Other reports
   are refused. Some reports move or change data, so each one is added only after it has been checked.
2. **Read only.** The report runs in a read-only transaction. If it asks to write (`loader.writes` is not
   empty), the job fails and nothing is written.
3. **From a saved view.** The schedule keeps its own copy of the view's selection, so editing or deleting the
   view does not silently change what is emailed.
4. **No Group By yet.** A view with Group By is refused with a clear message, so the file never differs from
   the view without saying so.
5. **Fixed dates.** The view's dates are used and shown before sending. Moving dates come in step 2.
6. **One sender.** One company account; users cannot enter their own sender.

## Rights, checked on the server when the job is created and again when it runs

- The web user is still active and still linked to the same operator.
- The operator still exists (`readSession`).
- The company and year are in the operator's allowed lists. This needs an explicit check, using the same
  rules as the company screen. Note that the year list falls back to all years when the operator's
  restriction matches nothing.
- The report is in the company's visible menu.
- The operator has the **export** right for that menu.
- If the menu has a module password, it is verified when the schedule is created. The password is not stored.
  If the module password is changed later, sending stops until it is verified again. This needs a stored
  fingerprint of the setting, never the password itself.

**Recipients:** the user's own saved email is allowed. Any other address must be on a list the admin
approves. Both are checked again before sending. "Admin" here means the web roles `platform_admin` and
`company_admin`. A company admin manages only their own companies; confirm during task 2 how that link is
held, and limit this to `platform_admin` if it is not held.

## New tables (new schema `web_report`; legacy tables are not changed)

| Table | Main fields |
|---|---|
| `schedule` | owner web user, operator number, company, year, report name, menu name, report key, name, selection (JSON), format, recipients, active, created, changed |
| `job` | schedule, requested by, status (queued, running, sent, failed, unknown), attempts, queued, started, finished, error text, file name and size |
| `allowed_recipient` | company, address, added by, added on |

Step 2 adds the timing fields to `schedule`. The tables are created on first use, as `web_auth` is.

## The mailer's door into the web server

`POST /api/report-mailer` has no signed-in user, so it needs its own protection:

- A long random token (`REPORT_MAILER_TOKEN`) in `.env.local`, compared in constant time. With no token set,
  the route is off.
- It can only take queued jobs and report their results. It cannot choose a report, user or recipient.
- Each taken job gets a one-time job key, which is needed to report its result.
- Before release, check how the server is reached from other PCs. If it is exposed through a proxy, block
  this route there.

## Settings

Typed by the owner into `.env.local` on the one PC that runs the mailer. Never in chat or in Git.

`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`,
`REPORT_MAILER_TOKEN`, `REPORT_MAILER_SERVER` (default `http://127.0.0.1:3000`)

The web server needs only the token. `.env.local` is already ignored by Git. Gmail normally needs an App
Password. The connection to the mail server must be encrypted, with certificate checking on.

## Tasks, in order

| # | Task | Files | Done when |
|---|---|---|---|
| 1 | Check the saved views table on the live database; add a create script if it is only there by hand | database check, a create script if needed | Saving a Trial Balance view works, and a new installation would get the table |
| 2 | One server-side function for all the rights above | new `lib/report-mail/rights.ts` | Tests refuse: disabled user, wrong company, wrong year, no export right |
| 3 | Move the table building out of the screen so screen and server share it | new `lib/report/exportTable.ts`, `OutputGrid.tsx`, `features/grid/exportTable.ts` | Screen exports are the same as before |
| 4 | Create the tables and the job queue (a job can be taken only once) | new `lib/report-mail/store.ts` | Two takers at once never get the same job |
| 5 | Build the file for a job: rights, run report, PDF or Excel | new `lib/report-mail/build.ts` | Totals and rows match the screen for the same view |
| 6 | User routes and the mailer route | new `app/api/report-schedules/route.ts`, `app/api/report-mailer/route.ts` | A user sees only their own schedules and jobs |
| 7 | Screen: **Email** in Saved views (name, format, recipients, Send Now, history), and the admin's recipient list | `features/report/SavedViews.tsx`, new components | Send Now shows queued, then sent or failed with the reason |
| 8 | The mailer program, with `nodemailer` | new `scripts/report-mailer.mts`, `package.json` | A test email with the attachment arrives |
| 9 | Start the mailer with Windows and keep one copy running | new script, like `scripts/run-server.ps1` | It restarts after a reboot; a second copy exits |
| 10 | Setup notes | new page in `docs/operations/` | Another person can set it up from the notes |

## Failures

- **Report fails or a right is refused:** the job is marked failed with the reason. No email is sent.
- **Mail server refuses before accepting the message:** retry up to 3 times, then failed.
- **Connection lost after the message was handed over, or the mailer stops in the middle:** the job is marked
  **unknown** and is not retried automatically, to avoid sending twice. The user checks and sends again.
- **File too large for the mail server:** failed, with the size. The limit is a setting (start with 15 MB).
- **Report takes longer than 120 seconds:** failed. 120 seconds is what the report screen allows now.
- Logs never contain the password, the token or report figures.

"Sent" means the mail server accepted the message. It does not prove it reached the inbox.

## Testing before use

1. Automated tests for rights, recipients, the queue and the table building. Run the tests, the type check
   and a build.
2. For at least three Trial Balance views (plain, grouped by Schedule, Debtors with zones), compare the
   emailed Excel with the screen: row count, opening, debit, credit and closing totals.
3. Open the PDF and check page width, headings and subtotals.
4. First real emails go only to the owner's own address.
5. Try each failure above, including a wrong mail password and a stopped web server.

## Known limits

- The PDF fonts cover Western characters only (`lib/export/pdf.ts`). Gujarati or Hindi names print as `?`.
  Check Excel output for such names during testing.
- The emailed file follows the report's own columns. Changes made only on screen (filters, column order and
  width, added columns, Group By) are not included.
- The Trial Balance has not been compared with the desktop program (`docs/PENDING-WORK.md`).
- The PC running the web server and the mailer must be on, with database and internet access. Run the
  mailer on one PC only.
- `nodemailer` is a new package: run `npm install` after updating each PC.

## Step 2 and later (not part of this plan's tasks)

- Daily, weekly and monthly times; catching up on one missed run, not every missed run.
- Moving dates (today, yesterday, this month) and the move to a new financial year, with rights checked for
  the new year.
- Admin screen: all schedules, stop any schedule, allow or block scheduling per user.
- More reports, one at a time. WhatsApp.

## To decide before building

- Which email account sends the reports.
- Who approves outside email addresses. This plan assumes the admin.
- Which PC runs the mailer. This plan assumes the one that runs the web server.
