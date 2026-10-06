"use client";

import type { CashPlanning } from "../../lib/report/planning";

/**
 * Planning for a cash, discount or bank account (the day book's Chart panel): where the account
 * stands as of the Upto date, how long its cash lasts at the pace it is being paid out, and, for an
 * account with a limit (a bank cash credit), how much of the limit is drawn. Worked out on the
 * server from the account itself, so the grid's filters do not change it.
 */

const money = (value: number) => value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const USED = "#eb6834";
const FREE = "#2a78d6";

/** Days as "13 days" / "2 months 5 days" for a figure people plan with. */
function span(days: number): string {
  if (days < 60) return `${days} ${days === 1 ? "day" : "days"}`;
  const months = Math.floor(days / 30);
  const rest = days - months * 30;
  return `${months} months${rest > 0 ? ` ${rest} days` : ""}`;
}

export function PlanningPanel({ planning }: { planning: CashPlanning }) {
  const { closing, daysOfCash, averageDailyPayment, windowDays, limit, utilised, available, utilisation } = planning;
  const bank = planning.book === 6;
  const overdrawn = closing < 0;
  const basis = windowDays === 30 ? "last 30 days" : `last ${windowDays} days (the year so far)`;
  const used = Math.min(1, utilisation);

  let cash: { value: string; note: string };
  if (overdrawn) cash = { value: bank && limit > 0 ? "On the limit" : "Overdrawn", note: `${money(utilised)} drawn` };
  else if (daysOfCash === null) cash = { value: averageDailyPayment === 0 ? "No payments" : "—", note: "nothing paid out to measure against" };
  else cash = { value: span(daysOfCash), note: `at ${money(averageDailyPayment)} a day paid out (${basis})` };

  return (
    <section className="rp-plan" aria-label="Planning">
      <h4>Planning · as of {planning.asOf}</h4>
      <div className="rp-cards">
        <div className="rp-card"><span>Balance now</span><b>{money(closing)}</b><small>{closing < 0 ? "CR (drawn)" : "DR"} · opening {money(planning.opening)}</small></div>
        <div className="rp-card"><span>Cash lasts</span><b>{cash.value}</b><small>{cash.note}</small></div>
        <div className="rp-card"><span>Avg paid out / day</span><b>{money(averageDailyPayment)}</b><small>{basis}</small></div>
        {bank && <div className="rp-card"><span>Interest entries</span><b>{money(planning.interest)}</b><small>accounts named &ldquo;Interest …&rdquo;, this period</small></div>}
      </div>
      {bank && limit > 0 && (
        <div className="rp-gauge" role="img" aria-label={`Limit used ${(utilisation * 100).toFixed(1)} percent: ${money(utilised)} of ${money(limit)}, ${money(available)} left`}>
          <div className="rp-gauge-head"><b>Limit used {(utilisation * 100).toFixed(1)}%</b><span>{money(utilised)} of {money(limit)}</span></div>
          <div className="rp-gauge-bar"><i style={{ width: `${used * 100}%`, background: USED }} /><i style={{ width: `${(1 - used) * 100}%`, background: FREE }} /></div>
          <div className="rp-gauge-legend">
            <span><i style={{ background: USED }} />Drawn {money(utilised)}</span>
            <span><i style={{ background: FREE }} />{available < 0 ? "Over the limit by" : "Available"} {money(Math.abs(available))}</span>
          </div>
          {utilisation >= 0.9 && <p className="rp-gauge-warn">{utilisation > 1 ? "⚠ Over the limit" : "⚠ 90% or more of the limit is used"}</p>}
        </div>
      )}
      {bank && limit === 0 && overdrawn && <p className="rp-chart-note">This account is overdrawn but has no limit set. Enter the limit in the account master to see how much of it is used.</p>}
    </section>
  );
}
