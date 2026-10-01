"use client";

import { useState } from "react";
import { formatDesktopDate } from "../../lib/master-program/legacy";
import { previewPages, printDocument } from "../../lib/export/pages";
import { pdf } from "../../lib/export/pdf";
import type { PdfOptions, PrintStyle } from "../../lib/export/pdf";
import { download, safeFileName } from "../../lib/export/table";
import type { ExportTable } from "../../lib/export/table";
import { xlsx } from "../../lib/export/xlsx";
import { HotkeyLabel } from "../ui/hotkeys";
import { Icon } from "../ui/Icon";
import { FONT_SIZES, PrintPreview } from "./PrintPreview";
import { printHtmlDocument, readPrintSetup, savePrintSetup } from "./printFrame";
import type { PrintSetup } from "./printFrame";

/**
 * Print, Preview, Excel, PDF and CSV of a grid as shown (its columns, filters and sort), for
 * every grid screen. Only saved data goes out: while the grid has unsaved changes they refuse,
 * so no printout can show values that were never saved. Print and PDF first ask the layout
 * (list or one record per page), the page and the font size, offering the setup last used.
 */

export type GridOutputSource = Readonly<{
  /** The grid as shown, built only when one of the outputs runs. */
  table: () => ExportTable;
  /** The file name, without extension (made safe here). */
  name: string;
  /** The Excel sheet's name. */
  sheet: string;
  /** Header row, then the rows as shown, as text. */
  csv: () => string[][];
  /** Rows the grid shows now, and rows it holds (a filter may show none of them). */
  shownRows: number;
  totalRows: number;
  unsaved: boolean;
  userName: string;
  /** The columns' total width, which chooses landscape for a wide grid. */
  width: number;
  ask: (text: string, heading: string) => Promise<unknown>;
  /** Where the keyboard goes back when the preview closes. */
  onPreviewClose?: () => void;
}>;

export type GridOutput = ReturnType<typeof useGridOutput>;

export const UNSAVED_TIP = "Save or cancel the changes first: only saved data can be printed or exported";

export function useGridOutput(source: GridOutputSource) {
  /** The page setup last chosen in Preview or for a PDF (this browser only), used by Print and PDF too. */
  const [printSetup, setPrintSetup] = useState<PrintSetup | null>(() => (typeof window === "undefined" ? null : readPrintSetup()));
  const remember = (setup: PrintSetup) => { setPrintSetup(setup); savePrintSetup(setup); };
  /** The Print / PDF dialog: page setup and layout, and which of the two it is for. */
  const [choice, setChoice] = useState<(PrintSetup & { style: PrintStyle; purpose: "print" | "pdf" }) | null>(null);
  /** Print preview: the grid frozen as it was when opened, and the page setup chosen. */
  const [preview, setPreview] = useState<{ table: ExportTable; options: PdfOptions; name: string } | null>(null);

  const fileName = () => {
    const now = new Date();
    return safeFileName(`${source.name} - ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`);
  };
  const printedLine = () => { const now = new Date(); return `Printed ${formatDesktopDate(now)} ${now.toTimeString().slice(0, 5)} by ${source.userName}`; };
  const pdfOptions = (): PdfOptions => ({
    orientation: printSetup?.orientation ?? (source.width > 700 ? "landscape" : "portrait"),
    fontSize: printSetup?.fontSize ?? 10,
    totals: printSetup?.totals ?? true,
    footer: printedLine(),
  });
  const unsavedBlocks = async () => { if (!source.unsaved) return false; await source.ask(UNSAVED_TIP, "Print / Export"); return true; };
  const noRows = async () => { if (await unsavedBlocks()) return true; if (source.shownRows > 0) return false; await source.ask("There are no records to export.", "Export"); return true; };

  const print = async () => {
    if (await unsavedBlocks()) return;
    if (source.totalRows === 0) { await source.ask("Can't open print priview as update grid is blank", "Print failed!!"); return; }
    if (await noRows()) return;
    const { orientation, fontSize, totals } = pdfOptions();
    setChoice({ orientation, fontSize, totals, style: "list", purpose: "print" });
  };
  const showPreview = async () => {
    if (await noRows()) return;
    setPreview({ table: source.table(), options: pdfOptions(), name: fileName() });
  };
  const excel = async () => {
    if (await noRows()) return;
    download(xlsx(source.table(), source.sheet || "Sheet1"), `${fileName()}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  };
  /** PDF asks for the page setup first, offering the one last used (in Preview or here). */
  const savePdf = async () => {
    if (await noRows()) return;
    const { orientation, fontSize, totals } = pdfOptions();
    setChoice({ orientation, fontSize, totals, style: "list", purpose: "pdf" });
  };
  const csv = async () => {
    if (await unsavedBlocks()) return;
    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const lines = source.csv().map((row) => row.map(quote).join(","));
    download(String.fromCharCode(0xfeff) + lines.join("\r\n"), `${fileName()}.csv`, "text/csv;charset=utf-8");
  };
  const go = (setup: PrintSetup & { style: PrintStyle; purpose: "print" | "pdf" }) => {
    remember({ orientation: setup.orientation, fontSize: setup.fontSize, totals: setup.totals });
    setChoice(null);
    const options: PdfOptions = { orientation: setup.orientation, fontSize: setup.fontSize, totals: setup.totals, style: setup.style, footer: printedLine() };
    if (setup.purpose === "print") printHtmlDocument(printDocument(fileName(), previewPages(source.table(), options), options.orientation));
    else download(pdf(source.table(), options), `${fileName()}.pdf`, "application/pdf");
  };

  /** The preview window and the Print / PDF dialog; render once, anywhere in the screen. */
  const dialogs = (
    <>
      {preview && <PrintPreview table={preview.table} initialOptions={preview.options} title={preview.name} onOptionsChange={({ orientation, fontSize, totals }) => remember({ orientation, fontSize, totals })} onClose={() => { setPreview(null); source.onPreviewClose?.(); }} />}
      {choice && (
        <div className="mp-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setChoice(null); }}>
          <div className="mp-print-dialog" role="dialog" aria-modal="true" aria-label={choice.purpose === "print" ? "Print" : "Save as PDF"}>
            <header>
              <Icon name={choice.purpose === "print" ? "print" : "pdf"} />
              <strong>{choice.purpose === "print" ? "Print" : "Save as PDF"}</strong>
              <span>{source.shownRows} record{source.shownRows === 1 ? "" : "s"}</span>
            </header>
            <div className="mp-print-body">
              <div className="mp-print-section">Layout</div>
              <div className="mp-print-cards" role="radiogroup" aria-label="Layout">
                {([["list", "List print", "All records in a table"], ["record", "Vertical print", "Each record from a new page"]] as const).map(([style, name, hint]) => (
                  <label key={style} className={choice.style === style ? "mp-chosen" : ""}>
                    <input type="radio" name="print-style" checked={choice.style === style} onChange={() => setChoice({ ...choice, style, orientation: style === "record" ? "portrait" : choice.orientation })} />
                    <span className={`mp-print-icon mp-print-icon-${style}`} aria-hidden="true" />
                    <b>{name}</b>
                    <small>{hint}</small>
                  </label>
                ))}
              </div>
              <div className="mp-print-section">Page</div>
              <div className="mp-print-cards" role="radiogroup" aria-label="Page">
                {(["portrait", "landscape"] as const).map((orientation) => (
                  <label key={orientation} className={choice.orientation === orientation ? "mp-chosen" : ""}>
                    <input type="radio" name="pdf-orientation" checked={choice.orientation === orientation} onChange={() => setChoice({ ...choice, orientation })} />
                    <span className={`mp-sheet mp-sheet-${orientation}`} aria-hidden="true" />
                    <b>{orientation === "portrait" ? "Portrait" : "Landscape"}</b>
                  </label>
                ))}
              </div>
              <div className="mp-print-section">Font size</div>
              <div className="mp-print-sizes" role="radiogroup" aria-label="Font size">
                {FONT_SIZES.map((size) => (
                  <button key={size} type="button" role="radio" aria-checked={choice.fontSize === size} className={choice.fontSize === size ? "mp-chosen" : ""} onClick={() => setChoice({ ...choice, fontSize: size })}>{size}</button>
                ))}
                <span>pt</span>
              </div>
              {choice.style === "list" && (
                <label className="mp-print-check"><input type="checkbox" checked={choice.totals} onChange={(event) => setChoice({ ...choice, totals: event.target.checked })} />Print the totals row</label>
              )}
            </div>
            <footer>
              <button type="button" data-hotkey={choice.purpose === "print" ? "p" : "s"} aria-keyshortcuts={choice.purpose === "print" ? "Alt+P" : "Alt+S"} className="mp-print-go" ref={(element) => element?.focus()} onClick={() => go(choice)}>
                {choice.purpose === "print" ? <HotkeyLabel text="Print" hotkey="p" /> : <HotkeyLabel text="Save PDF" hotkey="s" />}
              </button>
              <button type="button" data-hotkey="c" aria-keyshortcuts="Alt+C" className="mp-print-cancel" onClick={() => setChoice(null)}><HotkeyLabel text="Cancel" hotkey="c" /></button>
            </footer>
          </div>
        </div>
      )}
    </>
  );

  return { print, preview: showPreview, excel, pdf: savePdf, csv, dialogs, unsaved: source.unsaved, open: preview !== null || choice !== null };
}
