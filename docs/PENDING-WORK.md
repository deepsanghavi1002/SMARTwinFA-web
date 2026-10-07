# Pending work: master, small entry, report

One file for everything left over, to finish at the end. Add an item the moment it is left out;
tick it (`[x]`) and add the date when it is done. Do not delete finished items: strike them by
ticking, so the history stays.

Format of an item: `- [ ] what is left — why / where (date noted)`

Last updated: 2026-10-07

---

## Report (Report_Combine)

Ported so far: 1 Day Book, 2 Journal, 3 Register, 4 Ledger, 5 Outstanding Ageing, 21 Outstanding
Clearance, 42 Budget.
Everything is in `lib/report/` (one program: `reportCombine.ts` → `reportStandard.ts` /
`reportFormating.ts` → `output.ts`, shared code in `library.ts`) and `features/report/`.

### Reports not started
- [ ] About 290 more report keys. Order proposed: core standard reports, then production reports by
  use (17 Stock, 150 Patiya, 175, 231, 78, 284, 212, 159, 147 …), then action screens (78 Auto
  Billing, 147 E-Way Bill, 284 Upload Doc, 255 Bill PDF, 65 Year Ending, 285, 50 Logfile are write
  actions, a separate track), other clients' reports only on demand. (2026-10-06)

### Ledger (4) and Day Book (1)
- [ ] Ledger: Account Confirmation / T-Format (CHK_ACC_CNFRM / TFPRINT), JV details
  (bit_Jv_Dtls_Required), report log (log_report), print password (u_pass_4), zoom / drill from a
  row into its entry. (2026-10-05)
- [ ] Ledger eMail: needs Ledger_Confirmation.rpt and SMTP; the button says "not ported". (2026-10-05)
- [ ] Day Book: Show Narration with a filter and no group (the desktop's INTO fails; the web returns
  the rows the procedure meant); check on more data. (2026-10-06)

### Journal (2)
- [ ] Group headings (Area / Account) are web-only: the desktop builds none. Confirm with Pranav
  that this is what he wants. (2026-10-07)
- [ ] Journal with Show Narration in rows, and with a format, not tested. (2026-10-07)

### Register (3)
- [ ] Include Slab / Exclude Slab: code is written, but this setup has no `lbchk_Slabs` control, so
  the desktop also stops ("Control Missing To Process"). Needs the control added to
  `smart_setup.report_control` first. (2026-10-07)
- [ ] Include Form / Exclude Form: refused as on the desktop (control missing). (2026-10-07)
- [ ] Slab / Form filters combined with the formats (Month, Daily, Item Detail …). (2026-10-07)
- [ ] Item Detail with an addon group ticked (heading addon columns). (2026-10-07)
- [ ] Item Detail variants for licences 2, 14, 25 and 44. (2026-10-07)
- [ ] Item Detail "with narration" (`bit_comb_cols`) rows. (2026-10-07)
- [ ] Desktop-quirk decisions to confirm: Daily with Quantity keeps AMOUNT (the desktop dropped it);
  Month steps whole calendar months; Show Default Slabs with 2+ groups uses the pivoted rows. (2026-10-07)

### Outstanding Ageing (5)
- [ ] Multi Company Report (CHK_MULTICO), With FIFO, With PDC, Outstanding With All Entries,
  Only On Account Detail: refused. (2026-10-07)
- [ ] Ageing Column Selection (columns from `DAYS_GAP`). (2026-10-07)
- [ ] Interest Perc sorting: the desktop does nothing with it for this report; confirm it should stay so. (2026-10-07)
- [ ] Grace Days sorting: the desktop compares "Geace Days" (typo) so the typed days never applied;
  the web applies them. Confirm. (2026-10-07)
- [ ] With an addon group (no party ticked) the parties are those that have bills, so a party with
  only a credit balance is missed. (2026-10-07)
- [ ] Advances dated after the Upto date are left out (the desktop did not filter): confirm. (2026-10-07)
- [ ] Print-only options not acted on: Outstanding With Letter Format, Every Party Start On New
  Page, Collection Planning, Transfer Outstanding Data, Update OS Message, cloud send. (2026-10-07)
- [ ] Other books: only the sale book (8) was checked against live data; purchase (13) and expense
  (15) run the same code, untested. (2026-10-07)

### Outstanding Clearance (21)
Ported in `reportFormating.ts` `outstandingClearance()` (SP_FRT_RPT_OUTSTANDING_CLEAR, exported to
`.scratch/mssql_SP_FRT_RPT_OUTSTANDING_CLEAR.sql`): Entrywise Detail and Summary, On Account To
Settle (the default), the Interest Perc sorting, addon groups, Ageing Column Selection, Only Pending Bills, Print Right Side Entry, Entry Level Credit Days, the Grace
Days sorting. Checked on the sale book: every sale party's pending total equals its ledger closing
except 2 whose data disagree (16260 has a duplicated receipt row in OUTCLEAR, 10221 is 95.00 off).
- [ ] Refused for now: Combine Setoff (a C# post-process of its own) and an entry-level addon group. (2026-10-07)
- [x] Addon groups (Area, Zone ...) and Ageing Column Selection (DAYS_GAP keys 1-5) ported 2026-10-07. Quirks kept: an
  addon heading below level 1 takes the last (outer, inner) pair; a heading with nothing under it is dropped (levels 1-2 only).
  Checked on Zone+Area+Account detail and Summary (totals equal the plain run); not compared with a desktop run.
- [ ] Purchase (13) and expense (15) run the same code, but their opening handling is the
  procedure's own (the credit opening goes in as a receipt), and the totals do NOT match the ledger
  for some parties (e.g. 10265 Crescent Petrochem: the 6,95,592.02 OPENING bill is never listed).
  Confirm against the desktop output before relying on them. (2026-10-07)
- [ ] The procedure swallows its own cursor errors (TRY/CATCH with PRINT); the web follows the
  intended path and cannot repeat a silent failure. (2026-10-07)
- [ ] Not checked against a desktop run (the proc needs write access to temp tables in SQL Server, so
  it was not run): only against the ledger closing. (2026-10-07)

### Output screen and extras
- [ ] Ledger Create Group is enabled on the web for keys the desktop skips (4/6/22/23/117/118). (2026-10-05)
- [ ] Target vs actual (target table has 5 test rows with text amounts "? 10,000.00"; ask how it is used). (2026-10-06)
- [ ] Cash forecast (needs outstanding by due date), what-if, pin to dashboard (no dashboard screen). (2026-10-06)
- [ ] Previous-year compare (the other year's data is in another schema). (2026-10-06)
- [ ] Group By / Compare / Growth only fully tested on a few reports. (2026-10-06)

### Look and library
- [ ] The 4-level heading / subtotal colours (`features/grid/levelStyle.ts`) are used by the report
  output only. Use them in master, small entry and entry grids. (2026-10-07)
- [ ] User-chosen screen colour theme: only the provision exists (`resolveLevelColours`, a level that
  matches the user's colour turns light red). No screen picks a theme yet. (2026-10-07)
- [ ] Ribbon (`features/grid/GridRibbon.tsx`) is on the report output only; master and small entry
  still use the old button bar. (2026-10-07)
- [ ] Buttons are coloured by position in the ribbon, so Excel / PDF no longer keep their own colours;
  confirm. (2026-10-07)

---

## Small entry (Small_Entry)

All 31 active small entries for licence 21 now save (see `PORTED_ENTRIES` in
`lib/small-entry/load.ts`). Code in `lib/small-entry/` and `features/small-entry/`.

- [ ] 37 of 109 SMALL_ENTRY menus load on this server; the rest are other clients' screens (missing
  columns / tables such as `master_link.ml_prod_id`, `party_product.fg_prod_id`, money-type
  errors). Decide which clients' screens matter. (2026-10-02)
- [ ] Entries whose grid query is "not ported": 19 (detail grid done), 69, 79, 107. (2026-10-02)
- [ ] Not ported generic features: Col+ / RecBlk / PARTYMulFld fill styles, header (non-multiple)
  save rules, delete rows, print / export of the entry. (2026-09-30)
- [ ] `|sys.imagedb|` entries (57 / 60 / 64): an empty `rishabh_plastic27_image.document_upload` was
  created; real image storage is not set up. (2026-10-02)
- [ ] `entry_properties.no_of_col_frozen` is PG only (not on SQL Server); values still to be set
  per entry. (2026-10-02)
- [ ] Payment entries 42 / 47 clear every listed row like the desktop; check with real use. (2026-10-05)
- [ ] The shared grid features (filters, calculator, calendar, arrange columns, export / print) are
  in `features/grid/`; check each on every small entry. (2026-10-01)
- [ ] Everything since 2026-10-02 (save audit, payments, last four entries) is uncommitted until
  Pranav tests. (2026-10-05)

---

## Master (Master_ProgramGrid)

One generic web master for all MASTER menus (`lib/master-program/`, `features/master-program/`).

- [ ] Legacy password verification: `smart_setup.user_master.user_pw` is a 12-character
  obfuscation; the desktop algorithm is not in the repo, so the app runs in `migration-test` mode
  and does not verify passwords. Needed before launch. (2026-08-27)
- [ ] Remove the temporary `SMARTWINFA_SKIP_LOGIN` bypass before launch (also `app/api/dev-login`
  and its call in `features/startup/StartupGate.tsx`). (2026-10)
- [ ] `docs/testing/control-coverage.csv`: most controls were still "discovered", not tested on
  real data (93 of 108 at 2026-08-27); re-run the coverage. (2026-08-27)
- [ ] Seed re-export: the dump's non-ASCII characters are already lost as "?" (money columns and
  text); re-export the seed from the source. (2026-09)
- [ ] Program 32 (rate master) still missing `pr_slabperc1`; the setup date-cast fix is in the live
  PG `program_top` for 8 rate masters (backup file in `.scratch`). (2026-10-01)
- [ ] Print uses the browser instead of Crystal `.rpt`; program 39 / 50 percentage boxes mark the
  rows they change as edited (the desktop does not). (2026-09-19)
- [ ] The two `Master_ProgramGrid.cs` copies (F: and D:) have identical grid logic; F: is the SQL
  Server dialect. Keep the grid column index coupling in mind (property-grid row N = update-grid
  column N). (2026-09)

---

## Across all three

- [ ] Commit and push: all report work since 2026-10-06 and the small-entry work since 2026-10-02
  are local until Pranav confirms in his browser ([see notes]: test locally before push). (2026-10-07)
- [ ] The dev server (vinext) serves a stale `globals.css` after edits; restart it
  (`npm run dev -- --port 3000`) when a CSS change does not show. (2026-10-07)
- [ ] Speed indexes were added to the live `rishabh_plastic27`; other company schemas need
  `.scratch/idx-all-schemas.mjs`. (2026-10)
- [ ] Multi-client rule: company and year lists come live from `smart_system`, never hard-coded. Check
  new code for hard-coded company names or schemas. (2026-09)
