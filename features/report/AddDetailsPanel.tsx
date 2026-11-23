"use client";

import { useEffect, useRef, useState } from "react";
import { normalName, SECTION_NAME } from "../../lib/report/detailTypes";
import type { DetailField, DetailSection } from "../../lib/report/detailTypes";
import { useEscapeClose } from "../grid/useEscapeClose";
import { Icon } from "../ui/Icon";
import type { DetailsState } from "./useDetailColumns";

/**
 * Add Details (web only): the master and entry fields a report can take as extra columns, added after the report's own.
 * Account master and Product master (their addon fields, then their other columns) and the Entry (its addon fields, then its other detail
 * columns). A section is off when the report has no account name (no product name, or is a summary for the Entry). A field the report already
 * shows is not listed. A long list is split into groups: a group's box ticks all of its fields, or one field can be ticked alone.
 */

const SECTIONS: readonly { id: DetailSection; title: string; icon: string; need: string }[] = [
  { id: "acc", title: "Account master", icon: "list", need: "an account name" },
  { id: "prod", title: "Product master", icon: "tree", need: "a product name" },
  { id: "ent", title: "Entry", icon: "log", need: "vouchers (it is not a summary)" },
];

/** A checkbox that can show "some of them" (a group with a part of its fields ticked). */
function GroupBox({ state, disabled, onChange, label }: { state: "all" | "some" | "none"; disabled: boolean; onChange: (on: boolean) => void; label: string }) {
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => { if (box.current) box.current.indeterminate = state === "some"; }, [state]);
  return <input ref={box} type="checkbox" checked={state === "all"} disabled={disabled} aria-label={label} onChange={(event) => onChange(event.target.checked)} onClick={(event) => event.stopPropagation()} />;
}

export function AddDetailsPanel({ details, onClose }: { details: DetailsState; onClose: () => void }) {
  useEscapeClose(onClose);
  const { ensure } = details;
  useEffect(() => { void ensure(); }, [ensure]);
  const [find, setFind] = useState("");
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const needle = find.trim().toLowerCase();
  const ticked = new Set(details.ticked);
  const identity = details.identity;
  const enabled: Record<DetailSection, boolean> = { acc: identity?.account != null, prod: identity?.product != null, ent: details.hasEntries };
  const checking = details.available && (identity === null || details.catalog === null) && details.error === "";

  const fieldsOf = (section: DetailSection, list: "addon" | "other"): DetailField[] =>
    (details.catalog ?? []).filter((field) => field.section === section && field.list === list
      && !field.aliases.some((alias) => details.existing.has(normalName(alias)))
      && (needle === "" || field.caption.toLowerCase().includes(needle) || field.group.toLowerCase().includes(needle)));
  const stateOf = (fields: readonly DetailField[]): "all" | "some" | "none" => {
    const count = fields.filter((field) => ticked.has(field.id)).length;
    return count === 0 ? "none" : count === fields.length ? "all" : "some";
  };
  const flip = (key: string) => setOpen((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  /** One list (addon fields / other columns) of a section, in groups. */
  const list = (section: DetailSection, title: string, kind: "addon" | "other") => {
    const fields = fieldsOf(section, kind);
    if (fields.length === 0) return null;
    const off = !enabled[section] || details.busy;
    const groups = [...new Set(fields.map((field) => field.group))].map((group) => ({ group, fields: fields.filter((field) => field.group === group) }));
    // A short list is shown open; a long one has its groups closed until opened (or until a search is typed).
    const grouped = groups.length > 1 || fields.length > 8;
    return (
      <div className="rp-ad-list">
        <div className="rp-ad-listhead">
          <span>{title}<em>{fields.length}</em></span>
          <button type="button" className="mp-btn mp-btn-plain" disabled={off} onClick={() => void details.toggle(fields.map((field) => field.id), stateOf(fields) !== "all")}>{stateOf(fields) === "all" ? "Clear all" : "Select all"}</button>
        </div>
        {groups.map(({ group, fields: inGroup }) => {
          const key = `${section}|${kind}|${group}`;
          const shown = !grouped || needle !== "" || open.has(key) || (groups.length === 1 && fields.length <= 8);
          return (
            <div key={key} className="rp-ad-group">
              {grouped && (
                <div className="rp-ad-grouphead" onClick={() => flip(key)} role="button" aria-expanded={shown}>
                  <GroupBox state={stateOf(inGroup)} disabled={off} label={`Tick all of ${group}`} onChange={(on) => void details.toggle(inGroup.map((field) => field.id), on)} />
                  <b>{group}</b>
                  <span className="rp-ad-count">{inGroup.filter((field) => ticked.has(field.id)).length}/{inGroup.length}</span>
                  <i aria-hidden="true">{shown ? "▾" : "▸"}</i>
                </div>
              )}
              {shown && (
                <div className={grouped ? "rp-ad-items rp-ad-indent" : "rp-ad-items"}>
                  {inGroup.map((field) => (
                    <label key={field.id} className="rp-ad-item">
                      <input type="checkbox" disabled={off} checked={ticked.has(field.id)} onChange={(event) => void details.toggle([field.id], event.target.checked)} />
                      {field.caption}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <aside className="rp-chart rp-adddetails" aria-label="Add details">
      <div className="rp-chart-head">
        <b><Icon name="columns" />Add Details</b>
        <button type="button" className="rp-chart-close" onClick={onClose} aria-label="Close add details">×</button>
      </div>
      <p className="rp-chart-note">Master and entry fields to add as columns after the report&apos;s own. A field the report already shows is not listed.</p>
      <input className="rp-ad-find" type="search" placeholder="Search fields…" value={find} onChange={(event) => setFind(event.target.value)} aria-label="Search fields" />
      {checking && <p className="rp-chart-note" role="status">Checking what the report has…</p>}
      {details.error && <p className="rp-compare-error" role="alert">{details.error}</p>}
      {!details.available && <p className="rp-chart-empty">Add Details is not available here.</p>}

      {details.available && SECTIONS.map((section) => {
        const addon = list(section.id, "Addon fields", "addon");
        const other = list(section.id, "Other columns", "other");
        const on = enabled[section.id];
        const count = [...ticked].filter((id) => id.startsWith(`${section.id}:`)).length;
        if (needle !== "" && !addon && !other) return null;
        return (
          <section key={section.id} className={`rp-ad-section${on ? "" : " rp-ad-off"}`} aria-disabled={!on}>
            <div className="rp-ad-title">
              <span className="rp-ad-icon"><Icon name={section.icon} /></span>
              <h3>{section.title}</h3>
              {on ? <span className="rp-ad-chip">{count > 0 ? `${count} added` : "Available"}</span> : <span className="rp-ad-chip rp-ad-chip-off">{checking ? "Checking…" : "Not available"}</span>}
            </div>
            {!on && !checking && <p className="rp-chart-note">This report has no {section.need}.</p>}
            <div className="rp-ad-lists">{addon}{other}</div>
          </section>
        );
      })}

      <section className="rp-ad-section">
        <label className="rp-ad-item"><input type="checkbox" checked={details.printToo} onChange={(event) => details.setPrintToo(event.target.checked)} />Print the added columns</label>
        <p className="rp-chart-note">{details.printToo ? "Print, Preview and PDF will include the added columns." : "Print, Preview and PDF leave the added columns out; Excel and CSV include them."}</p>
        <div className="rp-growth-buttons">
          <button type="button" className="mp-btn mp-btn-plain" onClick={() => void details.toggle(details.ticked, false)} disabled={details.ticked.length === 0 || details.busy}>Remove all added</button>
          {details.busy ? <span className="rp-chart-note" role="status">Reading the values…</span> : details.ticked.length > 0 && <span className="rp-chart-note" role="status">{details.ticked.length} column{details.ticked.length === 1 ? "" : "s"} added</span>}
        </div>
      </section>
      <p className="rp-chart-note">{SECTION_NAME.acc} and {SECTION_NAME.prod} fields are matched by name; Entry fields by voucher.</p>
    </aside>
  );
}
