"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Autocomplete, Box, Button, Card, CardActions, CardContent, Divider, Stack, TextField, Typography } from "@mui/material";
import { addonFields, addonGroups, createBlankAddon, initialAddonRecords, stateOptions } from "./mock-data";
import type { AddonRecord } from "./types";

const fieldSections = [
  {
    title: "Customer / Contact details",
    keys: ["name", "shortName", "contact", "mobile", "telephone", "email", "fax"] as (keyof AddonRecord)[],
  },
  {
    title: "Address / Location details",
    keys: ["address1", "address2", "address3", "city", "district", "state", "pincode"] as (keyof AddonRecord)[],
  },
  {
    title: "Business / Tax details",
    keys: ["openingBalance", "margin", "localCode", "stdCode", "vat", "cst", "pan", "aadhaar", "gst", "startDate", "lastDate", "website", "remark"] as (keyof AddonRecord)[],
  },
];

const businessSectionGroups = [
  {
    title: "Codes & balances",
    keys: ["openingBalance", "margin", "localCode", "stdCode", "vat", "cst"] as (keyof AddonRecord)[],
  },
  {
    title: "Tax & ID numbers",
    keys: ["pan", "aadhaar", "gst", "startDate", "lastDate"] as (keyof AddonRecord)[],
  },
  {
    title: "Web & notes",
    keys: ["website", "remark"] as (keyof AddonRecord)[],
  },
];

const sectionGridColumns: Record<string, { xs: string; md: string }> = {
  "Customer / Contact details": { xs: "1fr", md: "repeat(2,minmax(0,1fr))" },
  "Address / Location details": { xs: "1fr", md: "repeat(2,minmax(0,1fr))" },
  "Business / Tax details": { xs: "1fr", md: "repeat(3,minmax(0,1fr))" },
};

const wideFields = new Set<keyof AddonRecord>(["address1", "address2", "address3", "email"]);
const mediumFields = new Set<keyof AddonRecord>(["contact", "city", "district", "telephone", "mobile", "openingBalance", "margin", "pan", "aadhaar", "gst"]);
const compactFields = new Set<keyof AddonRecord>(["shortName", "pincode", "localCode", "stdCode", "vat", "cst", "startDate", "lastDate", "fax"]);
const businessWideFields = new Set<keyof AddonRecord>([]);
const addressLineFields = new Set<keyof AddonRecord>(["address1", "address2", "address3"]);

function ActionIcon({ kind }: { kind: "save" | "cancel" | "delete" | "print" | "refresh" }) {
  const paths = {
    save: <><path d="M5 3h12l2 2v14H5z"/><path d="M8 3v6h8V3M8 19v-6h8v6"/></>,
    cancel: <><path d="M5 5l14 14M19 5L5 19"/></>,
    delete: <><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/></>,
    print: <><path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/></>,
    refresh: <><path d="M19 7V3l-2 2a8 8 0 10 2 10M19 3h-4"/></>,
  };
  return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[kind]}</svg>;
}

export function AddonMaster() {
  const rootRef = useRef<HTMLElement>(null);
  const [records, setRecords] = useState(initialAddonRecords);
  const [groupId, setGroupId] = useState("architect");
  const [mode, setMode] = useState<"add" | "update">("add");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const nextId = () => Math.max(0, ...records.map((record) => record.id)) + 1;
  const [draft, setDraft] = useState(() => createBlankAddon(6, "architect"));
  const [helpField, setHelpField] = useState<"name" | "state" | null>(null);
  const [message, setMessage] = useState("Ready");
  const [isModernView, setIsModernView] = useState(false);
  const groupRecords = useMemo(() => records.filter((record) => record.groupId === groupId), [records, groupId]);
  const fieldMap = useMemo(() => Object.fromEntries(addonFields.map((field) => [field.key, field])) as Record<keyof AddonRecord, typeof addonFields[number]>, []);
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

  useEffect(() => {
    const updateViewMode = () => {
      const container = rootRef.current?.closest(".view-mode");
      setIsModernView(Boolean(container?.classList.contains("modern-view")));
    };
    updateViewMode();
    const observer = new MutationObserver(updateViewMode);
    const container = rootRef.current?.closest(".view-mode");
    if (container) observer.observe(container, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return <section className="addon-master" aria-label="Addon sub master" ref={rootRef}>
    <div className="addon-heading"><strong>SUB MASTER</strong><select aria-label="Addon type" value={groupId} onChange={(event) => { const group = event.target.value; setGroupId(group); reset(group); setMessage("Ready"); }}>{addonGroups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select>{!isModernView && <span><svg className="header-cancel-icon" viewBox="0 0 18 18" aria-hidden="true"><rect x="1" y="1" width="16" height="16" rx="1"/><path d="M5 5l8 8M13 5l-8 8"/></svg>Cancel Both (Add And Update)</span>}</div>
    <div className="addon-tabs"><button className={mode === "add" ? "active" : ""} onClick={() => reset()}>New(Add)</button><button className={mode === "update" ? "active" : ""} onClick={() => setHelpField("name")}>Update/Delete</button></div>
    <div className="addon-body">
      {!isModernView && <div className="addon-form addon-form-legacy">
        <div className="addon-row addon-column-head"><span>Heading</span><span>Input</span></div>
        {addonFields.map((field) => <label className="addon-row" key={`legacy-${field.key}`}><span>{field.label}</span><input aria-label={field.label} value={draft[field.key]} onFocus={() => setHelpField(field.help ?? (field.key === "name" ? "name" : null))} onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))} /></label>)}
      </div>}
      {isModernView && <Box className="addon-form addon-form-modern" sx={{ display: "grid", gap: 1.2, width: "100%" }}>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "repeat(2,minmax(0,1fr))" }, gap: 1.4, alignItems: "start" }}>
          {fieldSections.map((section) => (
            <Card
              key={section.title}
              elevation={0}
              sx={{
                borderRadius: 2,
                border: "1px solid #dfe8ee",
                background: "linear-gradient(180deg,#ffffff 0%,#f7fbff 100%)",
                boxShadow: "0 8px 22px #1b415508",
                height: "100%",
                overflow: "hidden",
                gridColumn: section.title === "Business / Tax details"
                  ? { xs: "auto", lg: "1 / -1" }
                  : "auto",
              }}
            >
              <CardContent sx={{ p: 1.2, "&:last-child": { pb: 1.2 } }}>
                <Stack spacing={0.85}>
                  <Box sx={{ mx: -1.2, mt: -1.2, px: 1.2, py: 0.85, background: "linear-gradient(90deg,#effbf6 0%,#e8f5fb 46%,#edf3ff 100%)", borderBottom: "1px solid #e1edf3" }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, color: "#173b57", letterSpacing: ".01em", fontSize: "0.92rem" }}>
                      {section.title}
                    </Typography>
                  </Box>
                  {section.title === "Business / Tax details" ? (
                    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "repeat(2,minmax(0,1fr))" }, gap: 1 }}>
                      {businessSectionGroups.map((group) => (
                        <Box
                          key={group.title}
                          sx={{
                            border: "1px solid #e6eef4",
                            background: "linear-gradient(180deg,#fbfdff 0%,#f6fafd 100%)",
                            px: 1.05,
                            py: 0.9,
                            gridColumn: group.title === "Web & notes" ? { xs: "auto", lg: "1 / -1" } : "auto",
                          }}
                        >
                          <Typography
                            sx={{
                              mb: 0.7,
                              color: "#173b57",
                              fontSize: 12.25,
                              fontWeight: 800,
                              letterSpacing: ".02em",
                              textTransform: "none",
                              lineHeight: 1.2,
                            }}
                          >
                            {group.title}
                          </Typography>
                          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3,minmax(0,1fr))" }, gap: 0.95 }}>
                            {group.keys.map((key) => {
                              const field = fieldMap[key];
                              const currentValue = draft[field.key] as string;
                              return (
                                <Box
                                  key={field.key}
                                  sx={{
                                    width: "100%",
                                    maxWidth: key === "website"
                                      ? { xs: "100%", md: 280 }
                                      : key === "remark"
                                        ? { xs: "100%", md: 280 }
                                        : compactFields.has(key)
                                          ? { xs: "100%", md: 190 }
                                          : mediumFields.has(key)
                                            ? { xs: "100%", md: 230 }
                                            : { xs: "100%", md: 210 },
                                    gridColumn: key === "remark" ? { xs: "1 / -1", md: "span 2" } : "auto",
                                  }}
                                >
                                  <Typography
                                    sx={{
                                      mb: 0.28,
                                      color: "#6f8595",
                                      fontSize: 9.5,
                                      fontWeight: 700,
                                      letterSpacing: ".08em",
                                      textTransform: "uppercase",
                                      lineHeight: 1.2,
                                    }}
                                  >
                                    {field.label.replace("* ", "")}
                                  </Typography>
                                  <TextField
                                    value={currentValue}
                                    onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                                    placeholder={key === "website" ? "https://example.com" : undefined}
                                    variant="standard"
                                    size="small"
                                    fullWidth
                                    sx={{
                                      "& .MuiInputBase-root": { minHeight: 34 },
                                      "& .MuiInputBase-input": { py: 0.42 },
                                      "& .MuiInput-underline:before": { borderBottomColor: "#c9d7e3" },
                                      "& .MuiInput-underline:hover:not(.Mui-disabled, .Mui-error):before": { borderBottomColor: "#8fb3cf" },
                                    }}
                                  />
                                </Box>
                              );
                            })}
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  ) : (
                  <Box sx={{ display: "grid", gridTemplateColumns: sectionGridColumns[section.title], gap: 0.95 }}>
                    {section.keys.map((key) => {
                      const field = fieldMap[key];
                      const isRecordLookup = key === "name";
                      const isStateLookup = key === "state";
                      const currentValue = draft[field.key] as string;
                      const isBusinessSection = section.title === "Business / Tax details";
                      const isAddressLine = addressLineFields.has(key);
                      const shouldSpanFull = wideFields.has(key) || isRecordLookup || (isBusinessSection && businessWideFields.has(key));
                      return (
                        <Box
                          key={field.key}
                          sx={{
                            gridColumn: shouldSpanFull ? { xs: "1 / -1", md: "1 / -1" } : "auto",
                            width: "100%",
                            maxWidth: shouldSpanFull
                              ? (isRecordLookup ? { xs: "100%", md: 420 } : "100%")
                              : compactFields.has(key)
                                ? { xs: "100%", md: isBusinessSection ? 190 : 165 }
                                : mediumFields.has(key)
                                  ? { xs: "100%", md: isBusinessSection ? 230 : 220 }
                                  : { xs: "100%", md: isBusinessSection ? 210 : 200 },
                          }}
                        >
                          <Typography sx={{ mb: isAddressLine ? 0.22 : 0.28, color: isAddressLine ? "#6b8190" : "#5d7587", fontSize: isAddressLine ? 9.25 : 10.5, fontWeight: isAddressLine ? 600 : 700, letterSpacing: isAddressLine ? ".02em" : ".04em", textTransform: isAddressLine ? "none" : "uppercase" }}>
                            {isAddressLine ? field.label.replace("* ", "").replace("Address", "Line") : field.label.replace("* ", "")}
                          </Typography>
                          {isRecordLookup ? (
                            <Autocomplete
                              freeSolo
                              options={groupRecords.map((record) => record.name)}
                              value={draft.name || null}
                              inputValue={draft.name}
                              slotProps={{
                                popper: {
                                  placement: "bottom-start",
                                  modifiers: [
                                    { name: "offset", options: { offset: [0, 6] } },
                                    { name: "flip", enabled: false },
                                    { name: "preventOverflow", enabled: false },
                                  ],
                                  sx: {
                                    "& .MuiAutocomplete-paper": {
                                      borderRadius: 1,
                                      boxShadow: "0 10px 24px rgba(23,59,87,0.12)",
                                    },
                                    "& .MuiAutocomplete-listbox": {
                                      py: 0.5,
                                    },
                                    "& .MuiAutocomplete-option": {
                                      minHeight: 32,
                                      fontSize: "0.9rem",
                                      px: 1.5,
                                      py: 0.35,
                                    },
                                  },
                                },
                                paper: {
                                  sx: { maxHeight: 280, overflow: "auto" },
                                },
                              }}
                              onInputChange={(_, value, reason) => {
                                if (reason === "reset") return;
                                setDraft((current) => ({ ...current, name: value }));
                              }}
                              onChange={(_, value) => {
                                const selected = typeof value === "string" ? value : value ?? "";
                                const matchedRecord = groupRecords.find((record) => record.name === selected);
                                if (matchedRecord) {
                                  selectRecord(matchedRecord);
                                } else {
                                  setDraft((current) => ({ ...current, name: selected }));
                                }
                              }}
                              renderInput={(params) => (
                                <TextField
                                  {...params}
                                  placeholder="Select or search record"
                                  variant="standard"
                                  size="small"
                                  fullWidth
                                  sx={{
                                    "& .MuiInputBase-root": { minHeight: 34 },
                                    "& .MuiInputBase-input": { py: 0.42 },
                                    "& .MuiInput-underline:before": { borderBottomColor: "#c9d7e3" },
                                    "& .MuiInput-underline:hover:not(.Mui-disabled, .Mui-error):before": { borderBottomColor: "#8fb3cf" },
                                  }}
                                />
                              )}
                            />
                          ) : isStateLookup ? (
                            <Autocomplete
                              freeSolo
                              options={stateOptions}
                              value={draft.state || null}
                              inputValue={draft.state}
                              slotProps={{
                                popper: {
                                  placement: "bottom-start",
                                  modifiers: [
                                    { name: "offset", options: { offset: [0, 6] } },
                                    { name: "flip", enabled: false },
                                    { name: "preventOverflow", enabled: false },
                                  ],
                                  sx: {
                                    "& .MuiAutocomplete-paper": {
                                      borderRadius: 1,
                                      boxShadow: "0 10px 24px rgba(23,59,87,0.12)",
                                    },
                                    "& .MuiAutocomplete-listbox": {
                                      py: 0.5,
                                    },
                                    "& .MuiAutocomplete-option": {
                                      minHeight: 32,
                                      fontSize: "0.9rem",
                                      px: 1.5,
                                      py: 0.35,
                                    },
                                  },
                                },
                                paper: {
                                  sx: { maxHeight: 280, overflow: "auto" },
                                },
                              }}
                              onInputChange={(_, value, reason) => {
                                if (reason === "reset") return;
                                setDraft((current) => ({ ...current, state: value }));
                              }}
                              onChange={(_, value) => {
                                const selected = typeof value === "string" ? value : value ?? "";
                                setDraft((current) => ({ ...current, state: selected }));
                              }}
                              renderInput={(params) => (
                                <TextField
                                  {...params}
                                  placeholder="Search state"
                                  variant="standard"
                                  size="small"
                                  fullWidth
                                  sx={{
                                    "& .MuiInputBase-root": { minHeight: 34 },
                                    "& .MuiInputBase-input": { py: 0.42 },
                                    "& .MuiInput-underline:before": { borderBottomColor: "#c9d7e3" },
                                    "& .MuiInput-underline:hover:not(.Mui-disabled, .Mui-error):before": { borderBottomColor: "#8fb3cf" },
                                  }}
                                />
                              )}
                            />
                          ) : (
                            <TextField
                              value={currentValue}
                              onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                              placeholder={isAddressLine ? `Address line ${key.slice(-1)}` : undefined}
                              variant="standard"
                              size="small"
                              fullWidth
                              sx={{
                                "& .MuiInputBase-root": { minHeight: isAddressLine ? 32 : 34, borderBottom: isAddressLine ? "1px solid #dbe5ec" : undefined },
                                "& .MuiInputBase-input": { py: isAddressLine ? 0.34 : 0.42 },
                                "& .MuiInput-underline:before": { borderBottomColor: "#c9d7e3" },
                                "& .MuiInput-underline:hover:not(.Mui-disabled, .Mui-error):before": { borderBottomColor: "#8fb3cf" },
                              }}
                            />
                          )}
                        </Box>
                      );
                    })}
                  </Box>
                  )}
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Box>
      </Box>}
      {!isModernView && <aside className="addon-help addon-help-legacy">
        {helpField === "name" && <><div className="addon-help-head"><span>SELECTED GROUP</span><span>DESCRIPTION</span><span>SHORT</span></div>{groupRecords.map((record) => <button className="addon-help-row" key={`legacy-${record.id}`} onClick={() => selectRecord(record)}><span>{addonGroups.find((group) => group.id === groupId)?.name}</span><b>{record.name}</b><small>{record.shortName}</small></button>)}<p>Total Help Record : {groupRecords.length}</p></>}
        {helpField === "state" && <><strong>SELECT STATE</strong>{stateOptions.map((state) => <button className="state-help-row" key={`legacy-${state}`} onClick={() => { setDraft((current) => ({ ...current, state })); setHelpField(null); }}><b>{state}</b></button>)}</>}
      </aside>}
    </div>
    {isModernView ? (
      <CardActions
        className="addon-actions"
        sx={{
          position: "sticky",
          bottom: 0,
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 2,
          px: 2.25,
          py: 1.25,
          borderTop: "1px solid #dbe6ee",
          background: "linear-gradient(180deg,#ffffffeb,#f6fbff)",
          backdropFilter: "blur(10px)",
        }}
      >
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
          <Button variant="text" size="small" onClick={() => window.print()} sx={{ color: "#5f7483", minWidth: 0, px: 1.25 }}>
            Print
          </Button>
          <Button variant="text" size="small" onClick={() => setMessage("Data refreshed")} sx={{ color: "#5f7483", minWidth: 0, px: 1.25 }}>
            Refresh
          </Button>
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5, borderColor: "#dbe6ee" }} />
          <Button variant="text" size="small" color="error" onClick={remove} sx={{ minWidth: 0, px: 1.25 }}>
            Delete
          </Button>
          <Button variant="outlined" size="small" onClick={() => { reset(); setMessage("Cancelled"); }} sx={{ px: 1.5 }}>
            Cancel
          </Button>
          <Button variant="contained" size="small" onClick={save} sx={{ px: 2 }}>
            Save
          </Button>
        </Box>
      </CardActions>
    ) : (
      <div className="addon-actions"><button type="button" onClick={save}><ActionIcon kind="save" />Save</button><button type="button" onClick={() => { reset(); setMessage("Cancelled"); }}><ActionIcon kind="cancel" />Cancel</button><button type="button" onClick={remove}><ActionIcon kind="delete" />Delete</button><button type="button" onClick={() => window.print()}><ActionIcon kind="print" />Print</button><button type="button" onClick={() => setMessage("Data refreshed")}><ActionIcon kind="refresh" />Refresh</button><span role="status">{message}</span></div>
    )}
  </section>;
}
