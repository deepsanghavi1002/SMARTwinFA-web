"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStartupSelection } from "../startup/StartupGate";
import { parseDesktopDate } from "../../lib/master-program/legacy";
import type { ControlItem, HelpGrid as HelpGridData, ReportDefinition, ReportOutput, ReportSelection } from "../../lib/report/types";
import { reportCall } from "./api";
import type { Refusal } from "./api";
import { HelpGrid } from "./HelpGrid";
import { OutputGrid } from "./OutputGrid";
import type { OutputStatus } from "./OutputGrid";
import type { LogTable } from "../grid/LogViewer";
import { ReportList } from "./ReportList";
import { useEditorTools } from "../grid/EditorTools";
import { DateField } from "../grid/DateField";
import { messageBox } from "../ui/MessageBox";
import { HotkeyLabel, useAltHotkeys } from "../ui/hotkeys";
import { Icon } from "../ui/Icon";
import { ScreenStatus } from "../ui/ScreenStatus";
import { SearchCombo } from "../ui/SearchCombo";

/**
 * Report_Combine, the one screen every REPORT menu opens (Main Ledger, Day Book, Trial Balance ...).
 * The menu names a report_properties report; its selection tab (first combo, dates, groups,
 * filter / sort / format lists, the options grid and the help grids to tick from) all come from
 * that report's setup, and OK generates the output on the server (lib/report).
 *
 * Output tab: the report as the desktop's C1_OUTPUT shows it: headings, opening, entries, closing,
 * a subtotal under each group and the final total; F6 summarises to the totals, F4 shows all.
 */


/** Dates last used by a report this session (Lib_GlobalVariables rep_from_date / rep_upto_date), kept in sessionStorage. */
const LAST_DATES = "smartwinfa.report.lastDates";
function readLastDates(): { from: string; upto: string } | null {
  try { const text = sessionStorage.getItem(LAST_DATES); return text ? JSON.parse(text) as { from: string; upto: string } : null; } catch { return null; }
}
function saveLastDates(dates: { from: string; upto: string }) {
  try { sessionStorage.setItem(LAST_DATES, JSON.stringify(dates)); } catch { /* private window: the dates are not remembered */ }
}

const itemKey = (item: ControlItem) => `${item.controlValKey}|${item.value}`;
const OPTIONS_GRID = "C1_CHECKBOX";
/** The status line message as each list gets the keyboard (Lbox_Filter_Enter ...). */
const LIST_MESSAGES: Readonly<Record<string, string>> = {
  lbox_Filter: "Filters data with provided input",
  lBox_Sorting: "Sorts data with provided input",
  lBox_Formating: "Report is formatted with provided input",
  lbox_InputCols: "Report is valueted with provided input",
};
const EMPTY_TICKS: ReadonlySet<string> = new Set();
const addonKey = (row: Readonly<Record<string, string>>) => `${row.fiel_key ?? row.FIEL_KEY ?? ""}|${row.sub_code ?? row.SUB_CODE ?? ""}`;

export function ReportCombine({ reportName, menuShortName, title, onClose }: { reportName: string; menuShortName: string; title: string; onClose: () => void }) {
  const selection = useStartupSelection();
  const [def, setDef] = useState<ReportDefinition | null>(null);
  const [fatal, setFatal] = useState("");
  const [busy, setBusy] = useState("Loading");
  const [tab, setTab] = useState<"select" | "output">("select");
  const [first, setFirst] = useState("");
  const [from, setFrom] = useState("");
  const [upto, setUpto] = useState("");
  const [groups, setGroups] = useState<string[]>([]);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [columnsTicked, setColumnsTicked] = useState<string[]>([]);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [ticks, setTicks] = useState<Record<string, Set<string>>>({});
  const [helpTab, setHelpTab] = useState("");
  const [addonField, setAddonField] = useState("");
  const [focusHelp, setFocusHelp] = useState(0);
  const [output, setOutput] = useState<ReportOutput | null>(null);
  /** Each generation starts the output grid afresh (cursor, tree, borders). */
  const [outputRun, setOutputRun] = useState(0);
  const [message, setMessage] = useState("");
  /** The status line: the hot keys of the control in use, and whether the message is an error (red). */
  const [hotKeys, setHotKeys] = useState("");
  const [messageRed, setMessageRed] = useState(false);
  /** The tooltip under the mouse, shown in the status line while it is there. */
  const [tip, setTip] = useState("");
  const [version, setVersion] = useState("");
  /** Where a help grid puts its search box: the right of the help tabs' line. */
  const [findSlot, setFindSlot] = useState<HTMLSpanElement | null>(null);
  const say = useCallback((text: string, keys = "", red = false) => { setMessage(text); setHotKeys(keys); setMessageRed(red); }, []);
  const screen = useRef<HTMLDivElement>(null);
  /** The selection's list boxes, for Tab out of a help grid. */
  const listRefs = useRef<Record<string, HTMLDivElement | null>>({});
  useAltHotkeys(screen);
  const yearStart = useMemo(() => (def ? parseDesktopDate(def.dates.yearStart) : null), [def]);
  const tools = useEditorTools(yearStart);

  const call = useCallback(<T,>(action: string, payload: Record<string, unknown> = {}) => {
    if (!selection) throw new Error("No company is open");
    return reportCall<T>(selection, reportName, menuShortName, action, payload);
  }, [selection, reportName, menuShortName]);
  const refuse = (refusal: Refusal) => messageBox.ask(refusal.message, refusal.caption, ["OK"], { kind: "warning" });

  // Report_Combine_Load.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const reply = await call<{ report: ReportDefinition; warnings: string[]; version?: string }>("report");
        if (!live) return;
        const report = reply.report;
        if (report.rights.modulePassword) {
          const typed = await messageBox.prompt("Enter Module Password", "Module Password", { password: true });
          if (typed === null) { onClose(); return; }
          const check = await call<{ ok: boolean; message: string }>("module-password", { password: typed });
          if (!check.ok) { await messageBox.alert(check.message || "Invalid Password", "Module Password"); onClose(); return; }
        }
        setDef(report);
        setVersion(reply.version ?? "");
        setFirst(report.firstCombo.options[0]?.value ?? "");
        const lastDates = readLastDates();
        setFrom(report.dates.fromLast && lastDates ? lastDates.from : report.dates.from);
        setUpto(report.dates.uptoLast && lastDates ? lastDates.upto : report.dates.upto);
        setChoices(Object.fromEntries(report.controls.filter((control) => control.type === "L" || control.type === "C").map((control) => [control.name, control.items[0] ? itemKey(control.items[0]) : ""])));
        setColumnsTicked(report.controls.find((control) => control.name === "lbchk_Col_Select")?.initiallyTicked.slice() ?? []);
        setChecks(Object.fromEntries(report.checkboxes.map((check) => [check.name, check.value])));
        setTicks(Object.fromEntries(report.helps.map((help) => [help.grid, new Set<string>()])));
        setHelpTab(report.checkboxes.some((check) => check.visible) ? OPTIONS_GRID : report.helps.find((help) => report.helpTabs.includes(help.grid.replace("C1Help", "Tab_")))?.grid ?? report.helps[0]?.grid ?? "");
        if (reply.warnings.length > 0) setMessage(`Setup warnings: ${reply.warnings.length}`);
      } catch (error) {
        if (live) setFatal(error instanceof Error ? error.message : String(error));
      } finally {
        if (live) setBusy("");
      }
    })();
    return () => { live = false; };
  }, [call, onClose]);

  // The keyboard starts in the first combo (or the groups when the report has none).
  useEffect(() => {
    if (!def) return;
    const start = screen.current?.querySelector<HTMLElement>(".rp-top input, .rp-top button") ?? listRefs.current.group;
    start?.focus();
  }, [def]);

  const control = (name: string) => def?.controls.find((candidate) => candidate.name === name);
  const groupControl = control("lbchk_Group");
  const chosenItem = (name: string) => control(name)?.items.find((item) => itemKey(item) === choices[name]);
  // Runtime boxes a chosen filter or sort shows (HideOrShowMe with visible_controls_lst).
  const shownRuntime = new Set([chosenItem("lbox_Filter")?.showControls ?? "", chosenItem("lBox_Sorting")?.showControls ?? ""].flatMap((list) => list.split(",")).map((name) => name.trim()).filter(Boolean));
  const groupOfGrid = (grid: string) => groupControl?.items.filter((item) => item.showControls === grid && groups.includes(itemKey(item))) ?? [];

  /** Ticking a group shows its help tab (MoveFocus); an addon group shows its own subs in the addon grid. */
  const tickGroup = (item: ControlItem, on: boolean) => {
    setGroups((current) => (on ? [...current.filter((key) => key !== itemKey(item)), itemKey(item)] : current.filter((key) => key !== itemKey(item))));
    if (on && item.showControls) {
      setHelpTab(item.showControls);
      if (Number(item.value) > 0) setAddonField(item.value);
      setFocusHelp((count) => count + 1);
    }
  };

  /** C1_CHECKBOX_AfterEdit, SYS.CHK: an option's partner (unticked_for_id / ticked_for_id) follows it. */
  const setCheck = (name: string, value: boolean) => {
    if (!def) return;
    const row = def.checkboxes.find((check) => check.name === name);
    setChecks((current) => {
      const next = { ...current, [name]: value };
      if (row?.sysValue.toUpperCase() === "SYS.CHK") {
        const untick = def.checkboxes.find((check) => check.untickedForId === name);
        const tick = def.checkboxes.find((check) => check.tickedForId === name);
        if (untick) next[untick.name] = false;
        else if (tick) next[tick.name] = true;
      }
      return next;
    });
  };

  const selectionNow = (): ReportSelection => ({
    firstCombo: first,
    from,
    upto,
    groups,
    ticks: Object.fromEntries(Object.entries(ticks).map(([grid, set]) => [grid, [...set]])),
    choices,
    columns: columnsTicked,
    texts,
    checks,
  });

  // Btn_ok_Click: GenerateReport.
  const generate = async () => {
    if (!def || busy) return;
    if (!def.ported) {
      await messageBox.alert(`${def.head || title} is not available in the web version yet.\nIts output has not been ported; the selection can be seen but not run.`, "Not ported yet");
      return;
    }
    if (def.dates.fromVisible && def.dates.uptoVisible && from === upto) {
      const yes = await messageBox.confirm(`It Seems You Have Selected From And Upto Date\nSame As ${from}\nIt Will Generate Report Only For ${from}\n\nAre You Sure You Want To Continue?`, "Same Date Selection");
      if (!yes) return;
    }
    saveLastDates({ from, upto });
    setBusy("Generating report");
    say("Reading database and collecting data for inputs...");
    try {
      const chosen = selectionNow();
      const reply = await call<{ output: ReportOutput }>("generate", { selection: chosen });
      generatedWith.current = chosen;
      if (reply.refusal) { say("Report generation failed...", "", true); await refuse(reply.refusal); return; }
      setOutput(reply.output);
      setOutputRun((count) => count + 1);
      setTab("output");
      say(`Report generation time : ${reply.output.elapsed}`, "F6 : Summarize F4 : Unsummarize");
    } catch (error) {
      say("Report generation failed...", "", true);
      await messageBox.alert(error instanceof Error ? error.message : String(error), "Report generation failed", "error");
    } finally {
      setBusy("");
    }
  };

  const leave = () => onClose();

  /** The output grid's part of the status line: its rows and the selected cells' total. */
  const [gridInfo, setGridInfo] = useState({ rows: "", totals: "" });
  const onGridInfo = useCallback((rows: string, totals: string) => setGridInfo((current) => (current.rows === rows && current.totals === totals ? current : { rows, totals })), []);
  const onGridStatus = useCallback((status: OutputStatus) => say(status.message, status.hotKeys, status.red ?? false), [say]);
  /** The selection the output was generated from, for Create Group. */
  const generatedWith = useRef<ReportSelection | null>(null);
  const loadGroup = useCallback(async (fields: readonly string[]) => {
    if (!generatedWith.current) return null;
    const reply = await call<{ output: ReportOutput }>("group", { selection: generatedWith.current, fields });
    if (reply.refusal) { await refuse(reply.refusal); return null; }
    return reply.output;
  }, [call]);
  const loadLog = useCallback(async (ledKey: number, processKey: number) => (await call<{ log: LogTable }>("log", { ledKey, processKey })).log, [call]);

  /** C1_CHECKBOX, the Report Options: the first tab of the help grids, ticked like them. */
  const optionsHelp = useMemo<HelpGridData | null>(() => {
    const shown = def?.checkboxes.filter((check) => check.visible) ?? [];
    if (shown.length === 0) return null;
    return {
      grid: OPTIONS_GRID, helpId: "", keyColumn: "name", frozen: 0,
      columns: [{ key: "caption", caption: "SELECTION FOR", width: 460, visible: true, type: "T", decimals: 0, align: "L" }],
      rows: shown.map((check) => ({ name: check.name, caption: check.caption })),
    };
  }, [def]);
  const addonFilter = useCallback((row: Readonly<Record<string, string>>) => addonField === "" || (row.fiel_key ?? row.FIEL_KEY) === addonField, [addonField]);

  if (fatal) return <div className="mp-screen"><div className="mp-combos"><b>{title}</b></div><p className="mp-fatal" role="alert">{fatal}</p></div>;

  const helpShown = def?.helps.filter((help) => def.helpTabs.includes(help.grid.replace("C1Help", "Tab_")) || def.helpTabs.length === 0) ?? [];
  const helpEnabled = (grid: string) => groupOfGrid(grid).length > 0 || (grid === "C1HelpAddon" && groups.some((key) => Number(key.split("|")[1]) > 0));
  const addonGroups = groupControl?.items.filter((item) => Number(item.value) > 0) ?? [];
  const addonItem = addonGroups.find((item) => item.value === addonField);
  const addonEnabled = addonItem ? groups.includes(itemKey(addonItem)) : helpEnabled("C1HelpAddon");
  const optionTicks = new Set(Object.entries(checks).filter(([, on]) => on).map(([name]) => name));
  const pickLists = def?.controls.filter((candidate) => candidate.name !== "lbchk_Group" && candidate.type === "L") ?? [];
  const tickLists = def?.controls.filter((candidate) => candidate.name !== "lbchk_Group" && candidate.type === "K") ?? [];
  /** Tab out of a help grid: on to the list after the groups (Shift+Tab: back to the groups). */
  const tabOutOfHelp = (back: boolean) => {
    const next = back ? listRefs.current.group : (pickLists[0] ? listRefs.current[pickLists[0].name] : null);
    if (next) next.focus(); else screen.current?.querySelector<HTMLInputElement>(".rp-actions input")?.focus();
  };
  const combos = def?.controls.filter((candidate) => candidate.type === "C") ?? [];

  return (
    <div ref={screen} className="mp-screen rp-screen" role="region" aria-label={def?.head || title} onMouseOver={(event) => setTip((event.target as Element).closest("[title]")?.getAttribute("title") ?? "")} onMouseLeave={() => setTip("")} onFocus={() => setTip("")}>
      <div className="rp-body">
      <div className="rp-main">
      {tab === "select" && def && (
        <div className="rp-select">
          <div className="rp-top">
            {def.firstCombo.visible && (
              <>
                <span className="rp-top-label">{def.firstCombo.label}</span>
                <div className="rp-top-combo"><SearchCombo ariaLabel={def.firstCombo.label} options={def.firstCombo.options} value={def.firstCombo.options.find((option) => option.value === first) ?? null} onChoose={(option) => setFirst(option.value)} /></div>
              </>
            )}
            {busy && <span className="mp-busy">{busy}…</span>}
          </div>

          <div className="rp-left">
            {groupControl && (
              <ReportList
                ref={(element) => { listRefs.current.group = element; }}
                caption={groupControl.caption}
                mode="tick"
                entries={groupControl.items.map((item) => ({ key: itemKey(item), text: item.text, badge: groups.includes(itemKey(item)) ? String(groups.indexOf(itemKey(item)) + 1) : undefined }))}
                chosen={groups}
                onTick={(key, on) => { const item = groupControl.items.find((candidate) => itemKey(candidate) === key); if (item) tickGroup(item, on); }}
                onEnter={() => say("", "Space : Tick / ↑↓ : Move")}
                onActive={(key) => { const item = groupControl.items.find((candidate) => itemKey(candidate) === key); if (item) setMessage(`Tick to filter data with selected ${item.text}`); if (item?.showControls) { setHelpTab(item.showControls); if (Number(item.value) > 0) setAddonField(item.value); } }}
              />
            )}
            {pickLists.map((list) => (
              <ReportList
                key={list.name}
                ref={(element) => { listRefs.current[list.name] = element; }}
                caption={list.caption}
                mode="pick"
                entries={list.items.map((item) => ({ key: itemKey(item), text: item.text }))}
                chosen={[choices[list.name] ?? ""]}
                onPick={(key) => setChoices((current) => ({ ...current, [list.name]: key }))}
                onEnter={() => say(LIST_MESSAGES[list.name] ?? "", "↑↓ : Choose")}
              />
            ))}
          </div>

          <div className="rp-mid">
            {tickLists.map((list) => (
              <ReportList
                key={list.name}
                caption={list.caption}
                mode="tick"
                entries={list.items.map((item) => ({ key: item.value, text: item.text, locked: item.extra[1] === "Y" }))}
                chosen={[...columnsTicked, ...list.items.filter((item) => item.extra[1] === "Y").map((item) => item.value)]}
                onTick={(key, on) => setColumnsTicked((current) => (on ? [...current, key] : current.filter((value) => value !== key)))}
              />
            ))}
            {combos.map((combo) => (
              <label key={combo.name} className="rp-field">
                <span>{combo.caption}</span>
                <select value={choices[combo.name] ?? ""} onChange={(event) => setChoices((current) => ({ ...current, [combo.name]: event.target.value }))}>
                  {combo.items.map((item) => <option key={itemKey(item)} value={itemKey(item)}>{item.text}</option>)}
                </select>
              </label>
            ))}
            {def.runtime.filter((box) => box.visible || shownRuntime.has(box.name)).map((box) => box.type === "A" ? (
              <span key={box.name} className="rp-runtime-label">{box.text}</span>
            ) : (
              <label key={box.name} className="rp-field">
                <span>{box.name.replace(/^txt_/, "").replace(/amt$/i, " Amount")}</span>
                <input className="mp-control" inputMode="decimal" maxLength={box.maxChars || undefined} value={texts[box.name] ?? ""} onChange={(event) => { const value = event.target.value; if (/^-?\d*\.?\d*$/.test(value)) setTexts((current) => ({ ...current, [box.name]: value })); }} />
              </label>
            ))}
          </div>

          <div className="rp-right">
            {(helpShown.length > 0 || optionsHelp) && (
              <div className="rp-helps">
                <div className="rp-help-tabs" role="tablist">
                  {optionsHelp && (
                    <button type="button" role="tab" tabIndex={-1} aria-selected={helpTab === OPTIONS_GRID} className={helpTab === OPTIONS_GRID ? "rp-tab-on" : ""} onClick={() => setHelpTab(OPTIONS_GRID)}>Report Options</button>
                  )}
                  {helpShown.map((help) => (
                    <button key={help.grid} type="button" role="tab" tabIndex={-1} aria-selected={helpTab === help.grid} className={`${helpTab === help.grid ? "rp-tab-on" : ""} ${helpEnabled(help.grid) ? "rp-help-tab-live" : ""}`} onClick={() => setHelpTab(help.grid)}>
                      {help.grid.replace("C1Help", "")} {ticks[help.grid]?.size ? `(${ticks[help.grid].size})` : ""}
                    </button>
                  ))}
                  <span className="rp-help-tools">
                  {helpTab === "C1HelpAddon" && addonGroups.length > 0 && (
                    <select className="rp-addon-pick" value={addonField} onChange={(event) => setAddonField(event.target.value)} aria-label="Addon">
                      <option value="">All addons</option>
                      {addonGroups.map((item) => <option key={item.value} value={item.value}>{item.text}</option>)}
                    </select>
                  )}
                  <span className="rp-find-slot" ref={setFindSlot} />
                  </span>
                </div>
                {optionsHelp && (
                  <HelpGrid
                    help={optionsHelp}
                    hidden={helpTab !== OPTIONS_GRID}
                    enabled
                    ticked={optionTicks}
                    rowKey={(row) => row.name ?? ""}
                    rowDisabled={(row) => !(def.checkboxes.find((check) => check.name === row.name)?.enabled ?? false)}
                    onTicks={(next) => { for (const check of def.checkboxes) if (check.visible && check.enabled && next.has(check.name) !== (checks[check.name] ?? false)) setCheck(check.name, next.has(check.name)); }}
                    focusKey={0}
                    onTabOut={tabOutOfHelp}
                    findSlot={findSlot}
                    groupName="Report Options"
                    onStatus={() => say("Ticked options are applied to the report", "Space : Tick / F6 : Invert Selection / Ctrl+F : Search")}
                  />
                )}
                {helpShown.map((help) => (
                  <HelpGrid
                    key={help.grid}
                    help={help}
                    hidden={helpTab !== help.grid}
                    enabled={help.grid === "C1HelpAddon" ? addonEnabled : helpEnabled(help.grid)}
                    ticked={ticks[help.grid] ?? EMPTY_TICKS}
                    rowKey={help.grid === "C1HelpAddon" ? addonKey : (row) => row[help.keyColumn] ?? ""}
                    filter={help.grid === "C1HelpAddon" ? addonFilter : undefined}
                    onTicks={(next) => setTicks((current) => ({ ...current, [help.grid]: next }))}
                    focusKey={helpTab === help.grid ? focusHelp : 0}
                    freezeMain
                    onTabOut={tabOutOfHelp}
                    findSlot={findSlot}
                    groupName={help.grid === "C1HelpAddon" ? "Addon Groups" : undefined}
                    onStatus={(keys, text, red) => say(text, keys, red)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="rp-actions">
            {def.dates.fromVisible && <div className="rp-date" onFocus={() => say("Report is generated from this date", "Alt+↓ : Calendar")}><span>Report Generation From</span><DateField ariaLabel="Report Generation From" value={from} tools={tools} onChange={setFrom} required /></div>}
            {def.dates.uptoVisible && <div className="rp-date" onFocus={() => say("Report is generated upto this date", "Alt+↓ : Calendar")}><span>{def.dates.uptoLabel}</span><DateField ariaLabel={def.dates.uptoLabel} value={upto} tools={tools} onChange={setUpto} required /></div>}
            {!def.ported && <span className="rp-warning">Output of this report is not ported yet.</span>}
            <span className="rp-spacer" />
            <button type="button" data-hotkey="k" aria-keyshortcuts="Alt+K" className="mp-btn mp-btn-green rp-ok" onClick={() => void generate()} disabled={Boolean(busy)}><Icon name="ok" /><HotkeyLabel text="OK" hotkey="k" /></button>
            <button type="button" data-hotkey="q" aria-keyshortcuts="Alt+Q" className="mp-btn mp-btn-red rp-quit" onClick={leave}><Icon name="close" /><HotkeyLabel text="Quit" hotkey="q" /></button>
          </div>
          {tools.popups}
        </div>
      )}

      {tab === "output" && output && def && (
        <OutputGrid
          key={outputRun}
          output={output}
          fallbackTitle={title}
          companyName={selection?.companyName ?? ""}
          userName={selection?.loginName ?? ""}
          rights={def.rights}
          busy={Boolean(busy)}
          onRefresh={() => void generate()}
          onBack={() => setTab("select")}
          onQuit={leave}
          loadLog={loadLog}
          loadGroup={loadGroup}
          onStatus={onGridStatus}
          onInfo={onGridInfo}
        />
      )}
      </div>
      <div className="rp-vtabs" role="tablist" aria-orientation="vertical">
        <button type="button" role="tab" tabIndex={-1} aria-selected={tab === "select"} className={tab === "select" ? "rp-tab-on" : ""} onClick={() => setTab("select")}>Selection</button>
        <button type="button" role="tab" tabIndex={-1} aria-selected={tab === "output"} className={tab === "output" ? "rp-tab-on" : ""} disabled={!output} onClick={() => setTab("output")}>Output</button>
      </div>
      </div>
      <ScreenStatus hotKeys={hotKeys} message={tip || message} error={!tip && messageRed} version={version} rows={tab === "output" && output ? gridInfo.rows : ""} totals={tab === "output" ? gridInfo.totals : ""} />
    </div>
  );
}
