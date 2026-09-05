"use client";

import { useEffect, useMemo, useState } from "react";

type AddonRow = { key: number; version: string; relation: string; description: string; shortName: string; storageName: string; type: string; serial: string; required: boolean; masterVisible: boolean; entryPosition: string; lookupValues: number };
type AddonOption = { code: number; fieldKey: number; name: string; shortName: string; version: string };
type AddonPayload = { source: "legacy-postgresql"; readOnly: true; writesEnabled: boolean; relations: Array<{ key: string; label: string; fields: number }>; rows: AddonRow[]; options: AddonOption[]; storageOptions: string[] };
type FieldDraft = Pick<AddonRow, "relation" | "description" | "shortName" | "storageName" | "type" | "serial" | "required" | "masterVisible" | "entryPosition">;
type OptionDraft = Pick<AddonOption, "name" | "shortName">;

const blankField = (relation: string, storageName = "", serial = "0"): FieldDraft => ({ relation, description: "", shortName: "", storageName, type: "T", serial, required: false, masterVisible: true, entryPosition: "" });
const fieldDraft = (row: AddonRow): FieldDraft => ({ relation: row.relation, description: row.description, shortName: row.shortName, storageName: row.storageName, type: row.type || "T", serial: row.serial || "0", required: row.required, masterVisible: row.masterVisible, entryPosition: row.entryPosition });
const optionDraft = (row: AddonOption): OptionDraft => ({ name: row.name, shortName: row.shortName });

export function AddonMaster() {
  const [relation, setRelation] = useState("A");
  const [payload, setPayload] = useState<AddonPayload | null>(null);
  const [selectedKey, setSelectedKey] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [fieldEdits, setFieldEdits] = useState<Record<number, FieldDraft>>({});
  const [optionEdits, setOptionEdits] = useState<Record<number, OptionDraft>>({});
  const [newField, setNewField] = useState<FieldDraft | null>(null);
  const [newOption, setNewOption] = useState<OptionDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("Loading real add-on definitions…");
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/legacy/master/addon?relation=${encodeURIComponent(relation)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as AddonPayload | { error?: string };
        if (!response.ok || !("rows" in body)) throw new Error("error" in body && body.error ? body.error : "Addon Master could not be loaded");
        return body;
      })
      .then((body) => { setPayload(body); setSelectedKey(body.rows[0]?.key ?? null); setFieldEdits({}); setOptionEdits({}); setNewField(null); setNewOption(null); setMessage(`${body.rows.length} real add-on definitions loaded — click a cell to edit`); })
      .catch((reason: unknown) => { if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Addon Master could not be loaded"); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [relation, reload]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (payload?.rows ?? []).filter((row) => !needle || [row.description, row.shortName, row.storageName, row.type].some((value) => value.toLowerCase().includes(needle)));
  }, [payload, query]);
  const selected = payload?.rows.find((row) => row.key === selectedKey) ?? null;
  const options = (payload?.options ?? []).filter((option) => option.fieldKey === selectedKey);
  const changedFields = Object.keys(fieldEdits).length + (newField ? 1 : 0);
  const changedOptions = Object.keys(optionEdits).length + (newOption ? 1 : 0);
  const canWrite = Boolean(payload?.writesEnabled);

  const editField = (row: AddonRow, patch: Partial<FieldDraft>) => setFieldEdits((current) => ({ ...current, [row.key]: { ...(current[row.key] ?? fieldDraft(row)), ...patch } }));
  const editOption = (row: AddonOption, patch: Partial<OptionDraft>) => setOptionEdits((current) => ({ ...current, [row.code]: { ...(current[row.code] ?? optionDraft(row)), ...patch } }));
  const post = async (body: unknown) => {
    const response = await fetch("/api/legacy/master/addon", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error || "Add-on Master could not be saved");
  };
  const saveFields = async () => {
    if (!canWrite) return setMessage("Master writes are disabled in this deployment");
    const changes: unknown[] = payload?.rows.filter((row) => fieldEdits[row.key]).map((row) => ({ operation: "update", entity: "field", key: row.key, version: row.version, ...fieldEdits[row.key], serial: Number(fieldEdits[row.key].serial) })) ?? [];
    if (newField) changes.push({ operation: "create", entity: "field", ...newField, serial: Number(newField.serial) });
    if (!changes.length) return;
    setSaving(true);
    try { for (const change of changes) await post(change); setMessage(`${changes.length} add-on definition${changes.length === 1 ? "" : "s"} saved.`); setReload((value) => value + 1); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Add-on definition could not be saved"); }
    finally { setSaving(false); }
  };
  const saveOptions = async () => {
    if (!selected) return setMessage("Select a definition before adding lookup values");
    if (!canWrite) return setMessage("Master writes are disabled in this deployment");
    const changes: unknown[] = options.filter((row) => optionEdits[row.code]).map((row) => ({ operation: "update", fieldKey: selected.key, code: row.code, version: row.version, ...optionEdits[row.code] }));
    if (newOption) changes.push({ operation: "create", fieldKey: selected.key, ...newOption });
    if (!changes.length) return;
    setSaving(true);
    try { for (const change of changes) await post(change); setMessage(`${changes.length} lookup value${changes.length === 1 ? "" : "s"} saved.`); setReload((value) => value + 1); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Lookup value could not be saved"); }
    finally { setSaving(false); }
  };
  const retireField = async () => {
    if (!selected) return setMessage("Select a definition first");
    if (!canWrite) return setMessage("Master writes are disabled in this deployment");
    if (!window.confirm(`Retire “${selected.description}”? Existing values will stay intact.`)) return;
    setSaving(true);
    try { await post({ entity: "field", operation: "delete", key: selected.key, version: selected.version }); setMessage("Definition retired from real legacy metadata."); setReload((value) => value + 1); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Definition could not be retired"); }
    finally { setSaving(false); }
  };
  const deleteOption = async (row: AddonOption) => {
    if (!canWrite || !selected) return setMessage("Master writes are disabled in this deployment");
    if (!window.confirm(`Delete “${row.name}”? Existing documents keep their stored value.`)) return;
    setSaving(true);
    try { await post({ operation: "delete", fieldKey: selected.key, code: row.code, version: row.version }); setMessage("Lookup value deleted from real legacy data."); setReload((value) => value + 1); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Lookup value could not be deleted"); }
    finally { setSaving(false); }
  };

  const fieldCells = (draft: FieldDraft, update: (patch: Partial<FieldDraft>) => void) => <>
    <td><select aria-label="Definition relation" value={draft.relation} onChange={(event) => update({ relation: event.target.value })}>{payload?.relations.map((item) => <option key={item.key} value={item.key}>{item.key}</option>)}</select></td>
    <td><input aria-label="Definition description" value={draft.description} maxLength={120} onChange={(event) => update({ description: event.target.value })} /></td>
    <td><input aria-label="Definition short name" value={draft.shortName} maxLength={40} onChange={(event) => update({ shortName: event.target.value })} /></td>
    <td><select aria-label="Definition storage field" value={draft.storageName} onChange={(event) => update({ storageName: event.target.value })}><option value="">Select column…</option>{payload?.storageOptions.map((column) => <option key={column} value={column}>{column}</option>)}</select></td>
    <td><select aria-label="Definition type" value={draft.type} onChange={(event) => update({ type: event.target.value })}><option value="T">Text</option><option value="M">Lookup</option><option value="N">Number</option><option value="D">Date</option></select></td>
    <td><input aria-label="Definition serial" className="number-cell" inputMode="numeric" value={draft.serial} onChange={(event) => update({ serial: event.target.value })} /></td>
    <td className="check-cell"><input aria-label="Definition required" type="checkbox" checked={draft.required} onChange={(event) => update({ required: event.target.checked })} /></td>
    <td className="check-cell"><input aria-label="Definition show in master" type="checkbox" checked={draft.masterVisible} onChange={(event) => update({ masterVisible: event.target.checked })} /></td>
    <td><input aria-label="Definition entry position" value={draft.entryPosition} maxLength={20} onChange={(event) => update({ entryPosition: event.target.value })} /></td>
  </>;

  return <section className="real-addon-master excel-addon-master" aria-label="Real Addon Master">
    <header><strong>ADDON MASTER</strong><label>Relation<select aria-label="Addon relation" value={relation} disabled={loading || saving} onChange={(event) => setRelation(event.target.value)}>{payload?.relations.map((item) => <option key={item.key} value={item.key}>{item.label} ({item.fields})</option>) ?? <><option value="A">Account fields</option><option value="P">Product fields</option></>}</select></label><input aria-label="Search add-on fields" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find field definition" /><button type="button" disabled={saving} onClick={() => setNewField((current) => current ?? blankField(relation, payload?.storageOptions[0] ?? "", String((payload?.rows.length ?? 0) + 1)))}>＋ Add row</button><button type="button" disabled={saving || !changedFields} onClick={saveFields}>💾 Save definitions{changedFields ? ` (${changedFields})` : ""}</button></header>
    {loading && <div className="legacy-empty-state">Loading real add-on metadata…</div>}
    {error && <div className="legacy-empty-state" role="alert"><strong>Database connection failed</strong><span>{error}</span></div>}
    {!loading && payload && <div className="excel-addon-body">
      <section className="excel-panel"><div className="excel-panel-heading"><strong>Field definitions</strong><span>Click any cell to edit. Internal identifiers are hidden.</span><button type="button" disabled={saving || !selected} onClick={retireField}>Retire selected</button></div><div className="real-addon-grid"><table><thead><tr><th>RELATION</th><th>DESCRIPTION</th><th>SHORT NAME</th><th>STORAGE FIELD</th><th>TYPE</th><th>SERIAL</th><th>REQUIRED</th><th>MASTER</th><th>ENTRY</th><th>LOOKUPS</th></tr></thead><tbody>
        {newField && <tr className="new-row">{fieldCells(newField, (patch) => setNewField((current) => current ? { ...current, ...patch } : current))}<td>—</td></tr>}
        {rows.map((row) => { const draft = fieldEdits[row.key] ?? fieldDraft(row); return <tr className={`${row.key === selectedKey ? "selected " : ""}${fieldEdits[row.key] ? "dirty" : ""}`} key={row.key} onClick={() => setSelectedKey(row.key)}>{fieldCells(draft, (patch) => editField(row, patch))}<td className="lookup-count">{row.lookupValues}</td></tr>; })}
        {!rows.length && !newField && <tr><td colSpan={10} className="empty-row">No definitions match this filter.</td></tr>}
      </tbody></table></div></section>
      <section className="excel-panel lookup-panel"><div className="excel-panel-heading"><strong>Lookup values{selected ? ` — ${selected.description}` : ""}</strong><span>{selected ? "Edit values directly, then save." : "Select a field definition to manage its values."}</span><button type="button" disabled={saving || !selected} onClick={() => setNewOption((current) => current ?? { name: "", shortName: "" })}>＋ Add value</button><button type="button" disabled={saving || !changedOptions || !selected} onClick={saveOptions}>💾 Save values{changedOptions ? ` (${changedOptions})` : ""}</button></div><div className="real-addon-grid"><table><thead><tr><th>NAME</th><th>SHORT NAME</th><th>ACTION</th></tr></thead><tbody>
        {newOption && <tr className="new-row"><td><input aria-label="New lookup name" value={newOption.name} maxLength={120} onChange={(event) => setNewOption((current) => current ? { ...current, name: event.target.value } : current)} /></td><td><input aria-label="New lookup short name" value={newOption.shortName} maxLength={40} onChange={(event) => setNewOption((current) => current ? { ...current, shortName: event.target.value } : current)} /></td><td>New</td></tr>}
        {options.map((row) => { const draft = optionEdits[row.code] ?? optionDraft(row); return <tr className={optionEdits[row.code] ? "dirty" : ""} key={row.code}><td><input aria-label="Lookup name" value={draft.name} maxLength={120} onChange={(event) => editOption(row, { name: event.target.value })} /></td><td><input aria-label="Lookup short name" value={draft.shortName} maxLength={40} onChange={(event) => editOption(row, { shortName: event.target.value })} /></td><td><button type="button" disabled={saving} onClick={() => deleteOption(row)}>Delete</button></td></tr>; })}
        {!selected && <tr><td colSpan={3} className="empty-row">Select a field definition above.</td></tr>}{selected && !options.length && !newOption && <tr><td colSpan={3} className="empty-row">No lookup values for this definition.</td></tr>}
      </tbody></table></div></section>
    </div>}
    <footer><button type="button" disabled={saving || !changedFields} onClick={saveFields}>Save definitions</button><button type="button" disabled={saving || !changedOptions || !selected} onClick={saveOptions}>Save lookup values</button><button type="button" disabled={saving} onClick={() => { setFieldEdits({}); setOptionEdits({}); setNewField(null); setNewOption(null); setMessage("Unsaved cell edits discarded."); }}>Discard edits</button><button type="button" onClick={() => window.print()}>Print</button><button type="button" disabled={saving} onClick={() => setReload((value) => value + 1)}>Refresh</button><span role="status">{message}{!canWrite ? " · Writes are disabled in this deployment" : ""}</span></footer>
  </section>;
}
