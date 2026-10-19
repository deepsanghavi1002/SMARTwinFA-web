"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWindowActive, useWindowCloser } from "../ui/activeWindow";
import { Icon } from "../ui/Icon";
import { messageBox } from "../ui/MessageBox";

/**
 * UTILITY > Notepad (Main_Menu_New "U_NOTEPAD" starts notepad.exe). A web page cannot start a program of the PC, so the Notepad is a small
 * one inside the program: type or open a text file, save it back as a .txt download.
 */
export function Notepad({ title, onClose }: { title: string; onClose: () => void }) {
  const active = useWindowActive();
  const [text, setText] = useState("");
  const [name, setName] = useState("Untitled.txt");
  const [changed, setChanged] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => { area.current?.focus(); }, []);

  const confirmDiscard = useCallback(async () => !changed || (await messageBox.ask("Do you want to discard the changes ?", "Notepad", ["Yes", "No"], { defaultButton: "No" })) === "Yes", [changed]);

  const quit = useCallback(async () => { if (await confirmDiscard()) onClose(); }, [confirmDiscard, onClose]);
  useWindowCloser(quit);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!active.current || event.defaultPrevented || document.querySelector(".msgbox-backdrop")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); save(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") { event.preventDefault(); picker.current?.click(); }
      else if (event.key === "Escape") { event.preventDefault(); void quit(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const fresh = async () => {
    if (!(await confirmDiscard())) return;
    // A new file asks for its name.
    const typed = await messageBox.prompt("Enter the file name", "New File");
    if (typed === null) return;
    const clean = typed.trim().replace(/[\\/:*?"<>|]/g, "");
    setText(""); setName(clean === "" ? "Untitled.txt" : /\.[A-Za-z0-9]+$/.test(clean) ? clean : `${clean}.txt`); setChanged(false);
    area.current?.focus();
  };

  const open = async (file: File | undefined) => {
    if (!file) return;
    if (!(await confirmDiscard())) return;
    setText(await file.text()); setName(file.name); setChanged(false);
    area.current?.focus();
  };

  function save() {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = /\.[A-Za-z0-9]+$/.test(name) ? name : `${name}.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
    setChanged(false);
  }

  return (
    <div className="mp-screen te-screen np-screen" role="region" aria-label={title}>
      <div className="mp-combos sec-combos">
        <label className="sec-combo"><span>FILE NAME</span><input className="np-name" aria-label="File name" value={name} onChange={(event) => setName(event.target.value.replace(/[\\/:*?"<>|]/g, ""))} />{changed ? <span>*</span> : null}</label>
        <span className="mp-heading">{title.toUpperCase()}</span>
      </div>
      <div className="sec-body np-body">
        <textarea ref={area} className="np-area" spellCheck={false} aria-label="Notepad" value={text} onChange={(event) => { setText(event.target.value); setChanged(true); }} />
      </div>
      <input ref={picker} type="file" accept=".txt,.csv,.log,.md,.json,.xml,text/*" hidden onChange={(event) => { void open(event.target.files?.[0]); event.target.value = ""; }} />
      <div className="mp-buttons sec-buttons">
        <button type="button" className="mp-btn mp-btn-blue" onClick={() => void fresh()}>New</button>
        <button type="button" className="mp-btn mp-btn-blue" onClick={() => picker.current?.click()} title="Ctrl+O">Open…</button>
        <button type="button" className="mp-btn mp-btn-green" onClick={save} title="Ctrl+S"><Icon name="save" />Save</button>
        <button type="button" className="mp-btn mp-btn-red" onClick={() => void quit()}><Icon name="quit" />Quit</button>
      </div>
    </div>
  );
}
