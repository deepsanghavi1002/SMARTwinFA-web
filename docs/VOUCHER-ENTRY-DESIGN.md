# Voucher entry (Transaction > Voucher) — web design

Source: desktop `Entry.cs` (class Comman_Entry, `str_Entry_Style == "V"`) + setup tables in `smart_setup`
(entry_properties key 2 VOUCHER, entry_control entry_id 2, entry_grid_body entry_properties_id 2,
control_event entry_properties_id 2, entry_save_properties entrykey_id 2). Date: 2026-10-15, branch
`pc1-15-oct-voucher-invoice-entry`.

Voucher is the same form as Invoice (see `docs/PENDING-WORK.md` "Entry"), switched to voucher style. The plan is
to reuse `features/entry/*` and `lib/entry/*` and add only what differs, selected by `entry_type` (`IN` / `VC`).

## 1. Header (top of screen)

First combo caption **DAYBOOK**, entry_type `VC`. List = accounts with `book_print='V'`, `stkm_pos<>'D'`,
`book_key<=19` (here: Cash 4, Discount 5, Banks 6, Journal 19 — 12 rows in rishabh_plastic27).

| Control | Label | Notes |
|---|---|---|
| cmb_Side | Book Side | Dr / Cr (receipt / payment); fills the series list (`bn_dbcode`). Books 4, 5, 6 only; JV has no side |
| cmb_Series | Series | from `book_number` + `book_setup`; event LF sets `booknumber` |
| dtp_Date | Date | default from `bn_datedefa` |
| tbx_Number | Number | default `bn_docdefa`; duplicate check LF on `ledger.doc_no` per series/side/book |
| dtp_EntryDate | Post Dt. | default `bn_postdatedefa`; book 4,5,6,19 |
| tbx_EntryNo | Entry No. | default `bn_postdefa`; duplicate check |
| dtp_ChlnDate / vouch_chq_* | Chln. Dt. | Bank only (books 4,5,6,19 flags); chq no / date defaults `bn_doc1defa`, `bn_chlndatedefa` |
| cmb_Ac_Exp_Name | Exp. Name | only books 15, 10 (expense) — not for the day books |
| cmb_Rev_Entry | Doc. Type | combo fixed values, books 4,5,6 |
| tbx_PartyName | Party Name | help `HELP_ENT_ACCOUNT` (hidden on add) |
| lbl_Book_Balance | "Book bal. : n Dr/Cr" | from `ac_balance` on day-book change |

Setup reading is the same as Invoice (`lib/entry/invoice.ts` `loadInvoice` / `loadBook`); only the entry id,
the `FIRST_COMBO` event set and the `field_enable_book` filter (book list per control) differ.

## 2. Body: three areas

1. **Input grid `c1dg_Inputdata`** (one row per account line) — columns, left to right:
   `name` Account Head (425, help `HELP_ENT_ACCOUNT`, required), `debit_amt` Debit (120), `credit_amt` Credit (120),
   `doc_no1` Chq. Number (100, bank only, `visible_for_book 6,`), `chln_date` Chq. Date (120, bank only).
   Hidden: `led_key`, `out_key`, `os_flag`, `ag_out_key`, `book`, `code`, `doc_series`, `doc_no`, …
   Per-account **addon rows** (event 21, `fiel_entrypos='P'`): label + input fields shown under the account.
2. **Outstanding clear grid `c1dg_V_Outclear`** (bottom left) — filled when an account row gets focus
   (event 22 from `vouch_name`): Sr., Doc Number, Date, Amount, Pending, **Setoff Amt** (editable). Source query
   in `control_event` 53 (`out_clear` joined to `ledger`). Setoff total may not exceed the voucher amount
   ("Outstanding Setoff Amount can not be greater than Voucher Amount…"); balance = row amount − Σ setoff.
3. **Addon grid `c1dg_Addon`** (bottom right) — header addons (`fiel_entrypos='L'`), event 23.

Below: Narration (362×52), and a status line with the Dr / Cr totals and the difference.

## 3. Rules to port (desktop → web)

From `Voucher_Validate_Account` / `Voucher_AcHelp_Selection` (Entry.cs:12717, 12815):
- Party **lock message** (`ac_message`) blocks (`DL`) or warns (`DW`) for voucher style.
- Account may not equal the day book ("Book and Account can't be Same…").
- Entry date vs account `a_startdate` / `a_lastdate`.
- Allowed account groups by day book: Cash(4) → groups 1 2 3 4 7; Discount(5) → 1 2 3; Bank(6) → 1 2 3 4 6 7;
  JV(19) → anything except 4 6 7.
- Contra: cash↔bank / bank↔bank sets `int_type = 9`, shows "Contra", one extra row only; cash-to-cash and
  bank-to-bank only from the Payment side; account change not allowed in Contra edit; Contra cannot be created in edit.
- After picking an account focus goes to Debit or Credit by side (`byte_ac_dbcode`); JV / multi-daybook can be either.
- Voucher day-lock (`V_DAYLOCK,` in `entry_para`) and `bl_EntryDatelock`.
- Rights: separate Add / Edit / Delete messages ("Voucher Entry … Rights Not Available For User").

## 4. Save (entry_save_properties, entrykey_id 2 — 127 rows)

Tables: `LEDGER` (one row per grid line, the book line is created from the day book), `OUTCLEAR` (setoff rows),
`ADDON_AENTRY`. LEDGER columns per row: code, doc_date, doc_no, doc_series, full_docno, doc_no1 (chq), amount,
book_amt, post_amt, bk_dbcode, book, book_code, ac_dbcode, narration, setoff_amt (0), ly_clearamt (0),
chln_date, ag_book, ag_bkcode, post_bkcode, type, int_type (0), entry_type, doc_posting (A on add / P on
update), doc_mode 0, doc_lock, doc_pos 'A', prod_amt 0, doc_remark, entry_sty, unique_key, stkmdl, year_id, last_savedate.
Add/update/delete rows are paired in the setup (two lines per field), so the save planner built for Invoice
(`lib/entry/save.ts` — data-driven from this table, runPlan, reversal, log) should work unchanged with
entry key 2. Rules carried over: live DB, backup first, dry-run proof script, `logfile='S'` log inserts.

Balance check: Σ debit must equal Σ credit (Contra and JV), otherwise "difference" blocks Save.

## 5. Print

Voucher print file by book: `Voucher_Plain.rpt` / `Voucher_Multi.rpt` (Entry.cs:26526-26567), `voucher_type="VOUCHER"`.
Out of scope for the first screen; add to PENDING-WORK.

## 6. Build plan (smallest steps first)

1. Menu: route `ENTRY + VOUCHER` (menushortname for VOUCHER) to the Entry screen with `entryKey = 2`.
2. `lib/entry/voucher.ts`: load header setup, day-book list, side → series, defaults, book balance, duplicate checks.
3. `features/entry/VoucherGrid.tsx`: account / debit / credit (+ chq no / date for bank), running totals,
   `HELP_ENT_ACCOUNT` help reusing `HelpList`.
4. Account selection rules (section 3) in `lib/entry/checks.ts` as `voucherAccountRules`.
5. Outstanding clear grid + addon grid.
6. Save / Edit / Delete via the existing planner; dry-run proof script `.scratch/voucher-dry.ts`.
7. Find list (`VOUCHER_PREVIEW`) and Log button reuse.

## 7. Open questions for Pranav

- Build all three day-book kinds (cash, bank, JV, discount) in step 1, or Cash first?
- Is Contra needed in the first version?
- Which licences use voucher day-lock / multi-day-book (`bl_Multi_Daybook`)?
