/** Small line icons for the button bars, shared by the master and small-entry screens. */
const ICONS: Record<string, string> = {
  save: "M4 3h11l4 4v14H4zM8 3v5h7V3M7 21v-7h10v7",
  print: "M7 8V3h10v5M5 17H3v-8h18v8h-2M7 14h10v7H7z",
  export: "M4 4h10l5 5v11H4zM14 4v5h5M8 13l3 3 4-5",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  cancel: "M6 6l12 12M18 6L6 18",
  quit: "M10 4H4v16h6M15 8l4 4-4 4M19 12H9",
  log: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5",
  plus: "M12 5v14M5 12h14",
  list: "M4 6h16M4 12h16M4 18h16",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01",
  search: "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM16 16l4 4",
  clear: "M4 5h16l-6 7v6l-4 2v-8z",
  columns: "M4 4h16v16H4zM9.5 4v16M14.5 4v16",
  preview: "M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  excel: "M4 3h11l5 5v13H4zM8 11l4 6M12 11l-4 6M14 3v5h6",
  pdf: "M4 3h11l5 5v13H4zM14 3v5h6M8 13h1.5a1.5 1.5 0 0 1 0 3H8v-3zM8 16v2",
  move: "M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3",
};

export function Icon({ name }: { name: string }) {
  return <svg className="mp-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[name]} /></svg>;
}
