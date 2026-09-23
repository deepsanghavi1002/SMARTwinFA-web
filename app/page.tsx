"use client";

import { useEffect, useRef, useState } from "react";
import { MasterProgram } from "../features/master-program/MasterProgram";
import { LegacyReportWorkflow } from "../features/demo-workflows/LegacyReportWorkflow";
import { StartupGate, useStartupSelection } from "../features/startup/StartupGate";

/**
 * The menu is data, not application code: it is read from
 * smart_setup.menumaster for the company that was opened, exactly as the
 * desktop's Main_Menu_New reads it. A client whose menumaster differs sees a
 * different menu without the software changing, so nothing here is hardcoded.
 */
type MenuNode = {
  id: number;
  label: string;
  shortcut: string | null;
  actionCode: string | null;
  programName: string | null;
  actionMenu: string | null;
  menuShortName: string | null;
  children: MenuNode[];
};

export default function Home() {
  return <StartupGate><MainMenu /></StartupGate>;
}

/**
 * The main menu shell. It renders inside StartupGate so the context strip can
 * name the company, accounting year and operator actually chosen at startup.
 */
function MainMenu() {
  const selection = useStartupSelection();
  const [menus, setMenus] = useState<MenuNode[]>([]);
  const [menuError, setMenuError] = useState("");
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const [openSub, setOpenSub] = useState<number | null>(null);
  /**
   * The menu row the user opened. The whole node is kept, not just its label:
   * programName is the stable identifier the desktop dispatches on, and two
   * menus can carry the same label ("Master" appears under Addon and Product).
   */
  const [running, setRunning] = useState<MenuNode | null>(null);
  const activeItem = running?.label ?? "Home";
  const [suspendHoverMenu, setSuspendHoverMenu] = useState(false);
  const menuBar = useRef<HTMLDivElement>(null);

  const closeMenus = () => { setOpenMenu(null); setOpenSub(null); };
  const goHome = () => {
    setRunning(null);
    closeMenus();
    setSuspendHoverMenu(true);
  };
  const choose = (node: MenuNode) => {
    setRunning(node);
    closeMenus();
    setSuspendHoverMenu(true);
  };

  const companyGroup = selection?.companyGroup ?? "";
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/menu?group=${encodeURIComponent(companyGroup)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as { menus?: MenuNode[]; error?: string };
        if (!response.ok || !body.menus) throw new Error(body.error || "Menu could not be loaded");
        return body.menus;
      })
      .then((rows) => { setMenus(rows); setMenuError(""); })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setMenuError(reason instanceof Error ? reason.message : "Menu could not be loaded");
      });
    return () => controller.abort();
  }, [companyGroup]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!menuBar.current?.contains(target) && !target.closest(".mobile-dropdown")) {
        closeMenus();
        setSuspendHoverMenu(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const openRoot = menus.find((menu) => menu.id === openMenu);

  /**
   * Which screen the chosen menu row maps to. Every MASTER row runs the one generic master
   * screen for the program_top program its ActionMenu names, as Main_Menu_New opens
   * Master_ProgramGrid; other rows are answered honestly rather than dropped, so a menu
   * that does nothing can be told apart from one that is broken.
   */
  const reportKind = running?.actionCode?.toUpperCase() === "REPORT"
    ? ({ REPORT_DAYBOOK: "daybook", REPORT_LEDGER: "ledger", REPORT_JOURNAL: "journal-voucher" } as const)[running.actionMenu as "REPORT_DAYBOOK" | "REPORT_LEDGER" | "REPORT_JOURNAL"]
    : undefined;
  const screen = running === null ? "home"
    : running.actionCode?.toUpperCase() === "MASTER" && running.actionMenu ? "master"
    : reportKind ? "report"
    : "pending";

  /** One dropdown row: a leaf runs, a branch opens its submenu beside it. */
  const item = (node: MenuNode) => node.children.length ? (
    <div className={`menu-branch ${openSub === node.id ? "open-branch" : ""}`} key={node.id}>
      <button role="menuitem" aria-expanded={openSub === node.id} aria-haspopup="menu" onClick={() => setOpenSub(openSub === node.id ? null : node.id)}>
        <span />{node.label}<b>›</b>
      </button>
      <div className="submenu" role="menu" aria-label={node.label}>
        {node.children.map((child) => item(child))}
      </div>
    </div>
  ) : (
    <button key={node.id} role="menuitem" onClick={() => choose(node)}>
      <span />{node.label}<b>{node.shortcut ?? ""}</b>
    </button>
  );

  return (
    <main className={`winfa-window ${activeItem !== "Home" ? "content-active" : ""} ${running?.actionCode?.toUpperCase() === "MASTER" && running.actionMenu ? "master-open" : ""}`}>
      <header className="title-bar"><button className="title-home" type="button" onClick={goHome} aria-label="Go to homepage"><span className="app-mark">S</span><strong>SMARTwinFA</strong></button><div className="window-controls"><button aria-label="Minimize">—</button><button aria-label="Maximize">□</button><button aria-label="Close">×</button></div></header>

      <div className={`menu-bar ${suspendHoverMenu ? "suspend-hover" : ""}`} ref={menuBar} role="menubar" tabIndex={0} aria-label="SMARTwinFA application menu" onMouseLeave={() => setSuspendHoverMenu(false)}>
        {/* Sidebar heading; the classic view hides it. */}
        <span className="menu-bar-title" aria-hidden="true">☰ Menu</span>
        {menus.map((menu) => (
          <div className="menu-root" key={menu.id}>
            <button className={openMenu === menu.id ? "open" : ""} onClick={() => { setSuspendHoverMenu(false); setOpenSub(null); setOpenMenu(openMenu === menu.id ? null : menu.id); }} role="menuitem" aria-expanded={openMenu === menu.id}>{menu.label}</button>
            <div className={`dropdown ${openMenu === menu.id ? "open-menu" : ""}`} role="menu">{menu.children.map((child) => item(child))}</div>
          </div>
        ))}
      </div>

      {openRoot && <>
        <button className="mobile-menu-backdrop" aria-label="Close menu" onClick={closeMenus} />
        <div className="mobile-dropdown" role="menu" aria-label={`${openRoot.label} menu`}>
          <strong>{openRoot.label}</strong>
          {openRoot.children.map((child) => (
            <button key={child.id} role="menuitem" onClick={() => choose(child)}>{child.label}<b>{child.children.length ? "›" : child.shortcut ?? ""}</b></button>
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

      <section className={`work-area ${screen === "master" ? "workflow-open" : ""}`}>
        {/* The SMART WINFA artwork already carries the logo, the tagline and
            the Pranav Computers credit, so it is drawn as one background
            rather than reassembled from separate elements. */}
        {screen === "master" ? <MasterProgram key={running!.id} programName={running!.actionMenu!} menuShortName={running!.menuShortName ?? ""} title={running!.label} onClose={goHome} />
          : screen === "report" && reportKind ? <LegacyReportWorkflow key={`${running!.id}-${selection?.companyId}-${selection?.yearId}`} kind={reportKind} />
          : screen === "pending" ? <NotBuiltYet node={running!} />
          : <div className="home-splash" role="img" aria-label="SMART WINFA — Modern Technology. Simple Accounting. Smart Business. Developed by Pranav Computers." />}
      </section>

      <footer className="status-strip"><span>{menuError || (running === null ? "Select menu to start" : screen === "pending" ? `${running.label} - screen not built yet (${running.programName ?? "no program"})` : `Running: ${running.label}`)}</span><span>Caps</span><span>Num</span><span>1 / 0</span><span>2026.07</span></footer>
    </main>
  );
}

/** Shown for a menu row whose screen has not been written yet. */
function NotBuiltYet({ node }: { node: MenuNode }) {
  return (
    <div className="not-built">
      <strong>{node.label}</strong>
      <p>This screen has not been built in the web version yet.</p>
      <dl>
        <dt>Program</dt><dd>{node.programName ?? "-"}</dd>
        <dt>Type</dt><dd>{node.actionCode ?? "-"}</dd>
      </dl>
      <small>It still runs in the Windows program. Menu row #{node.id}.</small>
    </div>
  );
}
