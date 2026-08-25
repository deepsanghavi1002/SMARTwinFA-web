"use client";

import { useEffect, useMemo, useState } from "react";

type AddonRow = {
  key: number; version: string;
  relation: string;
  description: string;
  shortName: string;
  storageName: string;
  type: string;
  serial: string;
  required: boolean;
  masterVisible: boolean;
  entryPosition: string;
  lookupValues: number;
};
type AddonPayload = {
  source: "legacy-postgresql";
  readOnly: true;
  writesEnabled: boolean;
  relations: Array<{ key: string; label: string; fields: number }>;
  rows: AddonRow[];
  options: Array<{ code: number; fieldKey: number; name: string; shortName: string; version: string }>;
  storageOptions: string[];
};
type FieldDraft = { relation: string; description: string; shortName: string; storageName: string; type: string; serial: string; required: boolean; masterVisible: boolean; entryPosition: string };

export function AddonMaster() {
  const [relation, setRelation] = useState("A");
  const [payload, setPayload] = useState<AddonPayload | null>(null);
  const [selectedKey, setSelectedKey] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("Loading real add-on definitions…");
  const [optionCode, setOptionCode] = useState<number | null>(null);
  const [optionName, setOptionName] = useState("");
  const [optionShortName, setOptionShortName] = useState("");
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [fieldMode, setFieldMode] = useState<"create" | "update" | null>(null);
  const [fieldDraft, setFieldDraft] = useState<FieldDraft>({ relation: "A", description: "", shortName: "", storageName: "", type: "T", serial: "0", required: false, masterVisible: true, entryPosition: "" });

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/legacy/master/addon?relation=${encodeURIComponent(relation)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as AddonPayload | { error?: string };
        if (!response.ok || !("rows" in body)) throw new Error("error" in body && body.error ? body.error : "Addon Master could not be loaded");
        return body;
      })
      .then((body) => {
        setPayload(body);
        setSelectedKey(body.rows[0]?.key ?? null);
        setMessage(`${body.rows.length} real add-on field definitions loaded`);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Addon Master could not be loaded");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [relation, reload]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return payload?.rows ?? [];
    return payload?.rows.filter((row) => [row.description, row.shortName, row.storageName, row.type].some((value) => value.toLowerCase().includes(needle))) ?? [];
  }, [payload, query]);
  const selected = payload?.rows.find((row) => row.key === selectedKey) ?? null;
  const options = payload?.options.filter((option) => option.fieldKey === selectedKey) ?? [];
  const selectedOption = options.find((option) => option.code === optionCode) ?? null;
  const chooseOption = (code: number) => {
    const option = options.find((item) => item.code === code);
    setOptionCode(code); setOptionName(option?.name ?? ""); setOptionShortName(option?.shortName ?? "");
  };
  const newOption = () => { setOptionCode(null); setOptionName(""); setOptionShortName(""); setMessage("Enter a new lookup value for the selected field"); };
  const newField = () => { setFieldDraft({ relation, description: "", shortName: "", storageName: payload?.storageOptions[0] ?? "", type: "T", serial: String((payload?.rows.length ?? 0) + 1), required: false, masterVisible: true, entryPosition: "" }); setFieldMode("create"); setMessage("Enter a real add-on field definition backed by an existing addon_data column."); };
  const editField = () => { if (!selected) return setMessage("Select an add-on field first"); setFieldDraft({ relation: selected.relation, description: selected.description, shortName: selected.shortName, storageName: selected.storageName, type: selected.type || "T", serial: selected.serial || "0", required: selected.required, masterVisible: selected.masterVisible, entryPosition: selected.entryPosition }); setFieldMode("update"); setMessage(`Editing real add-on field ${selected.description}`); };
  const saveField = async (operation: "create" | "update" | "delete") => {
    if (!payload?.writesEnabled) return setMessage("Master writes are disabled in this deployment");
    if (operation !== "create" && !selected) return setMessage("Select an add-on field first");
    if (operation === "delete" && !window.confirm(`Retire add-on field “${selected?.description}”? Existing values stay intact.`)) return;
    setSaving(true);
    try {
      const response = await fetch("/api/legacy/master/addon", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entity: "field", operation, key: selected?.key, version: selected?.version, ...fieldDraft, serial: Number(fieldDraft.serial) }) });
      const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(body.error || "Add-on field could not be saved");
      setFieldMode(null); setMessage(operation === "delete" ? "Add-on field retired from real legacy metadata." : `Add-on field ${operation === "create" ? "created" : "updated"} in real legacy metadata.`); setReload((value) => value + 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Add-on field could not be saved"); }
    finally { setSaving(false); }
  };
  const saveOption = async (operation: "create" | "update" | "delete") => {
    if (!selected) return setMessage("Select an add-on field first");
    if (!payload?.writesEnabled) return setMessage("Master writes are disabled in this deployment");
    if (operation !== "create" && !selectedOption) return setMessage("Select an existing lookup value first");
    if (operation === "delete" && !window.confirm(`Delete lookup value “${selectedOption?.name}”? Existing documents keep their stored value.`)) return;
    setSaving(true);
    try {
      const response = await fetch("/api/legacy/master/addon", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, fieldKey: selected.key, code: selectedOption?.code, version: selectedOption?.version, name: optionName, shortName: optionShortName }) });
      const body = await response.json() as { error?: string; code?: number };
      if (!response.ok) throw new Error(body.error || "Add-on value could not be saved");
      setMessage(operation === "delete" ? "Lookup value soft-deleted from real legacy data" : `Lookup value ${operation === "create" ? "created" : "updated"} in real legacy data`);
      setOptionCode(null); setOptionName(""); setOptionShortName(""); setReload((value) => value + 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Add-on value could not be saved"); }
    finally { setSaving(false); }
  };

  return <section className="real-addon-master" aria-label="Real Addon Master">
    <header>
      <strong>ADDON MASTER</strong>
      <label>Relation<select aria-label="Addon relation" value={relation} disabled={loading} onChange={(event) => setRelation(event.target.value)}>
        {payload?.relations.map((item) => <option key={item.key} value={item.key}>{item.label} ({item.fields})</option>) ?? <><option value="A">Account fields</option><option value="P">Product fields</option></>}
      </select></label>
      <input aria-label="Search add-on fields" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find real field definition" />
      <button type="button" onClick={newField}>＋ New Field</button><button type="button" onClick={newOption}>＋ New Lookup Value</button>
    </header>
    {loading && <div className="legacy-empty-state">Loading real add-on metadata and lookup counts…</div>}
    {error && <div className="legacy-empty-state" role="alert"><strong>Database connection failed</strong><span>{error}</span></div>}
    {!loading && payload && <div className="real-addon-body">
      <div className="real-addon-grid"><table><thead><tr><th>KEY</th><th>DESCRIPTION</th><th>SHORT NAME</th><th>STORAGE FIELD</th><th>TYPE</th><th>SERIAL</th><th>REQUIRED</th><th>MASTER</th><th>ENTRY</th><th>LOOKUPS</th></tr></thead><tbody>
        {rows.map((row) => <tr className={row.key === selectedKey ? "selected" : ""} key={row.key} onClick={() => setSelectedKey(row.key)}><td>{row.key}</td><td>{row.description}</td><td>{row.shortName}</td><td>{row.storageName}</td><td>{row.type}</td><td>{row.serial}</td><td>{row.required ? "Yes" : "No"}</td><td>{row.masterVisible ? "Yes" : "No"}</td><td>{row.entryPosition}</td><td>{row.lookupValues}</td></tr>)}
      </tbody></table></div>
      <aside><strong>{fieldMode ? (fieldMode === "create" ? "New add-on field" : "Edit add-on field") : "Connected definition"}</strong>{fieldMode ? <><label>Relation<select aria-label="Add-on field relation" value={fieldDraft.relation} onChange={(event) => setFieldDraft((current) => ({ ...current, relation: event.target.value }))}>{payload.relations.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label><label>Description<input aria-label="Add-on field description" value={fieldDraft.description} maxLength={120} onChange={(event) => setFieldDraft((current) => ({ ...current, description: event.target.value }))} /></label><label>Short name<input aria-label="Add-on field short name" value={fieldDraft.shortName} maxLength={40} onChange={(event) => setFieldDraft((current) => ({ ...current, shortName: event.target.value }))} /></label><label>Storage field<select aria-label="Add-on data storage field" value={fieldDraft.storageName} onChange={(event) => setFieldDraft((current) => ({ ...current, storageName: event.target.value }))}><option value="">Select restored column…</option>{payload.storageOptions.map((column) => <option key={column}>{column}</option>)}</select></label><label>Type<select aria-label="Add-on field type" value={fieldDraft.type} onChange={(event) => setFieldDraft((current) => ({ ...current, type: event.target.value }))}><option value="T">Text</option><option value="M">Lookup</option><option value="N">Number</option><option value="D">Date</option></select></label><label>Serial<input aria-label="Add-on field serial" inputMode="numeric" value={fieldDraft.serial} onChange={(event) => setFieldDraft((current) => ({ ...current, serial: event.target.value }))} /></label><label>Entry position<input aria-label="Add-on field entry position" value={fieldDraft.entryPosition} onChange={(event) => setFieldDraft((current) => ({ ...current, entryPosition: event.target.value }))} /></label><label><input type="checkbox" checked={fieldDraft.required} onChange={(event) => setFieldDraft((current) => ({ ...current, required: event.target.checked }))} /> Required</label><label><input type="checkbox" checked={fieldDraft.masterVisible} onChange={(event) => setFieldDraft((current) => ({ ...current, masterVisible: event.target.checked }))} /> Show in master</label><div><button type="button" disabled={saving} onClick={() => saveField(fieldMode)}>Save field</button><button type="button" onClick={() => setFieldMode(null)}>Cancel</button></div><small>Definitions use the selected real `addon_data` column; no mock fields are created.</small></> : selected ? <><span>Field key: {selected.key}</span><span>Relation: {selected.relation === "A" ? "Account" : selected.relation === "P" ? "Product" : selected.relation}</span><span>Storage: addon_data · {selected.storageName}</span><span>Lookup values: {selected.lookupValues}</span><span>Source: addon_fld / addon_sub</span><button type="button" onClick={editField}>Edit field</button><button type="button" disabled={saving} onClick={() => saveField("delete")}>Retire field</button><label>Lookup value<select aria-label="Existing lookup value" value={optionCode ?? ""} onChange={(event) => chooseOption(Number(event.target.value))}><option value="">New value</option>{options.map((option) => <option key={option.code} value={option.code}>{option.name}</option>)}</select></label><label>Name<input value={optionName} maxLength={120} onChange={(event) => setOptionName(event.target.value)} /></label><label>Short name<input value={optionShortName} maxLength={40} onChange={(event) => setOptionShortName(event.target.value)} /></label><small>{payload.writesEnabled ? "Real-data writes enabled · duplicate and concurrency checks active" : "Real-data writes disabled in this deployment"}</small></> : <span>Select a field definition.</span>}</aside>
    </div>}
    <footer><button type="button" disabled={saving} onClick={() => saveOption(selectedOption ? "update" : "create")}>Save</button><button type="button" disabled={saving || !selectedOption} onClick={() => saveOption("delete")}>Delete</button><button type="button" onClick={() => window.print()}>Print</button><button type="button" onClick={() => setReload((value) => value + 1)}>Refresh</button><span role="status">{message}</span></footer>
  </section>;
}
