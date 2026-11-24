"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useStartupSelection } from "../startup/StartupGate";
import { useWindowCloser } from "../ui/activeWindow";
import { Icon } from "../ui/Icon";
import { messageBox } from "../ui/MessageBox";
import { PRINT_FORMATS } from "../../lib/entry/printFormats";
import { cleanTemplate, resolveSheet, sheetCount, SHEET_CSS, UNIT } from "../../lib/print/template";
import type { Align, Box, El, Repeater, Template, Total } from "../../lib/print/template";
import type { FieldGroup } from "../../lib/print/billFields";

/**
 * UTILITY > Print Format Designer (web only): a print format is opened on its sample document and drawn as the printout is. Elements are dragged (arrows nudge,
 * Delete removes), resized by the corner square or in the panel, and their text, font, alignment and the {{field}} they show are set in the panel. Fields are
 * added from the list on the left; the item rows and the add / less lines are edited on their first row. Save keeps the template for the company
 * (smart_system.print_template, by the format's id), where the format's own print reads it.
 */

const PX = UNIT * (96 / 72); // screen pixels of a unit at 100%
const newId = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function PrintDesigner({ onClose }: { title: string; onClose: () => void }) {
  const selection = useStartupSelection();
  const [formatId, setFormatId] = useState(PRINT_FORMATS[0]?.id ?? "");
  /** The formats this company made itself (smart_system.print_template, names starting c_). */
  const [customs, setCustoms] = useState<{ id: string; name: string; base: string }[]>([]);
  const custom = customs.find((candidate) => candidate.id === formatId);
  const format = PRINT_FORMATS.find((candidate) => candidate.id === (custom ? custom.base : formatId)) ?? PRINT_FORMATS[0];
  const [template, setTemplate] = useState<Template>(() => format.defaultTemplate());
  const [selected, setSelected] = useState("");
  const [sheet, setSheet] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState("");
  const [panel, setPanel] = useState<"element" | "bands">("element");
  const drag = useRef<{ id: string; mode: "move" | "size"; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number } | null>(null);
  useWindowCloser(onClose);

  const request = useCallback(async (action: "get" | "save" | "reset" | "list", id: string, body?: Template): Promise<{ template?: Template | null; formats?: { id: string; name: string; base: string }[] }> => {
    if (!selection) throw new Error("No company is open");
    const response = await fetch("/api/print/template", { method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", body: JSON.stringify({ action, format: id, template: body, session: { companyId: Number(selection.companyId), yearKey: selection.yearKey, loginName: selection.loginName } }) });
    const reply = await response.json() as { template?: Template | null; formats?: { id: string; name: string; base: string }[]; error?: string };
    if (!response.ok || reply.error) throw new Error(reply.error || `The request failed (HTTP ${response.status})`);
    return reply;
  }, [selection]);
  const call = useCallback(async (action: "get" | "save" | "reset", body?: Template): Promise<Template | null> => (await request(action, formatId, body)).template ?? null, [request, formatId]);

  // The formats of the company, read once when the window opens.
  useEffect(() => { request("list", "x").then((reply) => setCustoms(reply.formats ?? [])).catch(() => undefined); }, [request]);

  useEffect(() => {
    let live = true;
    setSelected(""); setSheet(0);
    call("get").then((stored) => { if (live) { setTemplate(stored ?? format.defaultTemplate()); setDirty(false); setNote(custom ? `The format "${custom.name}" is open.` : stored ? "This company's own template is open." : "The default template is open."); } })
      .catch((error: unknown) => { if (live) { setTemplate(format.defaultTemplate()); setNote(error instanceof Error ? error.message : "The template could not be read"); } });
    return () => { live = false; };
  }, [call, format, custom]);

  /** A new format of the company: from a copy of the one open, or from a blank page with the usual fields. */
  const newFormat = async () => {
    const name = (await messageBox.prompt("Name of the new print format", "New print format"))?.trim();
    if (!name) return;
    const copy = await messageBox.confirm("Start from a copy of the format that is open?\n\nOK = a copy of it; Cancel = a blank page with the usual fields (company, party, invoice, item table, totals).", "New print format");
    const id = `c_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 18)}_${Date.now().toString(36)}`;
    const made: Template = { ...JSON.parse(JSON.stringify(copy ? template : format.starter())) as Template, meta: { name: name.slice(0, 60), base: format.id } };
    try {
      await request("save", id, made);
      setCustoms((now) => [...now, { id, name: name.slice(0, 60), base: format.id }]);
      setFormatId(id);
    } catch (error) { setNote(error instanceof Error ? error.message : "The format could not be made"); }
  };
  const deleteFormat = async () => {
    if (!custom || !(await messageBox.confirm(`Delete the format "${custom.name}"? Its design is lost.`, "Delete format"))) return;
    try { await request("reset", custom.id); setCustoms((now) => now.filter((candidate) => candidate.id !== custom.id)); setFormatId(custom.base); } catch (error) { setNote(error instanceof Error ? error.message : "The format could not be deleted"); }
  };
  /** A logo or picture from the computer: kept inside the template as a small image. */
  const uploadImage = () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/png,image/jpeg,image/gif";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 300 * 1024) { setNote("Choose a smaller picture: up to 300 KB (a logo is usually smaller)."); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const uri = String(reader.result);
        const picture = new Image();
        picture.onload = () => { const width = 120; add({ kind: "image", x: 60, y: 40, w: width, h: Math.max(10, Math.round(width * picture.naturalHeight / Math.max(1, picture.naturalWidth))), src: uri }); setNote("Picture added: drag it into place and pull its corner to size it."); };
        picture.src = uri;
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };
  const replaceImage = (id: string) => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/png,image/jpeg,image/gif";
    input.onchange = () => { const file = input.files?.[0]; if (!file) return; if (file.size > 300 * 1024) { setNote("Choose a smaller picture: up to 300 KB."); return; } const reader = new FileReader(); reader.onload = () => change(id, { src: String(reader.result) }); reader.readAsDataURL(file); };
    input.click();
  };

  /** The format's fields, and the entry addons by name (AD_TRANSPORT ...) found in the sample. */
  const groups = useMemo<readonly FieldGroup[]>(() => {
    const addons = Object.keys(format.sample.values).filter((key) => key.startsWith("AD_")).sort();
    return addons.length === 0 ? format.fields : [...format.fields, { label: "Entry addons by name", fields: addons.map((key) => ({ key, label: key })) }];
  }, [format]);
  const sheets = sheetCount(template, format.sample);
  const shownSheet = Math.min(sheet, sheets - 1);
  const boxes = useMemo(() => resolveSheet(template, format.sample, shownSheet, { designer: true }), [template, format, shownSheet]);
  const current = template.elements.find((element) => element.id === selected);

  const change = (id: string, patch: Partial<El>) => { setTemplate((now) => ({ ...now, elements: now.elements.map((element) => (element.id === id ? { ...element, ...patch } : element)) })); setDirty(true); };
  const add = (element: Omit<El, "id">) => { const id = newId(); setTemplate((now) => ({ ...now, elements: [...now.elements, { id, ...element }] })); setSelected(id); setDirty(true); };
  const remove = (id: string) => { setTemplate((now) => ({ ...now, elements: now.elements.filter((element) => element.id !== id) })); setSelected(""); setDirty(true); };

  const down = (event: React.PointerEvent, box: Box, mode: "move" | "size") => {
    const element = template.elements.find((candidate) => candidate.id === box.id);
    if (!element || box.ghost) return;
    event.preventDefault(); event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    const target = (event.currentTarget as HTMLElement).closest("[data-box]") as HTMLElement | null;
    setSelected(element.id);
    drag.current = { id: element.id, mode, sx: event.clientX, sy: event.clientY, ox: element.x, oy: element.y, ow: element.w ?? (target ? target.offsetWidth / (PX * zoom) : 100), oh: element.h ?? (target ? target.offsetHeight / (PX * zoom) : 20) };
  };
  const move = (event: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (event.clientX - d.sx) / (PX * zoom);
    const dy = (event.clientY - d.sy) / (PX * zoom);
    const round = (value: number) => Math.round(value);
    if (d.mode === "move") change(d.id, { x: round(d.ox + dx), y: round(d.oy + dy) });
    else {
      const element = template.elements.find((candidate) => candidate.id === d.id);
      if (element?.kind === "hline") change(d.id, { w: Math.max(2, round(d.ow + dx)) });
      else if (element?.kind === "vline") change(d.id, { h: Math.max(2, round(d.oh + dy)) });
      else change(d.id, { w: Math.max(6, round(d.ow + dx)), ...(element?.kind === "image" || element?.wrap ? { h: Math.max(6, round(d.oh + dy)) } : {}) });
    }
  };
  const keys = (event: React.KeyboardEvent) => {
    const typing = (event.target as HTMLElement).closest("input,textarea,select") !== null;
    if (!current || typing) return;
    const step = event.shiftKey ? 5 : 1;
    if (event.key === "ArrowLeft") change(current.id, { x: current.x - step });
    else if (event.key === "ArrowRight") change(current.id, { x: current.x + step });
    else if (event.key === "ArrowUp") change(current.id, { y: current.y - step });
    else if (event.key === "ArrowDown") change(current.id, { y: current.y + step });
    else if (event.key === "Delete") remove(current.id);
    else return;
    event.preventDefault();
  };

  const save = async () => { try { setTemplate((await call("save", template)) ?? template); setDirty(false); setNote("Saved for this company."); } catch (error) { setNote(error instanceof Error ? error.message : "Could not save"); } };
  const reset = async () => { if (!window.confirm("Remove this company's own template and go back to the default one?")) return; try { await call("reset"); setTemplate(format.defaultTemplate()); setDirty(false); setSelected(""); setNote("Back to the default template."); } catch (error) { setNote(error instanceof Error ? error.message : "Could not reset"); } };
  const exportFile = () => { const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([JSON.stringify(template, null, 1)], { type: "application/json" })); link.download = `${formatId}-template.json`; link.click(); };
  const importFile = () => { const input = document.createElement("input"); input.type = "file"; input.accept = ".json"; input.onchange = () => { void input.files?.[0]?.text().then((text) => { try { setTemplate(cleanTemplate(JSON.parse(text))); setDirty(true); setNote("Template imported; Save keeps it."); } catch { setNote("That file is not a template."); } }); }; input.click(); };

  const boxStyle = (box: Box): CSSProperties => {
    const base: CSSProperties = { left: `${box.x * UNIT}pt`, top: `${box.y * UNIT}pt` };
    if (box.kind === "hline") return { ...base, width: `${(box.w ?? 100) * UNIT}pt`, height: "1.2pt", ...(box.color ? { background: box.color } : {}) };
    if (box.kind === "vline") return { ...base, width: "1.2pt", height: `${(box.h ?? 100) * UNIT}pt`, ...(box.color ? { background: box.color } : {}) };
    if (box.kind === "image") return { ...base, width: `${(box.w ?? 100) * UNIT}pt`, height: `${(box.h ?? 100) * UNIT}pt` };
    return { ...base, ...(box.w ? { width: `${box.w * UNIT}pt` } : {}), ...(box.wrap && box.h ? { height: `${box.h * UNIT}pt` } : {}), ...(box.size ? { fontSize: `${box.size}pt` } : {}), ...(box.color ? { color: box.color } : {}) };
  };
  const listOfElement = (element?: El) => template.repeaters.find((repeater) => repeater.name === element?.in)?.source;
  const fieldsFor = (element?: El) => groups.filter((group) => !group.list || group.list === listOfElement(element));
  /** A field of a list goes into the repeater over that list (one is made when the template has none). */
  const addField = (group: FieldGroup, key: string) => {
    if (!group.list) { add({ kind: "text", x: 60, y: 60, text: `{{${key}}}` }); return; }
    let repeater = template.repeaters.find((candidate) => candidate.source === group.list);
    if (!repeater) {
      const made: Repeater = { name: group.list, source: group.list, y: 300, pitch: 20, ...(group.list === "lines" && !template.repeaters.some((candidate) => candidate.paginate) ? { paginate: true } : {}) };
      repeater = made;
      setTemplate((now) => ({ ...now, repeaters: [...now.repeaters, made] }));
    }
    add({ kind: "text", x: 60, y: 0, text: `{{${key}}}`, in: repeater.name });
  };
  const changeRepeater = (name: string, patch: Partial<Repeater>) => { setTemplate((now) => ({ ...now, repeaters: now.repeaters.map((repeater) => (repeater.name === name ? { ...repeater, ...patch } : repeater)) })); setDirty(true); };
  const removeRepeater = (name: string) => { setTemplate((now) => ({ ...now, repeaters: now.repeaters.filter((repeater) => repeater.name !== name), elements: now.elements.filter((element) => element.in !== name) })); setSelected(""); setDirty(true); };
  const changeTotal = (at: number, patch: Partial<Total>) => { setTemplate((now) => ({ ...now, totals: (now.totals ?? []).map((total, index) => (index === at ? { ...total, ...patch } : total)) })); setDirty(true); };
  const listNames = Object.keys(format.sample.lists);
  const columnsOf = (list: string) => Object.keys(format.sample.lists[list]?.[0] ?? {});
  const num = (label: string, value: number | undefined, onChange: (value: number) => void) => (
    <label style={{ display: "flex", gap: 4, alignItems: "center" }}>{label}<input type="number" value={value ?? ""} style={{ width: 64 }} onChange={(event) => onChange(Number(event.target.value))} /></label>
  );

  return (
    <div className="mp-screen" role="presentation" onKeyDown={keys} style={{ display: "flex", flexDirection: "column", height: "100%", gap: 6, padding: 8 }}>
      <style>{SHEET_CSS}{`.pd-page [data-box]{cursor:move;outline:1px dashed rgba(0,110,200,.35)}.pd-page [data-box]:hover{outline:1px solid #0a6ed1}.pd-page [data-box].sel{outline:2px solid #e8590c}.pd-page [data-box].ghost{cursor:default;outline:none;opacity:.55}.pd-page [data-box].off{opacity:.25}.pd-page .ln[data-box]::after{content:"";position:absolute;inset:-4px}.pd-handle{position:absolute;right:-5px;bottom:-5px;width:9px;height:9px;background:#e8590c;cursor:nwse-resize}`}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <b>Print Format Designer</b>
        <label>Format <select value={formatId} onChange={(event) => setFormatId(event.target.value)}>{PRINT_FORMATS.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}{customs.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
        <button type="button" className="mp-btn mp-btn-blue" onClick={() => void newFormat()}>New format</button>
        {custom && <button type="button" className="mp-btn mp-btn-blue" onClick={() => void deleteFormat()}>Delete format</button>}
        <label>Sheet <select value={shownSheet} onChange={(event) => setSheet(Number(event.target.value))}>{Array.from({ length: sheets }, (_, at) => <option key={at} value={at}>{at + 1} of {sheets}</option>)}</select></label>
        <label>Zoom <select value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>{[0.6, 0.8, 1, 1.25, 1.5].map((value) => <option key={value} value={value}>{Math.round(value * 100)}%</option>)}</select></label>
        {num("Rows per sheet", template.rowsPerPage, (value) => { setTemplate((now) => ({ ...now, rowsPerPage: Math.min(60, Math.max(1, Math.trunc(value) || 1)) })); setDirty(true); })}
        <button type="button" className="mp-btn mp-btn-blue" onClick={() => void save()} disabled={!dirty}>Save{dirty ? " *" : ""}</button>
        {!custom && <button type="button" className="mp-btn mp-btn-blue" onClick={() => void reset()}>Reset to default</button>}
        <button type="button" className="mp-btn mp-btn-blue" onClick={exportFile}>Export</button>
        <button type="button" className="mp-btn mp-btn-blue" onClick={importFile}>Import</button>
        <span style={{ flex: 1, minWidth: 120 }}>{note}</span>
        <button type="button" className="mp-btn mp-btn-red" onClick={onClose}><Icon name="quit" />Quit</button>
      </div>
      <div style={{ display: "flex", flex: 1, gap: 8, minHeight: 0 }}>
        <div style={{ width: 230, overflow: "auto", border: "1px solid #b8c6d2", padding: 6, fontSize: 12 }}>
          <b>Add</b>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", margin: "4px 0 8px" }}>
            <button type="button" onClick={() => add({ kind: "text", x: 60, y: 60, text: "Text" })}>Text</button>
            <button type="button" onClick={() => add({ kind: "hline", x: 60, y: 60, w: 200 })}>Horizontal line</button>
            <button type="button" onClick={() => add({ kind: "vline", x: 60, y: 60, h: 100 })}>Vertical line</button>
            <button type="button" onClick={uploadImage}>Picture / logo from my computer…</button>
          </div>
          <b>Fields</b> <span>(click one to add it; a field of a list goes into the repeater over that list)</span>
          {groups.map((group) => (
            <details key={group.label} style={{ margin: "4px 0" }}>
              <summary style={{ fontWeight: 600, cursor: "pointer" }}>{group.label}</summary>
              {group.fields.map((field) => (
                <div key={field.key}><button type="button" style={{ border: 0, background: "none", color: "#0a4f9c", cursor: "pointer", textAlign: "left", padding: "1px 0" }} onClick={() => addField(group, field.key)}>{field.label}</button></div>
              ))}
            </details>
          ))}
        </div>
        <div style={{ flex: 1, overflow: "auto", background: "#cfd8df", padding: 12 }} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerDown={() => setSelected("")}>
          <div style={{ width: 595 * 1.3333 * zoom, height: 842 * 1.3333 * zoom }}>
            <div className="rp-page pd-page" style={{ margin: 0, transform: `scale(${zoom * 1.3333})`, transformOrigin: "0 0", boxShadow: "0 2px 10px rgba(0,0,0,.4)" }}>
              {boxes.map((box, at) => {
                const classes = ["t", box.bold ? "b" : "", box.align === "r" ? "r" : box.align === "c" ? "c" : "", box.wrap ? "w" : "", box.kind === "hline" || box.kind === "vline" ? "ln" : "", box.id === selected && !box.ghost ? "sel" : "", box.ghost ? "ghost" : "", box.hidden ? "off" : ""].filter(Boolean).join(" ");
                const content = box.kind === "image" ? (box.src ? <img src={box.src} alt="" style={{ width: "100%", height: "100%" }} /> : <span style={{ fontSize: "6pt", color: "#999" }}>image</span>) : box.kind === "text" ? (box.text === "" ? " " : box.text) : null;
                const Tag = box.kind === "text" ? "span" : "div";
                return (
                  <Tag key={`${box.id}-${at}`} data-box className={classes} style={boxStyle(box)} onPointerDown={(event) => down(event, box, "move")}>
                    {content}
                    {box.id === selected && !box.ghost && <span className="pd-handle" onPointerDown={(event) => down(event, box, "size")} />}
                  </Tag>
                );
              })}
            </div>
          </div>
        </div>
        <div style={{ width: 250, overflow: "auto", border: "1px solid #b8c6d2", padding: 6, fontSize: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 4 }}>
            <button type="button" onClick={() => setPanel("element")} style={{ fontWeight: panel === "element" ? 700 : 400 }}>Element</button>
            <button type="button" onClick={() => setPanel("bands")} style={{ fontWeight: panel === "bands" ? 700 : 400 }}>Repeaters and totals</button>
          </div>
          {panel === "bands" ? (
            <>
              <b>Repeaters</b>
              <span>A repeater draws a list (item rows, slab lines, HSN summary ...) row after row. The elements inside it are drawn once for each row; a group field adds a heading before and a footing after each run of equal values.</span>
              {template.repeaters.map((repeater) => (
                <fieldset key={repeater.name} style={{ border: "1px solid #b8c6d2", padding: 4, display: "flex", flexDirection: "column", gap: 3 }}>
                  <legend>{repeater.name}</legend>
                  <label>List <select value={repeater.source} onChange={(event) => changeRepeater(repeater.name, { source: event.target.value })}>{listNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
                  {num("Top (first row)", repeater.y, (value) => changeRepeater(repeater.name, { y: value }))}
                  {num("Row height", repeater.pitch, (value) => changeRepeater(repeater.name, { pitch: Math.max(1, value) }))}
                  <label><input type="checkbox" checked={repeater.paginate === true} onChange={(event) => setTemplate((now) => ({ ...now, repeaters: now.repeaters.map((candidate) => ({ ...candidate, paginate: candidate.name === repeater.name ? event.target.checked || undefined : event.target.checked ? undefined : candidate.paginate })) }))} /> Makes the sheets (rows per sheet above)</label>
                  <label>Group by <select value={repeater.groupBy ?? ""} onChange={(event) => changeRepeater(repeater.name, { groupBy: event.target.value || undefined })}><option value="">(none)</option>{columnsOf(repeater.source).map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
                  {repeater.groupBy && <>{num("Heading height", repeater.headerPitch ?? repeater.pitch, (value) => changeRepeater(repeater.name, { headerPitch: Math.max(1, value) }))}{num("Footing height", repeater.footerPitch ?? repeater.pitch, (value) => changeRepeater(repeater.name, { footerPitch: Math.max(1, value) }))}</>}
                  <label>Leave out rows where <select value={repeater.skipBlank ?? ""} onChange={(event) => changeRepeater(repeater.name, { skipBlank: event.target.value || undefined })}><option value="">(none)</option>{columnsOf(repeater.source).map((name) => <option key={name} value={name}>{name} is blank or nil</option>)}</select></label>
                  <label>Shown on <select value={repeater.show ?? "all"} onChange={(event) => changeRepeater(repeater.name, { show: event.target.value === "last" ? "last" : undefined })}><option value="all">Every sheet</option><option value="last">Last sheet only</option></select></label>
                  <button type="button" onClick={() => { if (window.confirm(`Remove the repeater ${repeater.name} and the elements inside it?`)) removeRepeater(repeater.name); }}>Remove repeater</button>
                </fieldset>
              ))}
              <button type="button" onClick={() => { const list = listNames.find((name) => !template.repeaters.some((repeater) => repeater.source === name)) ?? listNames[0]; if (!list) return; let name = list; let at = 1; while (template.repeaters.some((repeater) => repeater.name === name)) { at += 1; name = `${list}${at}`; } setTemplate((now) => ({ ...now, repeaters: [...now.repeaters, { name, source: list, y: 300, pitch: 20, ...(now.repeaters.some((repeater) => repeater.paginate) ? {} : { paginate: true }) }] })); setDirty(true); }}>Add a repeater</button>
              <b>Totals</b>
              <span>A total is a figure worked out from a list (sum, count, running sum ...). Use it in a text as {"{{name}}"}; put a group-wise total in a group footing.</span>
              {(template.totals ?? []).map((total, at) => (
                <fieldset key={`${total.name}-${at}`} style={{ border: "1px solid #b8c6d2", padding: 4, display: "flex", flexDirection: "column", gap: 3 }}>
                  <legend>{total.name || "(name)"}</legend>
                  <label>Name <input value={total.name} onChange={(event) => changeTotal(at, { name: event.target.value.replace(/[^A-Za-z0-9_]/g, "").slice(0, 40) })} /></label>
                  <label>Figure <select value={total.op} onChange={(event) => changeTotal(at, { op: event.target.value as Total["op"] })}>{[["sum", "Sum"], ["running", "Running sum"], ["count", "Count"], ["min", "Smallest"], ["max", "Largest"], ["avg", "Average"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label>List <select value={total.list} onChange={(event) => changeTotal(at, { list: event.target.value })}>{listNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
                  <label>Of the field <select value={total.field} onChange={(event) => changeTotal(at, { field: event.target.value })}>{columnsOf(total.list).map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
                  <label>Starts again with <select value={total.reset} onChange={(event) => changeTotal(at, { reset: event.target.value as Total["reset"] })}><option value="report">Nothing (whole report)</option><option value="group">Each group</option><option value="page">Each sheet</option></select></label>
                  {num("Decimals", total.decimals ?? 2, (value) => changeTotal(at, { decimals: Math.min(6, Math.max(0, Math.trunc(value) || 0)) }))}
                  <button type="button" onClick={() => { setTemplate((now) => ({ ...now, totals: (now.totals ?? []).filter((_, index) => index !== at) })); setDirty(true); }}>Remove total</button>
                </fieldset>
              ))}
              <button type="button" onClick={() => { const list = listNames[0] ?? "lines"; setTemplate((now) => ({ ...now, totals: [...(now.totals ?? []), { name: `TOT${(now.totals?.length ?? 0) + 1}`, op: "sum", field: columnsOf(list)[0] ?? "", list, reset: "report", decimals: 2 }] })); setDirty(true); }}>Add a total</button>
            </>
          ) : !current ? <span>Click an element to change it. Elements marked &quot;last sheet&quot; show only on the last sheet. Elements of a repeater are edited on the first row.</span> : (
            <>
              <b>{current.kind === "text" ? "Text" : current.kind === "image" ? "Image" : "Line"}{current.in ? ` (in ${current.in === "items" ? "item rows" : "add / less lines"})` : ""}</b>
              {current.kind === "text" && (
                <>
                  <textarea rows={4} value={current.text ?? ""} onChange={(event) => change(current.id, { text: event.target.value })} />
                  <select value="" onChange={(event) => { if (event.target.value) change(current.id, { text: `${current.text ?? ""}{{${event.target.value}}}` }); }}>
                    <option value="">Insert a field…</option>
                    {fieldsFor(current).map((group) => <optgroup key={group.label} label={group.label}>{group.fields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</optgroup>)}
                  </select>
                  <label><input type="checkbox" checked={current.bold === true} onChange={(event) => change(current.id, { bold: event.target.checked })} /> Bold</label>
                  {num("Size (pt)", current.size ?? 7.4, (value) => change(current.id, { size: Math.min(40, Math.max(4, value || 7.4)) }))}
                  <label>Align <select value={current.align ?? "l"} onChange={(event) => change(current.id, { align: event.target.value as Align })}><option value="l">Left</option><option value="r">Right</option><option value="c">Centre</option></select></label>
                  <label><input type="checkbox" checked={current.wrap === true} onChange={(event) => change(current.id, { wrap: event.target.checked })} /> Wrap in the box (width and height)</label>
                </>
              )}
              {current.kind === "image" && ((current.src ?? "").startsWith("data:") ? <button type="button" onClick={() => replaceImage(current.id)}>Replace the picture…</button> : <label>Image (address or {"{{field}}"})<input style={{ width: "100%" }} value={current.src ?? ""} onChange={(event) => change(current.id, { src: event.target.value })} /></label>)}
              {current.kind !== "image" && (
                <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                  <span>Colour</span>
                  <input type="color" value={current.color ?? "#000000"} onChange={(event) => change(current.id, { color: event.target.value })} title="Choose any colour" />
                  {[["Black", "#000000"], ["Red", "#d00000"], ["Blue", "#0033cc"], ["Green", "#1a7f1a"], ["Grey", "#666666"]].map(([label, value]) => (
                    <button key={value} type="button" title={label} onClick={() => change(current.id, { color: value })} style={{ width: 20, height: 20, background: value, border: current.color === value ? "2px solid #e8590c" : "1px solid #888", cursor: "pointer" }} />
                  ))}
                  <button type="button" onClick={() => change(current.id, { color: undefined })}>Default</button>
                </div>
              )}
              {num("X", current.x, (value) => change(current.id, { x: value }))}
              {num("Y", current.y, (value) => change(current.id, { y: value }))}
              {current.kind !== "vline" && num(current.kind === "hline" ? "Length" : "Width", current.w, (value) => change(current.id, { w: value }))}
              {current.kind !== "hline" && (current.kind !== "text" || current.wrap) && num(current.kind === "vline" ? "Length" : "Height", current.h, (value) => change(current.id, { h: value }))}
              {current.in && <label>Band <select value={current.band ?? "row"} onChange={(event) => change(current.id, { band: event.target.value === "row" ? undefined : event.target.value as El["band"] })}><option value="row">Each row</option><option value="groupHeader">Group heading</option><option value="groupFooter">Group footing</option></select></label>}
              <label>Shown on <select value={current.show ?? "all"} onChange={(event) => change(current.id, { show: event.target.value === "last" ? "last" : undefined })}><option value="all">Every sheet</option><option value="last">Last sheet only</option></select></label>
              <label><input type="checkbox" checked={current.hidden === true} onChange={(event) => change(current.id, { hidden: event.target.checked || undefined })} /> Hidden</label>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" onClick={() => add({ ...current, x: current.x + 10, y: current.y + 10 })}>Duplicate</button>
                <button type="button" onClick={() => remove(current.id)}>Delete</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
