"use client";

import { useEffect, useMemo, useState } from "react";

type MasterKind = "account" | "product";
type RealMasterField = {
  id: string;
  label: string;
  source: "standard" | "addon";
  type: "text" | "number" | "date" | "boolean" | "lookup";
  required: boolean;
  gridVisible: boolean;
  editable: boolean;
  order: number;
  options?: Array<{ value: string; label: string }>;
  writeKey?: string;
};
type RealMasterRow = { id: string; code: number; version: string; values: Record<string, string | number | boolean | null> };
type RealAccountPayload = {
  source: "legacy-postgresql";
  readOnly: true;
  screen: { programKey: 14; programName: string; heading: string };
  selection: { bookKey: number; yearId: string };
  books: Array<{ key: number; label: string; accounts: number }>;
  years: string[];
  fields: RealMasterField[];
  rows: RealMasterRow[];
  writesEnabled: boolean;
};
type RealProductPayload = {
  source: "legacy-postgresql";
  readOnly: true;
  screen: { programKey: 8; programName: string; heading: string };
  selection: { groupKey: number; yearId: string; query: string };
  groups: Array<{ key: number; label: string; products: number }>;
  years: string[];
  fields: RealMasterField[];
  rows: RealMasterRow[];
  writesEnabled: boolean;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};
type RealMasterPayload = RealAccountPayload | RealProductPayload;

function legacyGridFieldWidth(field: RealMasterField) {
  const label = field.label.trim().toUpperCase();
  if (label === "NAME" || label.includes("PRODUCT NAME") || label.includes("ACCOUNT NAME")) return 260;
  if (label.includes("ADDRESS")) return 240;
  if (label.includes("DESCRIPTION") || label.includes("NARRATION")) return 220;
  if (field.type === "date") return 128;
  if (field.type === "boolean") return 112;
  if (field.type === "number") return 136;
  return Math.min(210, Math.max(field.source === "addon" ? 148 : 132, label.length * 8 + 34));
}

function selectedName(payload: RealMasterPayload, row: RealMasterRow | null) {
  if (!row) return "";
  const name = payload.fields.find((field) => {
    const label = field.label.trim().toUpperCase();
    return label === "NAME" || label === "PRODUCT SHORT" || label.includes("PRODUCT SHORT NAME");
  });
  return String(name ? row.values[name.id] ?? row.code : row.code);
}

function downloadMasterCsv(entity: string, fields: RealMasterField[], rows: RealMasterRow[]) {
  const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [["Code", ...fields.map((field) => field.label)].map(quote).join(","), ...rows.map((row) => [row.code, ...fields.map((field) => row.values[field.id])].map(quote).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `smartwinfa-${entity.toLowerCase()}-master.csv`; anchor.click(); URL.revokeObjectURL(url);
}

function RealLegacyMasterWorkflow({ kind }: { kind: MasterKind }) {
  const isProduct = kind === "product";
  const entity = isProduct ? "Product" : "Account";
  const [payload, setPayload] = useState<RealMasterPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectionKey, setSelectionKey] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [remoteQuery, setRemoteQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [screen, setScreen] = useState<"grid" | "form">("grid");
  const [message, setMessage] = useState(`Loading ${entity} Master from the restored database…`);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (selectionKey !== null) params.set(isProduct ? "group" : "book", String(selectionKey));
    if (isProduct) {
      if (remoteQuery) params.set("q", remoteQuery);
      params.set("page", String(page));
      params.set("pageSize", "250");
    }
    const endpoint = `/api/legacy/master/${isProduct ? "product" : "account"}`;
    fetch(`${endpoint}${params.size ? `?${params}` : ""}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as RealMasterPayload | { error?: string };
        if (!response.ok || !("rows" in body)) throw new Error("error" in body && body.error ? body.error : `${entity} Master could not be loaded`);
        return body;
      })
      .then((body) => {
        setPayload(body);
        setSelectionKey("groups" in body ? body.selection.groupKey : body.selection.bookKey);
        setSelectedId(body.rows[0]?.id ?? null);
        if ("pagination" in body) {
          setPage(body.pagination.page);
          setMessage(`${body.rows.length.toLocaleString("en-IN")} shown · ${body.pagination.total.toLocaleString("en-IN")} real products`);
        } else {
          setMessage(`${body.rows.length.toLocaleString("en-IN")} real account records loaded`);
        }
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : `${entity} Master could not be loaded`);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [entity, isProduct, page, reload, remoteQuery, selectionKey]);

  const visibleFields = useMemo(() => payload?.fields.filter((field) => field.gridVisible) ?? [], [payload]);
  const gridWidth = useMemo(
    () => Math.max(1420, visibleFields.reduce((total, field) => total + legacyGridFieldWidth(field), 0)),
    [visibleFields],
  );
  const rows = useMemo(() => {
    if (!payload || isProduct) return payload?.rows ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return payload.rows;
    return payload.rows.filter((row) => Object.values(row.values).some((value) => String(value ?? "").toLowerCase().includes(needle)));
  }, [isProduct, payload, query]);
  const selected = payload?.rows.find((row) => row.id === selectedId) ?? null;
  const selectorItems = payload
    ? "groups" in payload
      ? payload.groups.map((item) => ({ key: item.key, label: `${item.label} (${item.products})` }))
      : payload.books.map((item) => ({ key: item.key, label: `${item.label} (${item.accounts})` }))
    : [];
  const pagination = payload && "pagination" in payload ? payload.pagination : null;

  const showRecord = () => {
    if (!selected || !payload) return setMessage(`Select a ${entity.toLowerCase()} row first`);
    setDraft(Object.fromEntries(payload.fields.filter((field) => field.writeKey).map((field) => [field.writeKey!, String(selected.values[field.id] ?? "")])));
    setCreating(false);
    setScreen("form");
    setMessage(`Viewing real ${entity.toLowerCase()} ${selectedName(payload, selected)}`);
  };
  const newRecord = () => { if (!payload?.writesEnabled) return setMessage("Master writes are disabled in this deployment"); setDraft({}); setCreating(true); setScreen("form"); setMessage(`Enter the new ${entity.toLowerCase()} details`); };
  const saveRecord = async (operation: "create" | "update" | "delete") => {
    if (!payload || (!creating && !selected)) return setMessage(`Select a ${entity.toLowerCase()} row first`);
    if (!payload.writesEnabled) return setMessage("Master writes are disabled in this deployment");
    if (operation === "delete" && !window.confirm(`Delete selected ${entity.toLowerCase()}? Historical entries remain unchanged.`)) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/legacy/master/${isProduct ? "product" : "account"}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation, code: creating ? undefined : selected?.code, version: creating ? undefined : selected?.version, selectionKey, yearId: payload.selection.yearId, values: draft }) });
      const body = await response.json() as { error?: string; code?: number }; if (!response.ok) throw new Error(body.error || `${entity} could not be saved`);
      setMessage(operation === "delete" ? `${entity} soft-deleted from real legacy data` : `${entity} ${operation === "create" ? "created" : "updated"} in real legacy data`);
      setScreen("grid"); setCreating(false); setReload((value) => value + 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : `${entity} could not be saved`); }
    finally { setSaving(false); }
  };
  const submitSearch = () => {
    if (!isProduct) return;
    setPage(1);
    setRemoteQuery(query.trim());
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F4" && screen === "grid") { event.preventDefault(); showRecord(); }
      if (event.key === "Escape" && screen === "form") setScreen("grid");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return <section className="legacy-master-screen" aria-label={`Legacy ${entity} Master`}>
    <header className="legacy-master-command">
      <label><strong>{isProduct ? "PRODUCT GROUP" : "BOOK / LEDGER"}</strong><select aria-label={`${entity} Master selection`} value={selectionKey ?? ""} disabled={!payload || loading} onChange={(event) => { setSelectionKey(Number(event.target.value)); setPage(1); setScreen("grid"); }}>
        {selectorItems.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select></label>
      <label><strong>YEAR</strong><select aria-label={`${entity} Master year`} value={payload?.selection.yearId ?? ""} disabled><option>{payload?.selection.yearId ?? "Loading"}</option></select></label>
      <button className="legacy-new" type="button" onClick={newRecord}>＋ New Add</button>
      <button className="legacy-cancel-both" type="button" onClick={() => { setScreen("grid"); setMessage(`Returned to ${entity} Master grid`); }}>✖ Cancel Both (Add And Update)</button>
    </header>

    {loading && <div className="legacy-empty-state">Loading desktop metadata and real {entity.toLowerCase()} rows…</div>}
    {error && <div className="legacy-empty-state" role="alert"><strong>Database connection failed</strong><span>{error}</span></div>}
    {!loading && payload && screen === "grid" && <div className="legacy-master-grid-wrap">
      <div className="legacy-grid-tools">
        <strong>{payload.screen.heading}</strong>
        <input aria-label={`${entity} grid search`} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submitSearch(); }} placeholder={`Find in real ${entity} Master data`} />
        {isProduct && <button type="button" onClick={submitSearch}>Search</button>}
        <button type="button" onClick={showRecord}>F4 Update / View</button>
        <span className="legacy-scroll-hint">↔ Scroll sideways using the bar below</span>
      </div>
      <div className="legacy-excel-grid legacy-real-data-grid">
        <table style={{ width: gridWidth }}><colgroup>{visibleFields.map((field) => <col key={field.id} style={{ width: legacyGridFieldWidth(field) }} />)}</colgroup><thead><tr>{visibleFields.map((field) => <th key={field.id}>{field.required ? "＊ " : ""}{field.label}{field.source === "addon" ? " +" : ""}</th>)}</tr></thead>
          <tbody>{rows.map((row) => <tr className={selectedId === row.id ? "selected" : ""} key={row.id} onClick={() => setSelectedId(row.id)} onDoubleClick={() => { setSelectedId(row.id); setDraft(Object.fromEntries(payload.fields.filter((field) => field.writeKey).map((field) => [field.writeKey!, String(row.values[field.id] ?? "")]))); setCreating(false); setScreen("form"); }}>
            {visibleFields.map((field) => <td key={field.id}>{String(row.values[field.id] ?? "")}</td>)}
          </tr>)}</tbody></table>
      </div>
      {pagination && <nav className="legacy-grid-pagination" aria-label="Product Master pages">
        <button type="button" disabled={pagination.page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>← Previous</button>
        <span>Page {pagination.page.toLocaleString("en-IN")} of {pagination.totalPages.toLocaleString("en-IN")} · {pagination.total.toLocaleString("en-IN")} products</span>
        <button type="button" disabled={pagination.page >= pagination.totalPages || loading} onClick={() => setPage((current) => current + 1)}>Next →</button>
      </nav>}
    </div>}

    {!loading && payload && screen === "form" && (selected || creating) && <div className="legacy-master-form-wrap">
      <div className="legacy-vertical-form"><div className="legacy-form-heading"><strong>Heading</strong><strong>Real database value</strong></div>
        {payload.fields.filter((field) => field.editable || field.gridVisible).map((field) => <label key={field.id}><span>{field.required ? "* " : ""}{field.label}{field.source === "addon" ? "  [+]" : ""}</span><input value={field.writeKey ? draft[field.writeKey] ?? "" : creating ? "" : String(selected?.values[field.id] ?? "")} readOnly={!field.writeKey || !payload.writesEnabled} aria-readonly={!field.writeKey || !payload.writesEnabled} onChange={field.writeKey ? (event) => setDraft((current) => ({ ...current, [field.writeKey!]: event.target.value })) : undefined} /></label>)}
      </div>
      <aside className="legacy-field-help"><strong>Connected legacy data</strong><span>Program: {payload.screen.programName} #{payload.screen.programKey}</span><span>Standard and add-on fields follow desktop metadata ordering.</span><span>Fields marked [+] come from addon_fld/addon_data.</span><span>{payload.writesEnabled ? "Supported account/product, address, balance and price fields save together in PostgreSQL; unsupported add-on and lookup fields remain read-only." : "Master writes are disabled in this deployment."}</span></aside>
    </div>}

    <footer className="legacy-master-actions">
      <button type="button" disabled={saving} onClick={screen === "grid" ? showRecord : () => saveRecord(creating ? "create" : "update")}>💾 {screen === "grid" ? "Update / View" : "Save"}</button>
      <button type="button" onClick={() => window.print()}>🖨 Print</button>
      <button type="button" disabled={!payload} onClick={() => { if (payload) { downloadMasterCsv(entity, visibleFields, rows); setMessage(`${rows.length.toLocaleString("en-IN")} displayed real ${entity.toLowerCase()} rows exported to CSV.`); } }}>▣ Export</button>
      <button type="button" onClick={() => { if (isProduct) setRemoteQuery(query.trim()); else setSelectionKey((current) => current); }}>🔄 Refresh</button>
      <button type="button" onClick={() => setScreen("grid")}>✖ Cancel</button>
      <button type="button" disabled={saving || creating || !selected} onClick={() => saveRecord("delete")}>Delete selected</button>
    </footer>
    <div className="legacy-master-status"><span>{message}</span><span>Source: PostgreSQL / program_top {payload?.screen.programKey ?? (isProduct ? 8 : 14)} / addon_fld</span><span>{selected ? `Key ${selected.code}` : ""}</span><span>{pagination ? `${pagination.page}/${pagination.totalPages}` : `${rows.length}/${payload?.rows.length ?? 0}`}</span></div>
  </section>;
}

export function LegacyMasterWorkflow({ kind }: { kind: MasterKind }) {
  return <RealLegacyMasterWorkflow kind={kind} />;
}
