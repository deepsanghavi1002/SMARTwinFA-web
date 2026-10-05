"use client";

import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * Small_Entry's c1dg_SmallEntryDataGrid for Outstanding Allocation (19): the account's pending
 * bills under the receipts grid. The operator types how much of the receipt chosen above goes
 * against each bill; together they may not be more than the receipt (AfterEdit's check, which
 * the screen makes as each figure is typed and Save makes again).
 */

type Bill = Readonly<Record<string, string>>;

const amountOf = (value: string | undefined) => Number((value ?? "").replace(/,/g, "").trim()) || 0;
const shown = (value: number) => value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const keyOf = (bill: Bill) => bill.led_key ?? bill.LED_KEY ?? "";

export function BillsGrid({ bills, setoffs, receiptAmount, receiptLabel, onChange, onRefused }: {
  bills: readonly Bill[];
  setoffs: Readonly<Record<string, string>>;
  receiptAmount: number;
  receiptLabel: string;
  onChange: (key: string, value: string) => void;
  onRefused: (message: string) => void;
}) {
  const total = Object.values(setoffs).reduce((sum, value) => sum + amountOf(value), 0);
  const commit = (key: string, value: string) => {
    const plain = value.replace(/,/g, "").trim();
    if (plain !== "" && !/^\d+(\.\d{0,2})?$/.test(plain)) { onRefused("Only a positive amount is allowed"); onChange(key, ""); return; }
    const others = total - amountOf(setoffs[key]);
    if (others + amountOf(plain) > receiptAmount + 1e-9) {
      onRefused(`Setoff Amount greater than equal ${receiptAmount} Not Allowed`);
      onChange(key, "");
      return;
    }
    onChange(key, plain);
  };
  const keys = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const inputs = [...(event.currentTarget.closest("table")?.querySelectorAll<HTMLInputElement>("input") ?? [])];
    const at = inputs.indexOf(event.currentTarget);
    inputs[event.key === "ArrowUp" ? Math.max(0, at - 1) : Math.min(inputs.length - 1, at + 1)]?.focus();
  };
  return (
    <section className="se-bills" aria-label="Pending bills">
      <div className="se-bills-head">
        <b>Pending bills</b>
        <span>Receipt {receiptLabel}: {shown(receiptAmount)} · Set off: {shown(total)} · Left: {shown(receiptAmount - total)}</span>
      </div>
      <div className="se-bills-scroll">
        <table>
          <thead><tr><th>Date</th><th>Bill No</th><th className="se-num">Amount</th><th className="se-num">Set Off</th></tr></thead>
          <tbody>
            {bills.map((bill) => {
              const key = keyOf(bill);
              return (
                <tr key={key} className={amountOf(setoffs[key]) > 0 ? "se-bill-set" : ""}>
                  <td>{bill.Date}</td>
                  <td>{bill.Bill_No}</td>
                  <td className="se-num">{shown(amountOf(bill.AMOUNT))}</td>
                  <td className="se-num">
                    <input
                      aria-label={`Set off against ${bill.Bill_No}`}
                      inputMode="decimal"
                      value={setoffs[key] ?? ""}
                      onChange={(event) => onChange(key, event.target.value)}
                      onBlur={(event) => commit(key, event.target.value)}
                      onKeyDown={keys}
                    />
                  </td>
                </tr>
              );
            })}
            {bills.length === 0 && <tr><td colSpan={4}>No pending bills for this account</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
