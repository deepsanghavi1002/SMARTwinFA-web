"use client";

import { useEffect, useMemo, useState } from "react";
import { dashCall } from "../dashboard/api";
import { useStartupSelection } from "../startup/StartupGate";

/**
 * The Modern view's home screen, in place of the splash artwork: the company's own figures (what customers owe, what is owed, cash, bank,
 * sales against purchase by month) from the Dashboard report, and shortcuts to the entry screens. The figures are read only when the
 * company's menu carries the Dashboard report for this user (the Dashboard's own server checks it again); without it the home shows
 * the shortcuts alone.
 */

type HomeNode<N> = { id: number; label: string; actionCode: string | null; actionMenu: string | null; menuShortName: string | null; children: N[] };
type Point = { label: string; month: number; value: number };
type Kind = "sale" | "purchase" | "receipt" | "payment" | "expense";
type Balance = "receivable" | "payable" | "expensepayable" | "cash" | "bank";
type Figures = { series: Record<Kind, Point[]>; today: Record<Kind, number> | null; balances: Record<Balance, number> | null };

const flatten = <N extends HomeNode<N>>(nodes: readonly N[]): N[] => nodes.flatMap((node) => [node, ...flatten(node.children)]);
const total = (points: readonly Point[] | undefined) => (points ?? []).reduce((sum, point) => sum + point.value, 0);
/** ₹ in lakhs and crores, the way the Dashboard's bars are labelled. */
export function shortRupees(value: number): string {
  const size = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (size >= 1e7) return `${sign}₹${(size / 1e7).toFixed(2)} Cr`;
  if (size >= 1e5) return `${sign}₹${(size / 1e5).toFixed(2)} L`;
  return `${sign}₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(size)}`;
}
const full = (value: number) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

const SHORTCUTS = ["Sales", "Purchase", "Receipt", "Payment", "Journal", "Debit Note", "Credit Note"];

export function ModernHome<N extends HomeNode<N>>({ menus, onOpen }: { menus: readonly N[]; onOpen: (node: N) => void }) {
  const selection = useStartupSelection();
  const [figures, setFigures] = useState<Figures | null>(null);
  const [period, setPeriod] = useState("");
  const [fetched, setState] = useState<"idle" | "loading" | "ready" | "none">("idle");

  const all = useMemo(() => flatten(menus), [menus]);
  const dashboard = useMemo(() => all.find((node) => node.actionCode?.toUpperCase() === "REP_DASHBOARD" && node.actionMenu), [all]);
  const shortcuts = useMemo(() => SHORTCUTS.flatMap((label) => {
    const node = all.find((candidate) => candidate.children.length === 0 && candidate.label.replace(/&/g, "").trim().toLowerCase() === label.toLowerCase());
    return node ? [{ label, node }] : [];
  }), [all]);

  useEffect(() => {
    if (!selection || !dashboard) return;
    let live = true;
    (async () => {
      try {
        await Promise.resolve();
        if (live) setState("loading");
        const setup = await dashCall<{ from: string; upto: string }>(selection, dashboard.actionMenu!, dashboard.menuShortName ?? "", "setup");
        const result = await dashCall<{ data: Figures }>(selection, dashboard.actionMenu!, dashboard.menuShortName ?? "", "data", { from: setup.from, upto: setup.upto });
        if (!live) return;
        setFigures(result.data);
        setPeriod(`${setup.from} – ${setup.upto}`);
        setState("ready");
      } catch {
        if (live) setState("none");
      }
    })();
    return () => { live = false; };
  }, [selection, dashboard, menus.length]);

  const state = !selection || !dashboard ? (menus.length > 0 ? "none" : "idle") : fetched;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const sales = total(figures?.series.sale);
  const purchase = total(figures?.series.purchase);
  const sale = figures?.series.sale ?? [];
  const buy = figures?.series.purchase ?? [];
  const peak = Math.max(1, ...sale.map((point) => Math.abs(point.value)), ...buy.map((point) => Math.abs(point.value)));
  const balances = figures?.balances;
  const cards: { label: string; value: number; note: string; tone: string }[] = balances
    ? [
      { label: "Receivable", value: balances.receivable, note: "Owed to you by customers", tone: "sky" },
      { label: "Payable", value: balances.payable, note: "You owe suppliers", tone: "amber" },
      { label: "Cash", value: balances.cash, note: "Cash in hand", tone: "mint" },
      { label: "Bank", value: balances.bank, note: "Bank accounts", tone: "mint" },
    ]
    : [];

  return (
    <div className="mh">
      <header className="mh-head">
        <div>
          <div className="mh-date">{today}</div>
          <h1>{greeting}, {selection?.displayName || selection?.loginName || ""}</h1>
          <div className="mh-co">{selection?.companyName} · {selection?.yearLabel}</div>
        </div>
        {shortcuts.length > 0 && (
          <div className="mh-actions" role="group" aria-label="New entry">
            {shortcuts.slice(0, 4).map(({ label, node }, at) => (
              <button key={node.id} type="button" className={at === 0 ? "mh-primary" : "mh-ghost"} onClick={() => onOpen(node)}>{at === 0 ? `+ ${label}` : label}</button>
            ))}
          </div>
        )}
      </header>

      {state === "loading" && <div className="mh-note" role="status">Reading your figures…</div>}

      {state === "ready" && (
        <>
          <section className="mh-cards" aria-label="Balances as on today">
            {cards.map((card) => (
              <button key={card.label} type="button" className={`mh-card mh-${card.tone}`} onClick={() => dashboard && onOpen(dashboard)} title="Open the Dashboard">
                <span className="mh-card-label">{card.label}</span>
                <span className="mh-card-value">{shortRupees(card.value)}</span>
                <span className="mh-card-note">{card.note}</span>
              </button>
            ))}
          </section>

          <div className="mh-row">
            <section className="mh-panel mh-chart" aria-label="Sales and purchase by month">
              <div className="mh-panel-head">
                <h2>Sales and purchase</h2>
                <span className="mh-legend"><i className="mh-dot mh-dot-sale" />Sales {shortRupees(sales)}<i className="mh-dot mh-dot-buy" />Purchase {shortRupees(purchase)}</span>
              </div>
              <div className="mh-bars" role="img" aria-label={`Monthly sales and purchase, ${period}. Total sales ${full(sales)}, purchase ${full(purchase)}.`}>
                {sale.map((point, at) => (
                  <div key={point.label} className="mh-month">
                    <div className="mh-pair">
                      <span className="mh-bar mh-bar-sale" style={{ height: `${Math.max(2, (Math.abs(point.value) / peak) * 100)}%` }} title={`${point.label} sales ${full(point.value)}`} />
                      <span className="mh-bar mh-bar-buy" style={{ height: `${Math.max(2, (Math.abs(buy[at]?.value ?? 0) / peak) * 100)}%` }} title={`${point.label} purchase ${full(buy[at]?.value ?? 0)}`} />
                    </div>
                    <span className="mh-month-label">{point.label}</span>
                  </div>
                ))}
              </div>
              <div className="mh-period">{period}</div>
            </section>

            <section className="mh-panel" aria-label="Today">
              <div className="mh-panel-head"><h2>Today</h2></div>
              <dl className="mh-today">
                {([["sale", "Sales"], ["purchase", "Purchase"], ["receipt", "Receipts"], ["payment", "Payments"], ["expense", "Expenses"]] as const).map(([kind, label]) => (
                  <div key={kind}><dt>{label}</dt><dd>{figures?.today ? shortRupees(figures.today[kind]) : "–"}</dd></div>
                ))}
              </dl>
              {dashboard && <button type="button" className="mh-link" onClick={() => onOpen(dashboard)}>Open the Dashboard →</button>}
            </section>
          </div>
        </>
      )}

      {state === "none" && (
        <section className="mh-panel mh-empty" aria-label="Getting started">
          <h2>Choose a menu to start</h2>
          <p>Use the menu on the left to open an entry or a report. Your balances and charts appear here when the Dashboard report is on your menu.</p>
        </section>
      )}

      <footer className="mh-credit">Developed by <strong>Pranav Computers</strong> · Software Development</footer>
    </div>
  );
}
