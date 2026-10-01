/** Small, dependency-free pieces of the small-entry port (tested in tests/small-entry.test.mts). */

/**
 * An ORDER BY that names a column the query aliased in quotes (`1 AS "VALUE_COL" ... order by
 * VALUE_COL`): SQL Server matched it in any case, PostgreSQL folds the bare name to lowercase
 * and misses it, so the name is quoted as the alias spells it.
 */
export function orderByAliases(sql: string, orderBy: string): string {
  const aliases = new Map([...sql.matchAll(/\bas\s+"([^"]+)"/gi)].map((match) => [match[1].toLowerCase(), match[1]]));
  return orderBy.split(",").map((part) => {
    const [name, ...rest] = part.trim().split(/\s+/);
    const quoted = aliases.get(name.toLowerCase());
    return quoted ? [`"${quoted}"`, ...rest].join(" ") : part.trim();
  }).join(",");
}

/** Math.Round(decimal, 2): half to even, as .NET rounds by default. */
export function roundEven(value: number, places = 2): string {
  const factor = 10 ** places;
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  const rounded = Math.abs(diff - 0.5) < 1e-9 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(scaled);
  return String(rounded / factor);
}
