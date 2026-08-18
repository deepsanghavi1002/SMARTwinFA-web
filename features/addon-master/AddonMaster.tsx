"use client";
import { useMemo, useState } from "react";
import { addonFields, addonGroups, createBlankAddon, initialAddonRecords, stateOptions } from "./mock-data";
import type { AddonRecord } from "./types";

export function AddonMaster() {
  const [records, setRecords] = useState(initialAddonRecords);
  const [groupId, setGroupId] = useState("architect");
  const [mode, setMode] = useState<"add" | "update">("add");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const nextId = () => Math.max(0, ...records.map((record) => record.id)) + 1;
  const [draft, setDraft] = useState(() => createBlankAddon(6, "architect"));
  const [helpField, setHelpField] = useState<"name" | "state" | null>(null);
  const [message, setMessage] = useState("Ready");
  const groupRecords = useMemo(() => records.filter((record) => record.groupId === groupId), [records, groupId]);
  const reset = (group = groupId) => { setDraft(createBlankAddon(nextId(), group)); setSelectedId(null); setMode("add"); setHelpField(null); };
  const selectRecord = (record: AddonRecord) => { setDraft({ ...record }); setSelectedId(record.id); setMode("update"); setHelpField(null); setMessage(`Selected ${record.name}`); };
  const save = () => {
    const name = draft.name.trim();
    if (!name) return setMessage("Name is required");
    if (records.some((record) => record.groupId === groupId && record.name.trim().toLowerCase() === name.toLowerCase() && record.id !== selectedId)) return setMessage("This name already exists in the selected addon");
    const saved = { ...draft, name, groupId };
    setRecords((current) => mode === "update" ? current.map((record) => record.id === selectedId ? saved : record) : [...current, saved]);
    setSelectedId(saved.id); setMode("update"); setMessage("Master data saved (mock)");
  };
  const remove = () => {
    if (!selectedId) return setMessage("Select a record to delete");
    setRecords((current) => current.filter((record) => record.id !== selectedId)); reset(); setMessage("Record deleted (mock)");
  };

  return <section className="addon-master" aria-label="Addon sub master">
    <div className="addon-heading"><strong>SUB MASTER</strong><select aria-label="Addon type" value={groupId} onChange={(event) => { const group = event.target.value; setGroupId(group); reset(group); setMessage("Ready"); }}>{addonGroups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select><span>▣ Cancel Both (Add And Update)</span></div>
    <div className="addon-tabs"><button className={mode === "add" ? "active" : ""} onClick={() => reset()}>New(Add)</button><button className={mode === "update" ? "active" : ""} onClick={() => setHelpField("name")}>Update/Delete</button></div>
    <div className="addon-body">
      <div className="addon-form"><div className="addon-row addon-column-head"><span>Heading</span><span>Input</span></div>{addonFields.map((field) => <label className="addon-row" key={field.key}><span>{field.label}</span><input aria-label={field.label} value={draft[field.key]} onFocus={() => setHelpField(field.help ?? (field.key === "name" ? "name" : null))} onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))} /></label>)}</div>
      <aside className="addon-help">{helpField === "name" && <><div className="addon-help-head"><span>SELECTED GROUP</span><span>DESCRIPTION</span><span>SHORT</span></div>{groupRecords.map((record) => <button key={record.id} onClick={() => selectRecord(record)}><span>{addonGroups.find((group) => group.id === groupId)?.name}</span><b>{record.name}</b><small>{record.shortName}</small></button>)}<p>Total Help Record : {groupRecords.length}</p></>}{helpField === "state" && <><strong>SELECT STATE</strong>{stateOptions.map((state) => <button key={state} onClick={() => { setDraft((current) => ({ ...current, state })); setHelpField(null); }}><b>{state}</b></button>)}</>}</aside>
    </div>
    <div className="addon-actions"><button onClick={save}>Save ▣</button><button onClick={() => { reset(); setMessage("Cancelled"); }}>Cancel ✕</button><button onClick={remove}>Delete</button><button onClick={() => window.print()}>Print</button><button onClick={() => setMessage("Data refreshed")}>Refresh ↻</button><span role="status">{message}</span></div>
  </section>;
}
