"use client";

import { useEffect, useRef, useState } from "react";

type Menu = { label: string; children?: string[] };

const menus: Menu[] = [
  { label: "TRANSACTION", children: ["Invoice", "Cash / Bank", "Journal", "Discount", "Register", "Stock Voucher"] },
  { label: "REPORT", children: ["Bank / Cash", "Journal", "Register", "Ledger", "Outstanding", "Master", "Final Report", "Extra Report"] },
  { label: "GST", children: ["GST Reports", "E-Invoice", "E-Way Bill", "GST Utilities"] },
  { label: "INVENTORY", children: ["Stock Reports", "Stock Summary Report", "Partywise Stock", "Stock Voucher", "Master", "Challan", "Order", "Stock Movement", "Monthly Closing Stock"] },
  { label: "ANALYSIS REP.", children: ["Top Reports", "Drop Analysis", "Daily Transaction", "Target", "Pie Chart"] },
  { label: "MASTER", children: ["Account Master", "Product Master", "Addon Master", "Book / Series", "Opening Balance"] },
  { label: "SETUP", children: ["Company", "Financial Year", "Users & Rights", "Configuration"] },
  { label: "UTILITY", children: ["Import from Excel", "Export to Tally", "Backup Data", "Lock / Unlock Data", "Multiple Invoice PDF"] },
  { label: "HELP", children: ["Software Videos", "About SMARTwinFA", "Support"] },
];

export default function Home() {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState("Home");
  const menuBar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!menuBar.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <main className="winfa-window">
      <header className="title-bar"><span className="app-mark">S</span><strong>SMARTwinFA</strong><div className="window-controls"><button aria-label="Minimize">—</button><button aria-label="Maximize">□</button><button aria-label="Close">×</button></div></header>

      <div className="menu-bar" ref={menuBar} role="menubar" aria-label="SMARTwinFA application menu">
        {menus.map((menu) => (
          <div className="menu-root" key={menu.label}>
            <button className={openMenu === menu.label ? "open" : ""} onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)} role="menuitem" aria-expanded={openMenu === menu.label}>{menu.label}</button>
            {openMenu === menu.label && <div className="dropdown" role="menu">{menu.children?.map((child, index) => <button key={child} role="menuitem" onClick={() => { setActiveItem(child); setOpenMenu(null); }}><span>{index > 4 ? "✓" : ""}</span>{child}<b>{["REPORT","INVENTORY","MASTER"].includes(menu.label) && index > 3 ? "›" : ""}</b></button>)}</div>}
          </div>
        ))}
      </div>

      <section className="context-strip">
        <strong>DREAMHOUSE INTERIORS SOLUTIONS (PVT.) LTD.</strong><span>01/Apr/2026 to 31/Mar/2027</span><span>PRANAV</span><span className="running">{activeItem === "Home" ? "" : activeItem}</span>
      </section>

      <section className="work-area" onClick={() => setOpenMenu(null)}>
        <img src="/pranav-screen-logo.png" alt="SMART WINFA — Modern Technology. Simple Accounting. Smart Business." />
      </section>

      <footer className="status-strip"><span>{activeItem === "Home" ? "Select menu to start" : `Selected: ${activeItem}`}</span><span>Caps</span><span>Num</span><span>1 / 0</span><span>2026.01</span></footer>
    </main>
  );
}
