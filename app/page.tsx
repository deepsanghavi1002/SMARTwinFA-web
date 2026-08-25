"use client";

import { useEffect, useRef, useState } from "react";
import { AddonMaster } from "../features/addon-master/AddonMaster";
import { DemoWorkflow, hasDemoWorkflow } from "../features/demo-workflows/DemoWorkflow";
import { resolveLegacyWorkflow, type LegacyWorkflowRoute } from "../features/navigation/legacy-workflow-router";
import { StartupGate } from "../features/startup/StartupGate";

type LegacyMenuNode = { id: number; parentId: number | null; label: string; program: string | null; action: string | null; children: LegacyMenuNode[] };
type Menu = { label: string; children?: string[] };

const fallbackMenus: Menu[] = [
  { label: "TRANSACTION", children: ["Invoice", "Cash / Bank", "Journal", "Discount", "Register", "Stock Voucher"] },
  { label: "REPORT", children: ["Bank / Cash", "Journal", "Register", "Ledger", "Outstanding", "Master", "Final Report", "Extra Report"] },
  { label: "GST", children: ["GST Reports", "E-Invoice", "E-Way Bill", "GST Utilities"] },
  { label: "INVENTORY", children: ["Stock Reports", "Stock Summary Report", "Partywise Stock", "Stock Voucher", "Master", "Challan", "Order", "Stock Movement", "Monthly Closing Stock"] },
  { label: "ANALYSIS REP.", children: ["Top Reports", "Drop Analysis", "Daily Transaction", "Target", "Pie Chart"] },
  { label: "SPECIAL", children: ["Quick Data", "Entry Approved", "Tick Option", "Last Year Detail", "Extra Entry"] },
  { label: "MASTER", children: ["Account Master", "Product Master", "Addon Master", "Book / Series", "Opening Balance"] },
  { label: "SETUP", children: ["Company", "Financial Year", "Users & Rights", "Configuration"] },
  { label: "UTILITY", children: ["Import from Excel", "Export to Tally", "Backup Data", "Lock / Unlock Data", "Multiple Invoice PDF"] },
  { label: "HELP", children: ["Software Videos", "About SMARTwinFA", "Support"] },
];

function LegacyMenuTree({ nodes, moduleLabel, onSelect }: { nodes: LegacyMenuNode[]; moduleLabel: string; onSelect: (node: LegacyMenuNode, moduleLabel: string) => void }) {
  return <>{nodes.map((node) => <div className="legacy-menu-node" key={node.id}>
    <button type="button" className={node.children.length ? "legacy-menu-branch" : "legacy-menu-leaf"} onClick={() => { if (!node.children.length) onSelect(node, moduleLabel); }}>
      <span>{node.label}</span>{node.children.length ? <b>›</b> : null}
    </button>
    {node.children.length ? <div className="legacy-menu-subtree"><LegacyMenuTree nodes={node.children} moduleLabel={moduleLabel} onSelect={onSelect} /></div> : null}
  </div>)}</>;
}

function LegacyMenuMigrationStatus({ node, moduleLabel }: { node: LegacyMenuNode; moduleLabel: string }) {
  return <section className="real-workflow-pending" aria-label="Legacy workflow migration status">
    <header><strong>{node.label}</strong><span>{moduleLabel} · menu #{node.id}</span></header>
    <div><h2>Legacy workflow catalogued</h2><p>Desktop program: {node.program ?? "not recorded"} · action: {node.action ?? "not recorded"}.</p><p>This leaf is sourced from the restored MenuMaster hierarchy. Its form, inputs, side effects, permissions, and reports are now tracked for conversion; no sample records or simulated completion are shown.</p></div>
  </section>;
}

export default function Home() {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState("Home");
  const [legacyMenus, setLegacyMenus] = useState<LegacyMenuNode[] | null>(null);
  const [legacySelection, setLegacySelection] = useState<{ node: LegacyMenuNode; moduleLabel: string; route: LegacyWorkflowRoute | null } | null>(null);
  const [suspendHoverMenu, setSuspendHoverMenu] = useState(false);
  const [runtimeContext, setRuntimeContext] = useState<{ company: string; year: string } | null>(null);
  const menuBar = useRef<HTMLDivElement>(null);
  const activeLabel = activeItem.includes("::") ? activeItem.slice(activeItem.lastIndexOf("::") + 2) : activeItem;
  const goHome = () => {
    setActiveItem("Home");
    setLegacySelection(null);
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

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/legacy/menu", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { const body = await response.json() as { roots?: LegacyMenuNode[] }; if (!response.ok || !body.roots) throw new Error("Menu catalog unavailable"); return body.roots; })
      .then(setLegacyMenus)
      .catch(() => setLegacyMenus(null));
    return () => controller.abort();
  }, []);

  const selectLegacyMenu = (node: LegacyMenuNode, moduleLabel: string) => {
    setLegacySelection({ node, moduleLabel, route: resolveLegacyWorkflow(node, moduleLabel) });
    setActiveItem(`legacy::${node.id}`);
    setOpenMenu(null);
    setSuspendHoverMenu(true);
  };
  const menuRoots = legacyMenus ?? fallbackMenus.map((menu, index) => ({ id: -(index + 1), parentId: null, label: menu.label, program: null, action: null, children: (menu.children ?? []).map((label, childIndex) => ({ id: -((index + 1) * 1000 + childIndex + 1), parentId: -(index + 1), label, program: null, action: null, children: [] })) }));

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/legacy/startup", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as { companies?: Array<{ name: string }>; years?: Array<{ label: string }> };
        if (!response.ok) throw new Error("Startup context unavailable");
        setRuntimeContext({
          company: body.companies?.[0]?.name ?? "Restored company database",
          year: body.years?.[0]?.label ?? "Accounting year unavailable",
        });
      })
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setRuntimeContext(null);
      });
    return () => controller.abort();
  }, []);

  return <StartupGate>{(
    <main className={`winfa-window ${activeItem !== "Home" ? "content-active" : ""}`}>
      <header className="title-bar"><button className="title-home" type="button" onClick={goHome} aria-label="Go to homepage"><span className="app-mark">S</span><strong>SMARTwinFA</strong></button><div className="window-controls"><button aria-label="Minimize">—</button><button aria-label="Maximize">□</button><button aria-label="Close">×</button></div></header>

      <div className={`menu-bar ${suspendHoverMenu ? "suspend-hover" : ""}`} ref={menuBar} role="menubar" tabIndex={0} aria-label="SMARTwinFA application menu" onMouseLeave={() => setSuspendHoverMenu(false)}>
        {menuRoots.map((menu) => (
          <div className="menu-root" key={menu.id}>
            <button className={openMenu === menu.label ? "open" : ""} onClick={() => { setSuspendHoverMenu(false); setOpenMenu(openMenu === menu.label ? null : menu.label); }} role="menuitem" aria-expanded={openMenu === menu.label}>{menu.label}</button>
            <div className={`dropdown legacy-menu-dropdown ${openMenu === menu.label ? "open-menu" : ""}`} role="menu"><LegacyMenuTree nodes={menu.children} moduleLabel={menu.label} onSelect={selectLegacyMenu} /></div>
          </div>
        ))}
      </div>

      {openMenu && <>
        <button className="mobile-menu-backdrop" aria-label="Close menu" onClick={() => setOpenMenu(null)} />
        <div className="mobile-dropdown" role="menu" aria-label={`${openMenu} menu`}>
          <strong>{openMenu}</strong>
          {menuRoots.find((menu) => menu.label === openMenu)?.children.map((child) => <button key={child.id} role="menuitem" onClick={() => { if (!child.children.length) selectLegacyMenu(child, openMenu); }} disabled={child.children.length > 0}>{child.label}<b>{child.children.length ? "›" : ""}</b></button>)}
        </div>
      </>}

      <section className="context-strip">
        <strong>▦ {runtimeContext?.company ?? "Loading restored company…"}</strong><span>▣ Year: {runtimeContext?.year ?? "Loading…"}</span><span>♙ User: SRP (migration access)</span><span className="running">{activeItem === "Home" ? "Layout　◉ Color" : `Menu: ${(legacySelection?.node.label ?? activeLabel).toUpperCase().replaceAll(" ", "_")}`}</span>
      </section>

      <section className={`work-area ${legacySelection || activeLabel === "Addon Master" || hasDemoWorkflow(activeItem) ? "workflow-open" : ""}`}>
        {legacySelection?.route?.kind === "addon" ? <AddonMaster /> : legacySelection?.route?.kind === "demo" ? <DemoWorkflow key={`${legacySelection.node.id}:${legacySelection.route.workflowId}`} activeItem={legacySelection.route.workflowId} /> : legacySelection ? <LegacyMenuMigrationStatus node={legacySelection.node} moduleLabel={legacySelection.moduleLabel} /> : activeLabel === "Addon Master" || activeItem === "Addon Master" ? <AddonMaster /> : hasDemoWorkflow(activeItem) ? <DemoWorkflow key={activeItem} activeItem={activeItem} /> : <div className="home-splash" aria-label="SMART WINFA homepage">
          <div className="home-brand"><div className="home-splash-logo" role="img" aria-label="SMART WINFA logo" /><strong>SMART WINFA</strong><span>Modern Technology. Simple Accounting. Smart Business. ●</span></div>
          <aside className="home-credit" aria-label="Developed by Pranav Computers">
            <span>DEVELOPED BY</span>
            <strong>PRANAV COMPUTERS</strong>
            <b>MO :9820144816</b>
            <b>MO :9833844816</b>
          </aside>
        </div>}
      </section>

      <footer className="status-strip"><span>{activeItem === "Home" ? "Select menu to start" : legacySelection?.route?.kind === "demo" && legacySelection.route.assumed ? `Prototype assumption: ${legacySelection.node.label} → ${legacySelection.route.workflowId}` : `Selected: ${legacySelection?.node.label ?? activeLabel}`}</span><span>Caps</span><span>Num</span><span>{legacyMenus ? `${legacyMenus.length} root menus` : "Loading menu"}</span><span>2026.01</span></footer>
    </main>
  )}</StartupGate>;
}
