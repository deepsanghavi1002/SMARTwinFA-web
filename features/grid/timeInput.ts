/**
 * A time of day typed into a grid cell (the End Time addon of Quick Update Job Out and the like), shown as hh:mm AM/PM. Hours 0-11
 * default to AM and 12-23 to PM (13-23 taken as 01-11 PM); AM and PM can be changed by typing A or P. Minutes 00-59. Blank is allowed.
 */
export const TIME_MESSAGE = "Enter the time as hh:mm AM/PM (minutes 00 to 59), for example 09:30 AM";

/** The addon input columns the desktop captions "... TIME" are time cells. */
export const isTimeCaption = (caption: string): boolean => /\btime\b/i.test(caption);

/** hh:mm and its default AM/PM: hours 12-23 are PM (13-23 less 12), 0 is 12 AM, 1-11 are AM. */
function clock(hours: number, minutes: number, suffix?: "A" | "P"): string {
  const pm = suffix ? suffix === "P" : hours >= 12;
  const shown = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
  return `${String(shown).padStart(2, "0")}:${String(minutes).padStart(2, "0")} ${pm ? "PM" : "AM"}`;
}

/** The canonical hh:mm AM/PM of a finished time, "" for blank, null for anything else. */
export function normalizeTime(typed: string): string | null {
  const text = typed.trim();
  if (text === "") return "";
  const match = /^(\d{1,2})[:.](\d{2})\s*([AaPp])?[Mm]?$/.exec(text);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const suffix = match[3]?.toUpperCase() as "A" | "P" | undefined;
  if (hours > 23 || minutes > 59 || (hours > 12 && suffix === "A")) return null;
  return clock(hours, minutes, hours > 12 ? "P" : suffix);
}

/** One typed character added to the time built so far; null refuses it. */
function addChar(built: string, ch: string): string | null {
  if (/[AP]M$/.test(built)) {
    // Finished: A or P changes AM and PM, anything else of "AM PM" is passed over.
    if (/[aApP]/.test(ch)) return built.endsWith("PM") && /[aA]/.test(ch) && Number(built.slice(0, 2)) > 12 ? null : `${built.slice(0, 5)} ${ch.toUpperCase()}M`;
    return /[mM ]/.test(ch) ? built : null;
  }
  if (/\d/.test(ch)) {
    if (built === "") return ch === "0" || ch === "1" || ch === "2" ? ch : `0${ch}:`;
    if (built.length === 1) return built === "2" ? (ch <= "3" ? `${built}${ch}:` : null) : `${built}${ch}:`;
    if (built.length === 3) return ch <= "5" ? `${built}${ch}` : null;
    if (built.length === 4) return clock(Number(built.slice(0, 2)), Number(`${built[3]}${ch}`));
    return null;
  }
  if (ch === ":") return built.length === 1 ? `0${built}:` : built.length === 2 ? `${built}:` : built.length === 3 && built.endsWith(":") ? built : null;
  return null;
}

/**
 * Typing into a time cell: only a proper time can be built. The colon goes in by itself after the hour (a first digit of 3 to 9
 * becomes 03: to 09:), the AM or PM goes in by itself after the minutes, and A or P changes it. Returns the text the cell takes, or
 * null to refuse the key. Deleting is always allowed back through a valid beginning.
 */
export function timeTyping(before: string, after: string): string | null {
  // The whole time selected (as a time cell opens) and A or P typed: only the AM / PM changes.
  if (/^[aApP]$/.test(after) && /^\d{2}:\d{2} [AP]M$/.test(before)) return addChar(before, after);
  if (after.length < before.length) return /^(\d{0,2}|\d{2}:\d{0,2}|\d{2}:\d{2} ?(A|P|AM|PM)?)$/.test(after) ? after : null;
  let built = "";
  for (const ch of after) {
    const next = addChar(built, ch);
    if (next === null) return null;
    built = next;
  }
  return built;
}
