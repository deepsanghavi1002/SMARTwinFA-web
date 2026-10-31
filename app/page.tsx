"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MasterProgram } from "../features/master-program/MasterProgram";
import { SmallEntry } from "../features/small-entry/SmallEntry";
import { Entry } from "../features/entry/Entry";
import { ReportCombine } from "../features/report/ReportCombine";
import { ZoomContext } from "../features/report/zoom";
import type { PivotHint, SumifHint } from "../lib/report/pivotHint";
import type { ZoomTarget } from "../features/report/zoom";
import { PieChart } from "../features/piechart/PieChart";
import { YearChart } from "../features/yearchart/YearChart";
import { Dashboard } from "../features/dashboard/Dashboard";
import { SecurityRights } from "../features/security/SecurityRights";
import { UserCompanyRights } from "../features/security/UserCompanyRights";
import { UserYearRights } from "../features/security/UserYearRights";
import { UserDashboardRights } from "../features/security/UserDashboardRights";
import { TransportEntry } from "../features/transport/TransportEntry";
import { Notepad } from "../features/utility/Notepad";
import { CheckGstNo } from "../features/utility/CheckGstNo";
import { RepostData } from "../features/utility/RepostData";
import { TransferBalance } from "../features/utility/TransferBalance";
import { AskAi } from "../features/ask/AskAi";
import { isMessageBoxOpen, messageBox } from "../features/ui/MessageBox";
import { PanBar } from "../features/ui/PanBar";
import { WindowActiveProvider } from "../features/ui/activeWindow";
import { WindowLinkProvider } from "../features/ui/windowLink";
import { IdleGuard } from "../features/startup/IdleGuard";
import { StartupGate, useStartupActions, useStartupSelection, useViewMode } from "../features/startup/StartupGate";
import { ModernHome } from "../features/home/ModernHome";

/**
 * The menu is data, not application code: it is read from
 * smart_setup.menumaster for the company that was opened, exactly as the
 * desktop's Main_Menu_New reads it. A client whose menumaster differs sees a
 * different menu without the software changing, so nothing here is hardcoded.
 */
type MenuNode = {
  id: number;
  label: string;
  /** The letter MenuText marks with "&" and where it is in the label (null / -1: none marked). */
  accessKey?: string | null;
  accessIndex?: number;
  shortcut: string | null;
  actionCode: string | null;
  programName: string | null;
  actionMenu: string | null;
  menuShortName: string | null;
  children: MenuNode[];
};

/** A menu row's letter: the one MenuText marks with "&", else the label's first letter or digit (as Windows menus do). */
/** A screen shows its busy symbol (Loading, Generating report ...): the menu takes no click or key meanwhile. */
const screenBusy = () => typeof document !== "undefined" && document.querySelector(".rp-working") !== null;

function menuKey(node: MenuNode): string {
  if (node.accessKey) return node.accessKey.toUpperCase();
  return (node.label.match(/[A-Za-z0-9]/)?.[0] ?? "").toUpperCase();
}

/** The label with its letter underlined (the underline shows while the menus are used from the keyboard). */
function MenuLabel({ node }: { node: MenuNode }) {
  const key = menuKey(node);
  let at = node.accessKey && node.accessIndex !== undefined && node.accessIndex >= 0 && node.label.charAt(node.accessIndex).toUpperCase() === key ? node.accessIndex : -1;
  if (at < 0) at = node.label.toUpperCase().indexOf(key);
  if (key === "" || at < 0) return <>{node.label}</>;
  return <>{node.label.slice(0, at)}<u className="menu-key">{node.label.charAt(at)}</u>{node.label.slice(at + 1)}</>;
}

/** At most this many program windows open at once (each keeps its grid in memory). */
const MAX_WINDOWS = 10;

type Screen = "home" | "master" | "small-entry" | "entry" | "report" | "pie-chart" | "year-chart" | "dashboard" | "security" | "transport" | "notepad" | "check-gst" | "repost" | "transfer" | "pending";

export interface WindowInstance extends MenuNode {
  menuId: number;
  /** Zoom from a report row: the voucher (ledger key) an entry window opens on. */
  zoomLedKey?: number;
  /** Zoom from a report row: the account whose Ledger a report window opens on. */
  zoomAcCode?: number;
  /** The report runs at once, to its output grid (opened from Ask AI). */
  autoRun?: boolean;
  /** The dates the report from Ask AI is run for. */
  autoFrom?: string;
  autoTo?: string;
  /** A pivot Ask AI asked for, set up when the report has run. */
  autoPivot?: PivotHint;
  /** The question Ask AI was asked: the report picks its first combo (the register) from it. */
  autoPick?: string;
  /** The one account Ask AI named: ticked alone in the report. */
  autoParty?: { code: number; name: string };
  /** A SUMIF Ask AI asked for, worked out when the report has run. */
  autoSumif?: SumifHint;
  /** Choices and options Ask AI set on the report as it opens. */
  autoSetup?: { choices: Readonly<Record<string, string>>; checks: readonly string[] };
  /** The window this one was zoomed from (a report row's voucher or account). */
  zoomParent?: number;
}

function getNextWindowLabel(windows: WindowInstance[], baseLabel: string): string {
  if (!windows.some((w) => w.label === baseLabel)) {
    return baseLabel;
  }
  let index = 2;
  while (windows.some((w) => w.label === `${baseLabel} (${index})`)) {
    index++;
  }
  return `${baseLabel} (${index})`;
}

/**
 * Which screen a menu row maps to. Every MASTER row runs the one generic master screen for the program_top program its
 * ActionMenu names, as Main_Menu_New opens Master_ProgramGrid, every SMALL_ENTRY row the one Small_Entry screen, and every
 * REPORT row the one Report_Combine screen; other rows are answered honestly rather than dropped, so a menu that does nothing
 * can be told apart from one that is broken.
 */
const APP_LINKS: Readonly<Record<string, string>> = { U_CALCULATOR: "calculator:", U_EXCEL: "ms-excel:nft|u|/blank.xlsx", U_WINWORD: "ms-word:nft|u|/blank.docx" };

function launchApp(link: string) {
  const anchor = document.createElement("a");
  // ms-excel: / ms-word: need a command: "nft|u|<url>" opens a new document made from the file at the address (a blank one served by this program).
  anchor.href = link.replace("|u|/", `|u|${window.location.origin}/`);
  anchor.rel = "noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** The ⋮ at the right of the context strip: Legacy / Modern view (and, in Modern, Light / Dark), Lock and Log out. */
function MoreMenu({ onLock, onLogout }: { onLock: () => void; onLogout: () => void }) {
  const mode = useViewMode();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  /** Where the panel opens: under the ⋮ button at the window's right edge (fixed, so the strip cannot clip it). */
  const [place, setPlace] = useState({ top: 0, right: 0 });
  const toggle = () => {
    const rect = root.current?.getBoundingClientRect();
    if (rect) setPlace({ top: rect.bottom + 2, right: Math.max(4, window.innerWidth - rect.right) });
    setOpen((current) => !current);
  };
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const esc = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const run = (action: () => void) => () => { setOpen(false); action(); };
  return (
    <div className="more-menu" ref={root}>
      {mode?.modernView && (
        <button
          type="button"
          className="theme-toggle"
          aria-label={mode.modernTheme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={mode.modernTheme === "dark" ? "Light theme" : "Dark theme"}
          onClick={() => mode.setModernTheme(mode.modernTheme === "dark" ? "light" : "dark")}
        >
          {mode.modernTheme === "dark"
            ? <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            : <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z" /></svg>}
        </button>
      )}
      <button type="button" className="more-button" aria-label="More" aria-haspopup="menu" aria-expanded={open} title="More" onClick={toggle}>⋮</button>
      {open && (
        <div className="more-panel" role="menu" style={{ top: place.top, right: place.right }}>
          {mode && <button type="button" role="menuitemradio" aria-checked={!mode.modernView} onClick={run(() => mode.setModernView(false))}><span>{mode.modernView ? "" : "✓"}</span>Legacy</button>}
          {mode && <button type="button" role="menuitemradio" aria-checked={mode.modernView} onClick={run(() => mode.setModernView(true))}><span>{mode.modernView ? "✓" : ""}</span>Modern</button>}
          {mode?.modernView && <button type="button" role="menuitemradio" aria-checked={mode.modernTheme === "light"} onClick={run(() => mode.setModernTheme("light"))}><span>{mode.modernTheme === "light" ? "✓" : ""}</span>Light theme</button>}
          {mode?.modernView && <button type="button" role="menuitemradio" aria-checked={mode.modernTheme === "dark"} onClick={run(() => mode.setModernTheme("dark"))}><span>{mode.modernTheme === "dark" ? "✓" : ""}</span>Dark theme</button>}
          <hr />
          <button type="button" role="menuitem" onClick={run(onLock)}><span>🔒</span>Lock</button>
          <button type="button" role="menuitem" onClick={run(onLogout)}><span>⏻</span>Log out</button>
        </div>
      )}
    </div>
  );
}

function screenOf(node: MenuNode | null): Screen {
  if (node === null) return "home";
  const code = node.actionCode?.toUpperCase();
  if (code === "MASTER" && node.actionMenu) return "master";
  if (code === "SMALL_ENTRY" && node.actionMenu) return "small-entry";
  if (code === "ENTRY" && ["INVOICE", "VOUCHER"].includes(node.actionMenu?.toUpperCase() ?? "")) return "entry";
  if (code === "REPORT" && node.actionMenu) return "report";
  if ((code === "SECURITY_MENU" || code === "USER_COMPANY_RIGHTS" || code === "USER_YEAR_RIGHTS" || code === "USER_DASHBOARD_RIGHTS") && node.actionMenu) return "security";
  if (code === "TRANSPORT_ENTRY" && node.actionMenu) return "transport";
  if (code === "U_NOTEPAD") return "notepad";
  if (code === "UTILITY_CHECK_GSTNO" && node.actionMenu) return "check-gst";
  if (code === "REPOST_DATA") return "repost";
  if (code === "TRANSFER_DATA") return "transfer";
  if (code === "PIE_CHART" && node.actionMenu) return "pie-chart";
  if (code === "PIE_YEAR_CHART" && node.actionMenu) return "year-chart";
  if ((code === "REP_DASHBOARD" || code === "YEAR_DASHBOARD") && node.actionMenu) return "dashboard";
  return "pending";
}

export default function Home() {
  return <StartupGate><MainMenu /></StartupGate>;
}

/**
 * The main menu shell. It renders inside StartupGate so the context strip can
 * name the company, accounting year and operator actually chosen at startup.
 */
function MainMenu() {
  const selection = useStartupSelection();
  const view = useViewMode();
  const startup = useStartupActions();
  const [menus, setMenus] = useState<MenuNode[]>([]);
  const [menuError, setMenuError] = useState("");
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const [openSub, setOpenSub] = useState<number | null>(null);
  /**
   * The program windows open, as the desktop's MDI windows, in the order they were opened, and the one in front (null: the home
   * screen). Each is the menu row that opened it: the whole node, not just its label, since programName is what the desktop
   * dispatches on and two menus can carry the same label ("Master" under Addon and under Product). A window behind keeps its
   * selection, grid and scroll; opening a row that is already open brings its window to the front.
   */
  const [windows, setWindows] = useState<WindowInstance[]>([]);
  const nextWindowId = useRef(1);
  const [activeId, setActiveId] = useState<number | null>(null);
  /** The windows by when they were last in front, newest last: closing one brings back the one used before it. */
  const recent = useRef<number[]>([]);
  /** Each window's own close (its Quit, which asks about unsaved work), when its screen gives one. */
  const closers = useRef(new Map<number, () => void>());
  const setCloser = useCallback((id: number, close: (() => void) | null) => { if (close) closers.current.set(id, close); else closers.current.delete(id); }, []);
  const [windowListOpen, setWindowListOpen] = useState(false);
  /** Windows minimized from their tab: open, but not shown until their tab is clicked again. */
  const [minimized, setMinimized] = useState<ReadonlySet<number>>(() => new Set());
  /** Where the keyboard was in each window: brought to the front, a window has it there again. */
  const lastFocus = useRef(new Map<number, HTMLElement>());
  useEffect(() => {
    if (activeId === null) return;
    const element = lastFocus.current.get(activeId);
    if (!element) return;
    // After the window stops being inert (this render), so it can take the focus.
    requestAnimationFrame(() => { if (element.isConnected) element.focus({ preventScroll: true }); });
  }, [activeId]);
  const running = windows.find((node) => node.id === activeId) ?? null;
  const activeItem = running?.label ?? "Home";
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activeId !== null && tabsRef.current) {
      const activeEl = tabsRef.current.querySelector(".window-tab-on") as HTMLElement | null;
      if (activeEl) {
        const container = tabsRef.current;
        const left = activeEl.offsetLeft;
        const right = left + activeEl.offsetWidth;
        if (left < container.scrollLeft) {
          container.scrollTo({ left, behavior: "smooth" });
        } else if (right > container.scrollLeft + container.clientWidth) {
          container.scrollTo({ left: right - container.clientWidth, behavior: "smooth" });
        }
      }
    }
  }, [activeId]);
  const [suspendHoverMenu, setSuspendHoverMenu] = useState(false);
  const menuBar = useRef<HTMLDivElement>(null);
  /** The menus are being used from the keyboard: their letters are underlined. */
  const [keyboardMenus, setKeyboardMenus] = useState(false);

  /** The Ask AI panel (questions answered from the open company's data). */
  const [askOpen, setAskOpen] = useState(false);
  /** Minimized: only its title bar shows (bottom right), the question and answer are kept. */
  const [askMin, setAskMin] = useState(false);
  /** The screen saver is up: the windows stay open behind it until the operator's password lifts it. */
  const [locked, setLocked] = useState(false);
  /** Lock needs the operator's screen saver password (USER_SCREEN_PW): none set, the desktop's message shows instead (nothing when the idle timer asks). */
  const lockLoginName = selection?.loginName ?? "";
  const lockWith = useCallback(async (silent: boolean) => {
    try {
      const response = await fetch("/api/unlock", { method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", body: JSON.stringify({ action: "status", loginName: lockLoginName }) });
      const body = await response.json() as { set?: boolean; error?: string };
      if (!response.ok) throw new Error(body.error || "The screen saver password could not be checked");
      if (body.set) setLocked(true);
      else if (!silent) await messageBox.alert("Screen Saver Password Not Set... Please Input Screen Saver Password In User Password Menu", "Screen Saver", "warning");
    } catch (reason) {
      if (!silent) await messageBox.alert(reason instanceof Error ? reason.message : "The screen saver password could not be checked", "Screen Saver", "error");
    }
  }, [lockLoginName]);
  const lock = useCallback(() => { void lockWith(true); }, [lockWith]);
  const lockNow = () => { closeMenus(); void lockWith(false); };
  const unlock = useCallback(() => setLocked(false), []);
  /** Log out (also the auto-logoff and the lock's own Log out): the windows go with the screen. */
  const logoutNow = useCallback(() => { setLocked(false); startup?.logout(); }, [startup]);
  const askLogout = async () => {
    closeMenus();
    const open = windows.length;
    if (!(await messageBox.confirm(open > 0 ? `Log out ?
The ${open} open window${open === 1 ? "" : "s"} will close, and work not saved is lost.` : "Log out ?", "Log Out"))) return;
    logoutNow();
  };

  /** Phones and small tablets: the menu is an off-canvas drawer opened from the title bar's ☰ (the sidebar on wider screens). */
  const [navOpen, setNavOpen] = useState(false);
  const navToggle = useRef<HTMLButtonElement>(null);
  const closeMenus = () => { setOpenMenu(null); setOpenSub(null); setKeyboardMenus(false); setNavOpen(false); };
  const bringToFront = (id: number | null) => {
    setActiveId(id);
    if (id !== null) setMinimized((set) => { if (!set.has(id)) return set; const next = new Set(set); next.delete(id); return next; });
    if (id !== null) recent.current = [...recent.current.filter((other) => other !== id), id];
  };
  /** The home screen: the windows stay open behind it. */
  const goHome = () => {
    setActiveId(null);
    closeMenus();
    setSuspendHoverMenu(true);
  };
  const closeWindow = (id: number) => {
    closers.current.delete(id);
    lastFocus.current.delete(id);
    recent.current = recent.current.filter((other) => other !== id);
    setWindows((list) => list.filter((node) => node.id !== id));
    setMinimized((set) => { if (!set.has(id)) return set; const next = new Set(set); next.delete(id); return next; });
    setActiveId((current) => (current === id ? nextShown(id) : current));
  };
  /** The window to show when `leaving` goes: the one used last before it that is not minimized, else the home screen. */
  const nextShown = (leaving: number) => [...recent.current].reverse().find((other) => other !== leaving && !minimized.has(other)) ?? null;
  /** A tab's ─: the window goes out of sight (still open, its tab dimmed); the one used before it comes back. */
  const minimizeWindow = (id: number) => {
    setMinimized((set) => new Set(set).add(id));
    if (activeId === id) setActiveId(nextShown(id));
  };
  /** "Close All Open Windows": one question when a master or entry is open (each would ask on its own), then all close. */
  const closeAllWindows = async () => {
    setWindowListOpen(false);
    if (windows.some((node) => closers.current.has(node.id)) && !(await messageBox.confirm(`Close All ${windows.length} Open Windows ?`))) return;
    closers.current.clear();
    lastFocus.current.clear();
    recent.current = [];
    setWindows([]);
    setMinimized(new Set());
    setActiveId(null);
  };
  /** A window's ×: its screen's own Quit when it gives one (in front, so its question shows over it), else straight away. */
  const requestClose = (id: number) => {
    const closer = closers.current.get(id);
    if (!closer) { closeWindow(id); return; }
    bringToFront(id);
    closer();
  };
  /** Windows whose zoom windows changed data since they last ran: each runs its report again when it is next in front. */
  const [stale, setStale] = useState<ReadonlySet<number>>(() => new Set());
  const markChanged = (id: number) => {
    const chain: number[] = [];
    let parent = windows.find((open) => open.id === id)?.zoomParent;
    while (parent !== undefined && !chain.includes(parent)) { chain.push(parent); parent = windows.find((open) => open.id === parent)?.zoomParent; }
    if (chain.length > 0) setStale((current) => new Set([...current, ...chain]));
  };
  const clearStale = (id: number) => setStale((current) => { if (!current.has(id)) return current; const next = new Set(current); next.delete(id); return next; });

  /** Zoom from a report row (Enter): the entry program of the voucher opens in a window of its own, on that voucher. */
  const openZoom = (target: ZoomTarget) => {
    const wanted = (target.entryName ?? target.reportName ?? "").toUpperCase();
    const screen = target.entryName ? "entry" : "report";
    const found = (list: MenuNode[]): MenuNode | null => { for (const node of list) { if (screenOf(node) === screen && node.actionMenu?.toUpperCase() === wanted) return node; const inner = found(node.children); if (inner) return inner; } return null; };
    const node = found(menus);
    if (!node) { void messageBox.alert(`The ${wanted} program is not in this company's menu, so it cannot be opened.`, "Zoom", "warning"); return; }
    if (windows.length >= MAX_WINDOWS) { void messageBox.alert(`${MAX_WINDOWS} windows are open already.\nClose one (× on its tab) to open it.`, "Too Many Windows", "warning"); return; }
    const winId = nextWindowId.current++;
    setWindows((list) => [...list, { ...node, id: winId, menuId: node.id, label: getNextWindowLabel(list, node.label), ...(activeId !== null ? { zoomParent: activeId } : {}), ...(target.entryName ? { zoomLedKey: target.ledKey } : { zoomAcCode: target.acCode, ...(target.acCode && target.from && target.to ? { autoFrom: target.from, autoTo: target.to } : {}), ...(target.run ? { autoRun: true, ...(target.from && target.to ? { autoFrom: target.from, autoTo: target.to } : {}), ...(target.pivot ? { autoPivot: target.pivot } : {}), ...(target.pick ? { autoPick: target.pick } : {}), ...(target.party ? { autoParty: target.party } : {}), ...(target.sumif ? { autoSumif: target.sumif } : {}), ...(target.setup ? { autoSetup: target.setup } : {}) } : {}) }) }]);
    bringToFront(winId);
  };

  const choose = (node: MenuNode) => {
    // UTILITY > Calculator / Excel / Word (Main_Menu_New U_CALCULATOR, U_EXCEL, U_WINWORD start calc.exe, excel.exe, winword.exe): the PC's own
    // program, opened through its Windows app link (the browser asks once to allow it).
    const appLink = APP_LINKS[node.actionCode?.toUpperCase() ?? ""];
    if (appLink) {
      closeMenus();
      launchApp(appLink);
      return;
    }
    // UTILITY > Get E Invoice Token: no window, the gateway is asked and the answer shown in a message (Main_Menu_New EINVOICE_TOKEN).
    if (node.actionCode?.toUpperCase() === "EINVOICE_TOKEN" && node.actionMenu && selection) {
      closeMenus();
      void (async () => {
        try {
          const response = await fetch("/api/einvoice-token", {
            method: "POST",
            headers: { "content-type": "application/json" },
            cache: "no-store",
            body: JSON.stringify({ menuShortName: node.menuShortName ?? "", session: { companyId: Number(selection.companyId), yearKey: selection.yearKey, loginName: selection.loginName } }),
          });
          const body = await response.json() as { kind?: string; message?: string; error?: string };
          if (!response.ok || !body.message) throw new Error(body.error || "The request failed");
          await messageBox.alert(body.message, "EINVOICE GST Token", body.kind === "created" ? "info" : "warning");
        } catch (reason) {
          await messageBox.alert(reason instanceof Error ? reason.message : "The request failed", "EINVOICE GST Token", "error");
        }
      })();
      return;
    }
    // SETUP > COMPANY > SELECT: the company and accounting year selection, as after the login.
    if (node.actionCode?.toUpperCase() === "COMPANY_SELECT" && startup) {
      closeMenus();
      startup.changeCompany();
      return;
    }
    closeMenus();
    setSuspendHoverMenu(true);

    // If an instance of this menu is minimized, restore it to front:
    const minWin = windows.find((open) => open.menuId === node.id && minimized.has(open.id));
    if (minWin) {
      bringToFront(minWin.id);
      return;
    }

    // If an instance of this menu is already open, but NOT currently active in front, switch to it:
    const anyActiveForThisMenu = windows.some((open) => open.menuId === node.id && open.id === activeId);
    const backgroundWin = windows.find((open) => open.menuId === node.id && open.id !== activeId);
    if (!anyActiveForThisMenu && backgroundWin) {
      bringToFront(backgroundWin.id);
      return;
    }

    // Otherwise (this menu is already active in front, or not open at all), open a new window instance:
    if (windows.length >= MAX_WINDOWS) {
      void messageBox.alert(`${MAX_WINDOWS} windows are open already.\nClose one (× on its tab) to open ${node.label}.`, "Too Many Windows", "warning");
      return;
    }
    const winId = nextWindowId.current++;
    const label = getNextWindowLabel(windows, node.label);
    const newWindow: WindowInstance = {
      ...node,
      id: winId,
      menuId: node.id,
      label,
    };
    setWindows((list) => [...list, newWindow]);
    bringToFront(winId);
  };

  // Another company, year or operator: the windows were of the one before, so they all close (while rendering, as React
  // advises for state that follows a prop; the closers and the recent list drop the windows that are gone as they are used).
  const sessionKey = `${selection?.companyName ?? ""}|${selection?.yearLabel ?? ""}|${selection?.loginName ?? ""}`;
  const [sessionOfWindows, setSessionOfWindows] = useState(sessionKey);
  if (sessionOfWindows !== sessionKey) {
    setSessionOfWindows(sessionKey);
    setWindows([]);
    setActiveId(null);
    setMinimized(new Set());
  }

  // Ctrl+Tab / Ctrl+F6 (with Shift: back): the next / previous open window, as the desktop's MDI windows; a minimized one comes back.
  const windowsNow = useRef<WindowInstance[]>([]);
  useEffect(() => { windowsNow.current = windows; }, [windows]);
  const activeIdNow = useRef<number | null>(null);
  useEffect(() => { activeIdNow.current = activeId; }, [activeId]);
  const bringToFrontNow = useRef(bringToFront);
  useEffect(() => { bringToFrontNow.current = bringToFront; });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.key !== "F6" && event.key !== "Tab") || !event.ctrlKey || event.altKey || event.metaKey || isMessageBoxOpen() || screenBusy()) return;
      const list = windowsNow.current;
      if (list.length === 0) return;
      event.preventDefault();
      const at = list.findIndex((node) => node.id === activeIdNow.current);
      const next = list[(at + (event.shiftKey ? -1 : 1) + list.length) % list.length];
      bringToFrontNow.current(next.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The browser's Back button: the whole program is one page, so Back would leave it for the previous site.
  // It shows the home screen (the windows stay open behind it) and otherwise stays where it is.
  const runningNow = useRef<MenuNode | null>(null);
  useEffect(() => { runningNow.current = running; }, [running]);
  useEffect(() => {
    // Chrome skips a history entry the page added without a click or key press, so the page keeps two entries
    // of its own ahead of the visitor and tops them up from a real click or key press (those are never skipped).
    const guard = { smartwinfa: true };
    let depth = 0;
    const push = () => { window.history.pushState(guard, ""); depth += 1; };
    push();
    const onGesture = () => { if (depth < 2) push(); };
    const onBack = () => {
      depth = Math.max(0, depth - 1);
      if (depth < 2) push();
      if (runningNow.current) {
        setActiveId(null);
        setOpenMenu(null);
        setOpenSub(null);
        setSuspendHoverMenu(true);
      }
    };
    window.addEventListener("popstate", onBack);
    window.addEventListener("pointerdown", onGesture, { capture: true, passive: true });
    window.addEventListener("keydown", onGesture, { capture: true, passive: true });
    return () => {
      window.removeEventListener("popstate", onBack);
      window.removeEventListener("pointerdown", onGesture, { capture: true });
      window.removeEventListener("keydown", onGesture, { capture: true });
    };
  }, []);

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
      const target = event.target instanceof Element ? event.target : (event.target as Node | null)?.parentElement;
      if (!target?.closest(".window-list, .bottom-nav-windows")) setWindowListOpen(false);
      if (!menuBar.current?.contains(target ?? null) && !target?.closest(".nav-toggle, .bottom-nav-menu")) {
        closeMenus();
        setSuspendHoverMenu(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  // The drawer: Escape closes it and hands the focus back to its ☰; it is a drawer only on small screens, so widening the window closes it;
  // opening it moves the focus to its first row (the rest of the window is inert meanwhile).
  useEffect(() => {
    if (!navOpen) return;
    const wide = window.matchMedia("(min-width: 781px)");
    const onWide = () => { if (wide.matches) setNavOpen(false); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isMessageBoxOpen()) return;
      event.preventDefault();
      setNavOpen(false);
      setOpenMenu(null);
      setOpenSub(null);
      navToggle.current?.focus();
    };
    const frame = requestAnimationFrame(() => menuBar.current?.querySelector<HTMLButtonElement>("[data-menu-root]")?.focus({ preventScroll: true }));
    wide.addEventListener("change", onWide);
    document.addEventListener("keydown", onKey);
    return () => { cancelAnimationFrame(frame); wide.removeEventListener("change", onWide); document.removeEventListener("keydown", onKey); };
  }, [navOpen]);

  // An open submenu stays inside the window: a long one (REPORT › Extra Report) is moved up until its last row shows, one taller
  // than the window scrolls, and one that would run off the right opens to the left of its row.
  useLayoutEffect(() => {
    const fit = () => {
      const margin = 6;
      for (const panel of menuBar.current?.querySelectorAll<HTMLElement>(".open-branch > .submenu") ?? []) {
        // The modern view's sidebar opens submenus in place: nothing to move there.
        if (getComputedStyle(panel).position !== "absolute") continue;
        panel.style.top = "";
        panel.style.left = "";
        panel.style.right = "";
        panel.style.maxHeight = "";
        panel.style.overflowY = "";
        let rect = panel.getBoundingClientRect();
        const room = window.innerHeight - 2 * margin;
        if (rect.height > room) { panel.style.maxHeight = `${room}px`; panel.style.overflowY = "auto"; rect = panel.getBoundingClientRect(); }
        const below = rect.bottom - (window.innerHeight - margin);
        if (below > 0) {
          const maxShiftUp = Math.max(0, rect.top - margin);
          const shift = Math.min(below, maxShiftUp);
          panel.style.top = `${panel.offsetTop - shift}px`;
        }
        const finalRect = panel.getBoundingClientRect();
        if (finalRect.top < margin) {
          panel.style.top = `${panel.offsetTop + (margin - finalRect.top)}px`;
        }
        if (rect.right > window.innerWidth - margin) { panel.style.left = "auto"; panel.style.right = "100%"; }
      }
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [openSub, openMenu]);

  // Keyboard, as the desktop's menu: Alt + a menu's letter opens it (Alt+T TRANSACTION, Alt+R REPORT ...) and Alt alone goes to the
  // menu bar. In a menu: up / down move, right opens a submenu (or the next menu), left goes back, Enter / Space opens or runs, a row's
  // letter runs it (or moves between the rows that share it), Home / End, Esc closes. A screen's own Alt letters (data-hotkey) come first.
  const focusLater = (find: () => HTMLElement | null | undefined) => requestAnimationFrame(() => requestAnimationFrame(() => find()?.focus()));
  const rowsOf = (panel: Element | null | undefined) => (panel ? [...panel.querySelectorAll<HTMLButtonElement>(":scope > button, :scope > .menu-branch > button")] : []);
  const panelOf = (button: HTMLElement) => (button.parentElement?.classList.contains("menu-branch") ? button.parentElement.parentElement : button.parentElement);
  const topButton = (id: number) => menuBar.current?.querySelector<HTMLButtonElement>(`[data-menu-root="${id}"]`);
  const dropdownOf = (id: number) => menuBar.current?.querySelector<HTMLElement>(`[data-menu-panel="${id}"]`);
  const submenuOf = (id: number) => menuBar.current?.querySelector<HTMLElement>(`[data-sub-panel="${id}"]`);
  const openTop = (id: number, where: "first" | "last" = "first") => {
    setSuspendHoverMenu(false);
    setOpenSub(null);
    setOpenMenu(id);
    setKeyboardMenus(true);
    focusLater(() => { const rows = rowsOf(dropdownOf(id)); return where === "first" ? rows[0] : rows[rows.length - 1]; });
  };
  const openBranch = (id: number) => {
    setOpenSub(id);
    focusLater(() => rowsOf(submenuOf(id))[0]);
  };
  const nodeById = (id: number, list: MenuNode[] = menus): MenuNode | undefined => {
    for (const node of list) {
      if (node.id === id) return node;
      const found = nodeById(id, node.children);
      if (found) return found;
    }
    return undefined;
  };
  /** Runs a row from the keyboard: a branch opens with its first row in hand, anything else runs. */
  const activate = (button: HTMLButtonElement) => {
    const id = Number(button.dataset.menuId);
    const node = nodeById(id);
    if (!node) return;
    if (node.children.length) openBranch(id); else choose(node);
  };

  const menuKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (screenBusy()) { event.preventDefault(); return; }
    const button = (event.target as HTMLElement).closest?.("button");
    if (!button || !menuBar.current?.contains(button)) return;
    const index = menus.findIndex((menu) => menu.id === (button.dataset.menuRoot ? Number(button.dataset.menuRoot) : openMenu));
    const step = (by: number) => { const next = menus[(index + by + menus.length) % menus.length]; if (next) openTop(next.id); };
    const letterKey = /^[a-z0-9]$/i.test(event.key) && !event.ctrlKey && !event.altKey && !event.metaKey;
    // On the menu bar itself.
    if (button.dataset.menuRoot) {
      const id = Number(button.dataset.menuRoot);
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") { event.preventDefault(); openTop(id); }
      else if (event.key === "ArrowUp") { event.preventDefault(); openTop(id, "last"); }
      else if (event.key === "ArrowRight") { event.preventDefault(); topButton(menus[(index + 1) % menus.length].id)?.focus(); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); topButton(menus[(index - 1 + menus.length) % menus.length].id)?.focus(); }
      else if (event.key === "Escape") { event.preventDefault(); closeMenus(); button.blur(); }
      else if (letterKey) {
        const menu = menus.find((candidate) => menuKey(candidate) === event.key.toUpperCase());
        if (menu) { event.preventDefault(); openTop(menu.id); }
      }
      return;
    }
    // In a dropdown or a submenu.
    const panel = panelOf(button);
    const rows = rowsOf(panel);
    const at = rows.indexOf(button as HTMLButtonElement);
    const inSub = panel?.classList.contains("submenu") ?? false;
    const parentRow = inSub ? (panel?.parentElement?.querySelector<HTMLButtonElement>(":scope > button") ?? null) : null;
    switch (event.key) {
      case "ArrowDown": event.preventDefault(); rows[(at + 1) % rows.length]?.focus(); return;
      case "ArrowUp": event.preventDefault(); rows[(at - 1 + rows.length) % rows.length]?.focus(); return;
      case "Home": event.preventDefault(); rows[0]?.focus(); return;
      case "End": event.preventDefault(); rows[rows.length - 1]?.focus(); return;
      case "ArrowRight":
        event.preventDefault();
        if (button.parentElement?.classList.contains("menu-branch")) openBranch(Number(button.dataset.menuId));
        else step(1);
        return;
      case "ArrowLeft":
        event.preventDefault();
        if (inSub && parentRow) { setOpenSub(null); parentRow.focus(); } else step(-1);
        return;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        if (inSub && parentRow) { setOpenSub(null); parentRow.focus(); }
        else { const top = openMenu !== null ? topButton(openMenu) : null; setOpenMenu(null); setOpenSub(null); top?.focus(); }
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        activate(button as HTMLButtonElement);
        return;
    }
    if (letterKey) {
      const letter = event.key.toUpperCase();
      const matches = rows.filter((row) => row.dataset.menuKey === letter);
      if (matches.length === 0) return;
      event.preventDefault();
      if (matches.length === 1) activate(matches[0]);
      else matches[(matches.indexOf(button as HTMLButtonElement) + 1) % matches.length].focus();
    }
  };

  // Alt + a menu's letter from anywhere (after the screen's own Alt letters, which stop the key when they take it). Alt alone, pressed
  // and let go with nothing between, puts the keyboard on the menu bar (or takes it off again).
  const menusNow = useRef<MenuNode[]>([]);
  useEffect(() => { menusNow.current = menus; }, [menus]);
  const openMenuNow = useRef<number | null>(null);
  useEffect(() => { openMenuNow.current = openMenu; }, [openMenu]);
  const openTopNow = useRef(openTop);
  useEffect(() => { openTopNow.current = openTop; });
  useEffect(() => {
    let lone = false;
    const down = (event: KeyboardEvent) => {
      if (event.key === "Alt") { lone = !event.repeat || lone; return; }
      lone = false;
      if (!event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented || isMessageBoxOpen() || screenBusy()) return;
      const match = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(event.code);
      if (!match) return;
      const letter = match[1] ?? match[2];
      // Menus that share a letter are taken in turn, as Windows does.
      const sharing = menusNow.current.filter((candidate) => menuKey(candidate) === letter);
      const menu = sharing[(sharing.findIndex((candidate) => candidate.id === openMenuNow.current) + 1) % Math.max(1, sharing.length)];
      if (!menu) return;
      event.preventDefault();
      openTopNow.current(menu.id);
    };
    const up = (event: KeyboardEvent) => {
      if (event.key !== "Alt" || !lone) return;
      lone = false;
      const bar = menuBar.current;
      if (!bar || isMessageBoxOpen() || screenBusy()) return;
      event.preventDefault();
      if (bar.contains(document.activeElement)) {
        setOpenMenu(null);
        setOpenSub(null);
        setKeyboardMenus(false);
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }
      setKeyboardMenus(true);
      bar.querySelector<HTMLButtonElement>("[data-menu-root]")?.focus();
    };
    const reset = () => { lone = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", reset);
    window.addEventListener("mousedown", reset);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", reset);
      window.removeEventListener("mousedown", reset);
    };
  }, []);

  const screen = screenOf(running);

  /** One program window: its screen, mounted while the window is open, in front or not. */
  const windowScreen = (node: MenuNode) => {
    const close = () => closeWindow(node.id);
    switch (screenOf(node)) {
      case "master": return <MasterProgram programName={node.actionMenu!} menuShortName={node.menuShortName ?? ""} title={node.label} onClose={close} />;
      case "small-entry": return <SmallEntry entryName={node.actionMenu!} menuShortName={node.menuShortName ?? ""} title={node.label} onClose={close} />;
      case "entry": return <Entry entryName={node.actionMenu!} menuShortName={node.menuShortName ?? ""} title={node.label} onClose={close} zoom={(node as WindowInstance).zoomLedKey} />;
      case "report": return <ReportCombine reportName={node.actionMenu!} menuShortName={node.menuShortName ?? ""} title={node.label} onClose={close} zoomAccount={(node as WindowInstance).zoomAcCode} autoRun={(node as WindowInstance).autoRun} autoFrom={(node as WindowInstance).autoFrom} autoTo={(node as WindowInstance).autoTo} autoPivot={(node as WindowInstance).autoPivot} autoPick={(node as WindowInstance).autoPick} autoParty={(node as WindowInstance).autoParty} autoSumif={(node as WindowInstance).autoSumif} autoSetup={(node as WindowInstance).autoSetup} />;
      case "pie-chart": return <PieChart reportName={node.actionMenu!} menuShortName={node.menuShortName ?? ""} title={node.label} onClose={close} />;
      case "year-chart": return <YearChart reportName={node.actionMenu!} menuShortName={node.menuShortName ?? ""} title={node.label} onClose={close} />;
      case "security": return node.actionCode?.toUpperCase() === "USER_DASHBOARD_RIGHTS"
        ? <UserDashboardRights menuShortName={node.menuShortName ?? ""} title={node.label} onClose={close} />
        : node.actionCode?.toUpperCase() === "USER_YEAR_RIGHTS"
        ? <UserYearRights menuShortName={node.menuShortName ?? ""} title={node.label} onClose={close} />
        : node.actionCode?.toUpperCase() === "USER_COMPANY_RIGHTS"
        ? <UserCompanyRights menuShortName={node.menuShortName ?? ""} title={node.label} onClose={close} />
        : <SecurityRights menuShortName={node.menuShortName ?? ""} title={node.label} onClose={close} />;
      case "notepad": return <Notepad title={node.label} onClose={close} />;
      case "check-gst": return <CheckGstNo menuShortName={node.menuShortName ?? ""} title={node.label} onClose={close} />;
      case "repost": return <RepostData menuShortName={node.menuShortName ?? ""} title={node.label} onClose={close} />;
      case "transfer": return <TransferBalance menuShortName={node.menuShortName ?? ""} title={node.label} onClose={close} />;
      case "transport": return <TransportEntry menuShortName={node.menuShortName ?? ""} title={node.label} onClose={close} />;
      case "dashboard": return <Dashboard reportName={node.actionMenu!} menuShortName={node.menuShortName ?? ""} title={node.label} onClose={close} />;
      default: return <NotBuiltYet node={node} />;
    }
  };

  /** One dropdown row: a leaf runs, a branch opens its submenu beside it. */
  const item = (node: MenuNode) => node.children.length ? (
    <div className={`menu-branch ${openSub === node.id ? "open-branch" : ""}`} key={node.id}>
      <button role="menuitem" data-menu-id={node.id} data-menu-key={menuKey(node)} aria-expanded={openSub === node.id} aria-haspopup="menu" onClick={() => setOpenSub(openSub === node.id ? null : node.id)}>
        <span /><span><MenuLabel node={node} /></span><b>›</b>
      </button>
      <div className="submenu" role="menu" aria-label={node.label} data-sub-panel={node.id}>
        {node.children.map((child) => item(child))}
      </div>
    </div>
  ) : (
    <button key={node.id} role="menuitem" data-menu-id={node.id} data-menu-key={menuKey(node)} onClick={() => choose(node)}>
      <span /><span><MenuLabel node={node} /></span><b>{node.shortcut ?? ""}</b>
    </button>
  );

  return (
    <ZoomContext.Provider value={openZoom}>
    <main className={`winfa-window ${activeItem !== "Home" ? "content-active" : ""} ${screen === "security" || screen === "transport" || screen === "notepad" || screen === "master" || screen === "small-entry" || screen === "report" || screen === "pie-chart" || screen === "year-chart" || screen === "dashboard" ? "master-open" : ""}`}>
      {askOpen && <AskAi minimized={askMin} onMinimize={() => setAskMin(true)} onRestore={() => setAskMin(false)} onClose={() => { setAskOpen(false); setAskMin(false); }} onOpenLedger={(acCode, from, to) => { openZoom({ reportName: "REPORT_LEDGER", acCode, from, to }); setAskMin(true); }} onOpenReport={(name, from, to, pivot, pick, party, sumif, setup) => { openZoom({ reportName: name, run: true, from, to, pivot, pick, party, sumif, setup }); setAskMin(true); }} />}
      {selection && <IdleGuard companyGroup={selection.companyGroup} loginName={selection.loginName} locked={locked} onLock={lock} onUnlock={unlock} onLogoff={logoutNow} />}
      <header className="title-bar" inert={navOpen}>
        <button ref={navToggle} className="nav-toggle" type="button" aria-label="Open menu" aria-haspopup="true" aria-expanded={navOpen} aria-controls="app-nav" onClick={() => setNavOpen((open) => !open)}><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg></button>
        <button className="title-home" type="button" onClick={goHome} aria-label="Go to homepage"><img src="/pranav-icon.png" alt="" aria-hidden="true" draggable={false} style={{ width: 20, height: 20, marginRight: 6, objectFit: "contain" }} /><strong>SMARTwinFA</strong></button>
        {windows.length > 0 && (
          <>
            <div
              ref={tabsRef}
              className="window-tabs"
              role="tablist"
              aria-label="Open windows"
              onWheel={(event) => {
                if (event.deltaY !== 0) {
                  event.currentTarget.scrollLeft += event.deltaY;
                }
              }}
            >
              {windows.map((node) => {
                const on = node.id === activeId;
                const small = minimized.has(node.id);
                return (
                  <div key={node.id} className={`window-tab ${on ? "window-tab-on" : ""} ${small ? "window-tab-min" : ""}`} role="presentation">
                    <button type="button" role="tab" aria-selected={on} className="window-tab-name" title={small ? `${node.label} (minimized)` : node.label} onClick={() => bringToFront(node.id)}>{node.label}</button>
                    {/* As the desktop's tab: an open window offers Minimize, a minimized one Restore / Maximize. */}
                    {small
                      ? <button type="button" className="window-tab-btn" aria-label={`Restore / Maximize ${node.label}`} title={`Restore / Maximize ${node.label}`} onClick={() => bringToFront(node.id)}>□</button>
                      : <button type="button" className="window-tab-btn" aria-label={`Minimize ${node.label}`} title={`Minimize ${node.label}`} onClick={() => minimizeWindow(node.id)}>─</button>}
                    <button type="button" className="window-tab-x" aria-label={`Close ${node.label}`} title={`Close ${node.label}`} onClick={() => requestClose(node.id)}>×</button>
                  </div>
                );
              })}
            </div>
            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape from the list button or its menu closes the list; the box only hears the key bubble up from them */}
            <div className="window-list" onKeyDown={(event) => { if (event.key === "Escape") setWindowListOpen(false); }}>
              <button type="button" className="window-list-button" aria-haspopup="menu" aria-expanded={windowListOpen} title="Open windows (Ctrl+F6: next)" onClick={() => setWindowListOpen((open) => !open)}>{windows.length} Open ▾</button>
              {windowListOpen && (
                <div className="window-list-menu" role="menu">
                  {windows.map((node) => (
                    <button key={node.id} type="button" role="menuitemradio" aria-checked={node.id === activeId} title={node.label} onClick={() => { bringToFront(node.id); setWindowListOpen(false); }}>{node.label}{minimized.has(node.id) ? " (minimized)" : ""}</button>
                  ))}
                  <button type="button" role="menuitem" className="window-list-close-all" onClick={() => { void closeAllWindows(); setWindowListOpen(false); }}>✕ Close All Open Windows</button>
                  {activeId !== null && <button type="button" role="menuitem" className="window-list-home" onClick={() => { goHome(); setWindowListOpen(false); }}>Home</button>}
                </div>
              )}
            </div>
          </>
        )}
        <div className="window-controls"><button aria-label="Minimize">—</button><button aria-label="Maximize">□</button><button aria-label="Close">×</button></div>
      </header>

      <div id="app-nav" className={`menu-bar ${navOpen ? "nav-open" : ""} ${openMenu !== null ? "menu-open" : ""} ${suspendHoverMenu ? "suspend-hover" : ""} ${keyboardMenus ? "menu-keys" : ""}`} ref={menuBar} role="menubar" tabIndex={0} aria-label="SMARTwinFA application menu" onMouseLeave={() => setSuspendHoverMenu(false)} onKeyDown={menuKeys}>
        {/* Sidebar heading (the classic view hides it); in the phone drawer it carries the close button. */}
        <div className="menu-bar-head" role="presentation">
          <span className="menu-bar-title" aria-hidden="true">☰ Menu</span>
          <button type="button" className="nav-close" aria-label="Close menu" onClick={() => { closeMenus(); navToggle.current?.focus(); }}>×</button>
        </div>
        {menuError && <p className="menu-bar-error" role="alert">{menuError}</p>}
        {menus.map((menu) => (
          <div className="menu-root" key={menu.id}>
            <button className={openMenu === menu.id ? "open" : ""} onClick={() => { setSuspendHoverMenu(false); setOpenSub(null); setOpenMenu(openMenu === menu.id ? null : menu.id); }} role="menuitem" data-menu-root={menu.id} aria-expanded={openMenu === menu.id} aria-keyshortcuts={menuKey(menu) ? `Alt+${menuKey(menu)}` : undefined}><MenuLabel node={menu} /></button>
            <div className={`dropdown ${openMenu === menu.id ? "open-menu" : ""}`} role="menu" data-menu-panel={menu.id}>{menu.children.map((child) => item(child))}</div>
          </div>
        ))}
      </div>


      {navOpen && <button type="button" className="nav-scrim" aria-label="Close menu" tabIndex={-1} onClick={() => { closeMenus(); navToggle.current?.focus(); }} />}

      <section className="context-strip" inert={navOpen}>
        <strong>▤ {selection?.companyName ?? "…"}</strong>
        <span>▦ Year: {selection?.yearLabel ?? "…"}</span>
        <span>♙ User: {selection?.loginName ?? "…"}</span>
        <span className="running" title={activeItem === "Home" ? "" : activeItem}>
          <span>{activeItem === "Home" ? "" : activeItem}</span>
        </span>
        <div className="context-end">
          <button type="button" className="ask-button" aria-pressed={askOpen} title="Ask a question about your accounts" onClick={() => { if (!askOpen) { setAskOpen(true); setAskMin(false); } else setAskMin((min) => !min); }}>✨ Ask AI</button>
          <MoreMenu onLock={lockNow} onLogout={() => void askLogout()} />
        </div>
      </section>

      <section inert={navOpen} className={`work-area ${screen === "security" || screen === "transport" || screen === "notepad" || screen === "master" || screen === "small-entry" || screen === "entry" || screen === "report" || screen === "pie-chart" || screen === "year-chart" || screen === "dashboard" ? "workflow-open" : ""}`}>
        <div className="window-stack">
          {windows.map((node) => {
            const on = node.id === activeId;
            return (
              <div key={node.id} className={`app-window ${on ? "app-window-on" : ""}`} data-window={node.id} data-window-active={on ? "true" : undefined} inert={!on} aria-hidden={!on} onFocus={(event) => lastFocus.current.set(node.id, event.target as HTMLElement)}>
                <WindowActiveProvider active={on} windowId={node.id} onCloser={setCloser}>
                  <WindowLinkProvider value={{ stale: stale.has(node.id), clearStale: () => clearStale(node.id), changed: () => markChanged(node.id) }}>{windowScreen(node)}</WindowLinkProvider>
                </WindowActiveProvider>
              </div>
            );
          })}
          {/* Legacy: the SMART WINFA artwork already carries the logo, the tagline and the Pranav Computers credit, so it is drawn as one
              background. Modern: the company's own home (features/home/ModernHome). */}
          {activeId === null && view?.modernView && <ModernHome menus={menus} onOpen={choose} />}
          {activeId === null && !view?.modernView && <div className="home-splash" role="img" aria-label="SMART WINFA — Modern Technology. Simple Accounting. Smart Business. Developed by Pranav Computers." />}
        </div>
      </section>

      {/* Phones: the most used controls under the thumb. Wider screens do not show it. */}
      <nav className="bottom-nav" aria-label="Quick navigation" inert={navOpen}>
        <PanBar />
        <button type="button" className="bottom-nav-home" aria-current={activeId === null ? "page" : undefined} onClick={goHome}><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10" /></svg><span>Home</span></button>
        <button type="button" className="bottom-nav-menu" aria-haspopup="true" aria-expanded={navOpen} aria-controls="app-nav" onClick={() => setNavOpen(true)}><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg><span>Menu</span></button>
        <button type="button" className="bottom-nav-windows" aria-haspopup="menu" aria-expanded={windowListOpen} disabled={windows.length === 0} onClick={() => setWindowListOpen((open) => !open)}><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="14" height="12" rx="2" /><path d="M7 21h14V9" /></svg><span>Windows{windows.length > 0 ? ` (${windows.length})` : ""}</span></button>
        <button type="button" className="bottom-nav-ask" aria-pressed={askOpen} onClick={() => { if (!askOpen) { setAskOpen(true); setAskMin(false); } else setAskMin((min) => !min); }}><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" /></svg><span>Ask AI</span></button>
      </nav>

      <footer className="status-strip"><span>{menuError || (running === null ? "Select menu to start" : screen === "pending" ? `${running.label} - screen not built yet (${running.programName ?? "no program"})` : `Running: ${running.label}`)}</span><span>Caps</span><span>Num</span><span>1 / 0</span><span>2026.07</span></footer>
    </main>
    </ZoomContext.Provider>
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
