/**
 * The monthly salary of one staff member, as a pure calculation (no database): the same inputs always give the same slip.
 *
 *  - Monthly pay basis: every fixed earning is pro-rated by paid days / days of the month (never above 1); a % of BASIC earning is the percentage of
 *    the pro-rated BASIC. Daily pay basis: the structure holds a per-day rate and the earning is rate x paid days.
 *  - Deductions of the structure are taken in full (a % of BASIC deduction is of the pro-rated BASIC).
 *  - PF: on the earnings marked "counts for PF", up to the wage ceiling. ESI: on the earnings marked for ESI, only while that gross is within the
 *    ceiling. Professional tax: a fixed amount from a gross. All three need the staff member's own switch (PF / ESI / PT applies).
 *  - Employee PF is rounded to the nearest rupee, ESI up to the next rupee, as the statutory returns are.
 */

export type CalcSetup = Readonly<{
  daysBasis: "CAL" | "FIX"; fixedDays: number; pfPct: number; pfEmpPct: number; pfCeiling: number;
  esiPct: number; esiEmpPct: number; esiCeiling: number; ptAmount: number; ptFromGross: number;
}>;

export type CalcStructureRow = Readonly<{ componentId: number; name: string; type: "E" | "D"; calc: "F" | "P"; pf: boolean; esi: boolean; seq: number; amount: number }>;

export type CalcInput = Readonly<{
  setup: CalcSetup;
  payBasis: "M" | "D";
  pfOn: boolean; esiOn: boolean; ptOn: boolean;
  /** Calendar days of the month being paid. */
  calendarDays: number;
  /** Days paid (from attendance, or the month's default). */
  paidDays: number;
  structure: readonly CalcStructureRow[];
}>;

export type CalcLine = Readonly<{ componentId: number | null; name: string; type: "E" | "D"; seq: number; amount: number }>;

export type CalcResult = Readonly<{
  monthDays: number; paidDays: number; lines: readonly CalcLine[];
  gross: number; pfEmp: number; esiEmp: number; pt: number; otherDed: number; totalDed: number; net: number; pfEr: number; esiEr: number;
}>;

export const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Days in the month the pay is divided by: the calendar's, or the company's fixed number. */
export function monthDaysOf(setup: Pick<CalcSetup, "daysBasis" | "fixedDays">, calendarDays: number) {
  return setup.daysBasis === "FIX" ? setup.fixedDays : calendarDays;
}

export function calculateSalary(input: CalcInput): CalcResult {
  const { setup, structure } = input;
  const monthDays = monthDaysOf(setup, input.calendarDays);
  const paidDays = Math.max(0, input.paidDays);
  const factor = input.payBasis === "D" ? paidDays : Math.min(1, monthDays > 0 ? paidDays / monthDays : 0);
  const ordered = [...structure].sort((a, b) => a.seq - b.seq || a.componentId - b.componentId);

  // Fixed amounts first: BASIC has to be known for the % of BASIC heads.
  const basicRow = ordered.find((row) => row.type === "E" && row.calc === "F" && row.name === "BASIC");
  const basic = basicRow ? round2(basicRow.amount * factor) : 0;

  const lines: CalcLine[] = [];
  let gross = 0, pfBase = 0, esiBase = 0, otherDed = 0;
  for (const row of ordered) {
    const amount = round2(row.calc === "P" ? (basic * row.amount) / 100 : row.type === "E" ? row.amount * factor : row.amount);
    if (amount === 0) continue;
    lines.push({ componentId: row.componentId, name: row.name, type: row.type, seq: row.seq, amount });
    if (row.type === "E") {
      gross += amount;
      if (row.pf) pfBase += amount;
      if (row.esi) esiBase += amount;
    } else otherDed += amount;
  }
  gross = round2(gross);
  otherDed = round2(otherDed);

  const pfWage = Math.min(pfBase, setup.pfCeiling);
  const pfEmp = input.pfOn ? Math.round((pfWage * setup.pfPct) / 100) : 0;
  const pfEr = input.pfOn ? Math.round((pfWage * setup.pfEmpPct) / 100) : 0;
  const esiApplies = input.esiOn && esiBase > 0 && esiBase <= setup.esiCeiling;
  const esiEmp = esiApplies ? Math.ceil((esiBase * setup.esiPct) / 100) : 0;
  const esiEr = esiApplies ? Math.ceil((esiBase * setup.esiEmpPct) / 100) : 0;
  const pt = input.ptOn && gross > 0 && gross >= setup.ptFromGross ? round2(setup.ptAmount) : 0;

  const statutory: CalcLine[] = [];
  if (pfEmp > 0) statutory.push({ componentId: null, name: "PF", type: "D", seq: 900, amount: pfEmp });
  if (esiEmp > 0) statutory.push({ componentId: null, name: "ESI", type: "D", seq: 901, amount: esiEmp });
  if (pt > 0) statutory.push({ componentId: null, name: "PROF TAX", type: "D", seq: 902, amount: pt });

  const totalDed = round2(otherDed + pfEmp + esiEmp + pt);
  return { monthDays, paidDays, lines: [...lines, ...statutory], gross, pfEmp, esiEmp, pt, otherDed, totalDed, net: round2(gross - totalDed), pfEr, esiEr };
}

/** The days a staff member is paid for a period when no attendance was entered: the whole month, or from joining / to exit inside it. */
export function defaultPaidDays(from: string, to: string, join: string | null, exit: string | null, setup: Pick<CalcSetup, "daysBasis" | "fixedDays">): number {
  const start = join && join > from ? join : from;
  const end = exit && exit < to ? exit : to;
  const day = (text: string) => Date.UTC(+text.slice(0, 4), +text.slice(5, 7) - 1, +text.slice(8, 10)) / 86400000;
  const present = Math.max(0, day(end) - day(start) + 1);
  const calendar = day(to) - day(from) + 1;
  // A full month is paid as the month's days (fixed days included); a part month is the calendar days it covers, never above the month's days.
  return present >= calendar ? monthDaysOf(setup, calendar) : Math.min(present, monthDaysOf(setup, calendar));
}

/** The instalment to take from a salary: the loan's EMI, never more than what is still owed (0 once repaid). */
export function emiDue(principal: number, deductedBefore: number, emi: number): number {
  return Math.max(0, Math.min(round2(emi), round2(principal - deductedBefore)));
}
