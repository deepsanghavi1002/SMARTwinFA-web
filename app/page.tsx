"use client";

import { useEffect, useRef, useState } from "react";
import { AddonMaster } from "../features/addon-master/AddonMaster";
import { StartupGate, useStartupSelection } from "../features/startup/StartupGate";

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
  return <StartupGate><MainMenu /></StartupGate>;
}

/**
 * The main menu shell. It renders inside StartupGate so the context strip can
 * name the company, accounting year and operator actually chosen at startup.
 */
function MainMenu() {
  const selection = useStartupSelection();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState("Home");
  const [suspendHoverMenu, setSuspendHoverMenu] = useState(false);
  const menuBar = useRef<HTMLDivElement>(null);
  const goHome = () => {
    setActiveItem("Home");
    setOpenMenu(null);
    setSuspendHoverMenu(true);
  };

  useEffect(() => {
    const close = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!menuBar.current?.contains(target) && !target.closest(".mobile-dropdown")) {
        setOpenMenu(null);
        setSuspendHoverMenu(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <main className={`winfa-window ${activeItem !== "Home" ? "content-active" : ""}`}>
      <header className="title-bar"><button className="title-home" type="button" onClick={goHome} aria-label="Go to homepage"><span className="app-mark">S</span><strong>SMARTwinFA</strong></button><div className="window-controls"><button aria-label="Minimize">—</button><button aria-label="Maximize">□</button><button aria-label="Close">×</button></div></header>

      <div className={`menu-bar ${suspendHoverMenu ? "suspend-hover" : ""}`} ref={menuBar} role="menubar" tabIndex={0} aria-label="SMARTwinFA application menu" onMouseLeave={() => setSuspendHoverMenu(false)}>
        {/* Sidebar heading; the classic view hides it. */}
        <span className="menu-bar-title" aria-hidden="true">☰ Menu</span>
        {menus.map((menu) => (
          <div className="menu-root" key={menu.label}>
            <button className={openMenu === menu.label ? "open" : ""} onClick={() => { setSuspendHoverMenu(false); setOpenMenu(openMenu === menu.label ? null : menu.label); }} role="menuitem" aria-expanded={openMenu === menu.label}>{menu.label}</button>
            <div className={`dropdown ${openMenu === menu.label ? "open-menu" : ""}`} role="menu">{menu.children?.map((child, index) => <button key={child} role="menuitem" onClick={() => { setActiveItem(child); setOpenMenu(null); setSuspendHoverMenu(true); }}><span>{index > 4 ? "✓" : ""}</span>{child}<b>{["REPORT","INVENTORY","MASTER"].includes(menu.label) && index > 3 ? "›" : ""}</b></button>)}</div>
          </div>
        ))}
      </div>

      {openMenu && <>
        <button className="mobile-menu-backdrop" aria-label="Close menu" onClick={() => setOpenMenu(null)} />
        <div className="mobile-dropdown" role="menu" aria-label={`${openMenu} menu`}>
          <strong>{openMenu}</strong>
          {menus.find((menu) => menu.label === openMenu)?.children?.map((child) => (
            <button key={child} role="menuitem" onClick={() => { setActiveItem(child); setOpenMenu(null); setSuspendHoverMenu(true); }}>{child}<b>›</b></button>
          ))}
        </div>
      </>}

      <section className="context-strip">
        <strong>▤ {selection?.companyName ?? "…"}</strong>
        <span>▦ Year: {selection?.yearLabel ?? "…"}</span>
        <span>♙ User: {selection?.loginName ?? "…"}</span>
        <span className="running">{activeItem === "Home" ? "" : activeItem}</span>
        <div className="context-tools">
          <button type="button">▤ Layout</button>
          <button type="button">⚙ Color</button>
        </div>
      </section>

      <section className={`work-area ${activeItem === "Addon Master" ? "workflow-open" : ""}`}>
        {/* The SMART WINFA artwork already carries the logo, the tagline and
            the Pranav Computers credit, so it is drawn as one background
            rather than reassembled from separate elements. */}
        {activeItem === "Addon Master" ? <AddonMaster /> : <div className="home-splash" role="img" aria-label="SMART WINFA — Modern Technology. Simple Accounting. Smart Business. Developed by Pranav Computers." />}
      </section>

      <footer className="status-strip"><span>{activeItem === "Home" ? "Select menu to start" : `Selected: ${activeItem}`}</span><span>Caps</span><span>Num</span><span>1 / 0</span><span>2026.07</span></footer>
    </main>
  );
}
