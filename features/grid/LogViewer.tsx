"use client";

/**
 * ShowGridForm1, the edit-log window, for every screen that keeps a log: one row per saved
 * version of a record, a value that differs from the column before it coloured (yellow, green,
 * red in turn), and Export to EXCEL as a CSV the spreadsheet opens.
 */

export type LogTable = Readonly<{ columns: readonly string[]; rows: readonly (readonly string[])[]; message: string }>;

/** gridForm.Load: each cell's colour class, by comparing it with the column before it. */
export function logColours(table: LogTable): string[][] {
  return table.rows.map((row) => {
    const colours: string[] = row.map(() => "");
    for (let at = 2; at < row.length; at += 1) {
      const current = row[at].trim();
      const previous = row[at - 1].trim();
      const numbers = current !== "" && previous !== "" && Number.isFinite(Number(current)) && Number.isFinite(Number(previous));
      const equal = numbers ? Number(current) === Number(previous) : current.toLowerCase() === previous.toLowerCase();
      if (!equal) colours[at] = colours[at - 1] === "mp-log-yellow" ? "mp-log-green" : colours[at - 1] === "mp-log-green" ? "mp-log-red" : "mp-log-yellow";
    }
    return colours;
  });
}

/** The log as a CSV file (with the BOM Excel needs for UTF-8), downloaded as `<name>.csv`. */
export function exportLog(table: LogTable, name: string) {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = [table.columns.map(quote).join(","), ...table.rows.map((row) => row.map(quote).join(","))];
  const url = URL.createObjectURL(new Blob([String.fromCharCode(0xfeff) + lines.join(String.fromCharCode(13, 10))], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function LogViewer({ table, title, onClose }: { table: LogTable; title: string; onClose: () => void }) {
  const colours = logColours(table);
  return (
    <div className="mp-dialog-backdrop" role="presentation">
      <div className="mp-dialog mp-log" role="dialog" aria-modal="true" aria-label={title}>
        <strong>{title}</strong>
        <div className="mp-log-scroll">
          <table>
            <thead><tr>{table.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>
              {table.rows.map((row, index) => <tr key={index}>{row.map((value, at) => <td key={at} className={colours[index][at]}>{value}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
        <div className="mp-dialog-buttons">
          <button type="button" onClick={() => exportLog(table, title)}>Export to EXCEL</button>
          <button type="button" ref={(element) => element?.focus()} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
