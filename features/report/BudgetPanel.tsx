"use client";

import { useState } from "react";
import type { BudgetUse } from "../../lib/report/planning";
import { useEscapeClose } from "../grid/useEscapeClose";
import { Icon } from "../ui/Icon";

/**
 * Budget against actual for the accounts the report was run for (web only). The budget is the one
 * kept on the account master; the actual is what the account did in the report's dates (a debtor's
 * sales, a creditor's purchases), as the Budget report works it out. Each account shows its share of
 * the budget used, in a bar that turns orange, with ▲ and "over", when it has passed it.
 */

const WITHIN = "#2a78d6";
const OVER = "#eb6834";
const money = (value: number) => value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const share = (used: number) => `${(used * 100).toFixed(1)}%`;

type Order = "used" | "name" | "variance";

export function BudgetPanel({ budgets, period, onClose }: { budgets: readonly BudgetUse[] | null; period: string; onClose: () => void }) {
  useEscapeClose(onClose);
  const [overOnly, setOverOnly] = useState(false);
  const [order, setOrder] = useState<Order>("used");

  const list = budgets ?? [];
  const budget = list.reduce((sum, item) => sum + item.budget, 0);
  const actual = list.reduce((sum, item) => sum + item.actual, 0);
  const over = list.filter((item) => item.actual > item.budget);
  const unused = list.filter((item) => item.actual === 0);
  const shown = [...(overOnly ? over : list)].sort((a, b) => (order === "name" ? a.name.localeCompare(b.name) : order === "variance" ? b.variance - a.variance : b.used - a.used));

  return (
    <aside className="rp-chart rp-budget" aria-label="Budget">
      <div className="rp-chart-head">
        <b><Icon name="budget" />Budget vs actual</b>
        <button type="button" className="rp-chart-close" onClick={onClose} aria-label="Close budget">×</button>
      </div>
      <p className="rp-chart-note">{period}. Budget from the account master; actual is the account&apos;s sales (debtors) or purchases (creditors) in these dates.</p>

      {budgets === null && <p className="rp-chart-empty">Run the report for accounts (tick the Account group) to see their budgets.</p>}
      {budgets !== null && list.length === 0 && <p className="rp-chart-empty">None of these accounts has a budget. Enter it in the account master.</p>}

      {list.length > 0 && (
        <>
          <div className="rp-cards">
            <div className="rp-card"><span>Budget</span><b>{money(budget)}</b></div>
            <div className="rp-card"><span>Actual</span><b>{money(actual)}</b></div>
            <div className="rp-card"><span>Used</span><b>{share(budget === 0 ? 0 : actual / budget)}</b><small>of {list.length} budgeted {list.length === 1 ? "account" : "accounts"}</small></div>
            <div className="rp-card"><span>Over budget</span><b>{over.length}</b><small>{unused.length} with nothing done</small></div>
          </div>
          <div className="rp-chart-controls">
            <label>Order
              <select value={order} onChange={(event) => setOrder(event.target.value as Order)}>
                <option value="used">Most used first</option>
                <option value="variance">Biggest overrun first</option>
                <option value="name">Name</option>
              </select>
            </label>
            <label className="rp-compare-sort"><input type="checkbox" checked={overOnly} onChange={(event) => setOverOnly(event.target.checked)} /> Over budget only</label>
          </div>
          {shown.length === 0 ? <p className="rp-chart-empty">No account is over its budget.</p> : (
            <ul className="rp-budget-list">
              {shown.map((item) => {
                const exceeded = item.actual > item.budget;
                return (
                  <li key={item.code}>
                    <div className="rp-budget-row"><b title={item.name}>{item.name}</b><span>{exceeded ? "▲ over by " : ""}{exceeded ? money(item.variance) : `${money(-item.variance)} left`}</span></div>
                    <div className="rp-budget-bar" role="img" aria-label={`${item.name}: ${share(item.used)} of the budget used`}><i style={{ width: `${Math.min(1, Math.max(0, item.used)) * 100}%`, background: exceeded ? OVER : WITHIN }} /></div>
                    <div className="rp-budget-row rp-budget-sub"><span>{money(item.actual)} of {money(item.budget)}</span><span>{share(item.used)}</span></div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </aside>
  );
}
