/**
 * The weekend and holiday emergency supply.
 *
 * A published Navitus rule, and one of the few places in a pharmacy benefit
 * where the plan concedes that its own utilisation management can fail the
 * member through no fault of theirs. A drug needs prior authorization, the
 * prescriber's office is shut, and the member is standing at a counter on a
 * Saturday. The rule lets the pharmacy dispense up to a five-day supply and bill
 * it at no member cost share, so the authorization can be worked on the next
 * business day instead of the member going without.
 *
 * Two design decisions are worth stating because they change the behaviour.
 *
 * The pharmacy has to ask. This does not fire automatically whenever a
 * short-days-supply claim lands on a weekend, because dispensing an emergency
 * supply is a pharmacist's clinical decision, and NCPDP already has the field
 * for it — 418-DK Level of Service, value 3, Emergency. Inferring it would also
 * silently reprice historical claims that were never submitted that way.
 *
 * The window is about whether a prescriber can be reached, so it follows the
 * observed federal holiday rather than the calendar date. When Christmas falls
 * on a Sunday the offices are shut on the Monday, and that Monday is the day a
 * member cannot get an authorization moved.
 */

export type ClosureReason =
  | "saturday"
  | "sunday"
  | "federal-holiday"
  | "observed-holiday";

export interface EmergencySupplyRule {
  maxDaysSupply: number;
  authority: string;
  citation: string;
}

export const EMERGENCY_SUPPLY: EmergencySupplyRule = {
  maxDaysSupply: 5,
  authority: "Navitus prior authorization process",
  citation:
    "Navitus published prior authorization process: where a prior authorization is required and the prescriber cannot be reached on a weekend or holiday, the pharmacy may dispense up to a five-day emergency supply at no cost to the member.",
};

/** NCPDP 418-DK Level of Service, value 3. */
export const LEVEL_OF_SERVICE_EMERGENCY = "3";

// ---------------------------------------------------------------------------
// Federal holidays, computed rather than tabulated
// ---------------------------------------------------------------------------

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

/** The nth given weekday of a month, e.g. the third Monday of January. */
function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = utc(year, month, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return utc(year, month, 1 + offset + (n - 1) * 7);
}

/** The last given weekday of a month, e.g. the last Monday of May. */
function lastWeekday(year: number, month: number, weekday: number): Date {
  const last = utc(year, month + 1, 0);
  const back = (last.getUTCDay() - weekday + 7) % 7;
  return utc(year, month, last.getUTCDate() - back);
}

interface Holiday {
  date: Date;
  name: string;
  fixed: boolean;
}

function holidaysIn(year: number): Holiday[] {
  return [
    { date: utc(year, 0, 1), name: "New Year's Day", fixed: true },
    { date: nthWeekday(year, 0, 1, 3), name: "Birthday of Martin Luther King, Jr.", fixed: false },
    { date: nthWeekday(year, 1, 1, 3), name: "Washington's Birthday", fixed: false },
    { date: lastWeekday(year, 4, 1), name: "Memorial Day", fixed: false },
    { date: utc(year, 5, 19), name: "Juneteenth National Independence Day", fixed: true },
    { date: utc(year, 6, 4), name: "Independence Day", fixed: true },
    { date: nthWeekday(year, 8, 1, 1), name: "Labor Day", fixed: false },
    { date: nthWeekday(year, 9, 1, 2), name: "Columbus Day", fixed: false },
    { date: utc(year, 10, 11), name: "Veterans Day", fixed: true },
    { date: nthWeekday(year, 10, 4, 4), name: "Thanksgiving Day", fixed: false },
    { date: utc(year, 11, 25), name: "Christmas Day", fixed: true },
  ];
}

/**
 * The day a fixed-date holiday is observed.
 *
 * Saturday moves back to Friday and Sunday forward to Monday, which is the day
 * that actually matters here: it is when the prescriber's office is closed.
 */
function observed(date: Date): Date {
  const dow = date.getUTCDay();
  if (dow === 6) return new Date(date.getTime() - 86_400_000);
  if (dow === 0) return new Date(date.getTime() + 86_400_000);
  return date;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export interface HolidayMatch {
  name: string;
  reason: Extract<ClosureReason, "federal-holiday" | "observed-holiday">;
}

export function federalHoliday(date: Date): HolidayMatch | null {
  // A holiday observed in an adjacent year can land in this one — 1 January
  // observed on 31 December — so both are considered.
  const year = date.getUTCFullYear();
  for (const y of [year - 1, year, year + 1]) {
    for (const holiday of holidaysIn(y)) {
      if (sameDay(holiday.date, date)) {
        return { name: holiday.name, reason: "federal-holiday" };
      }
      if (holiday.fixed && sameDay(observed(holiday.date), date)) {
        return { name: `${holiday.name} (observed)`, reason: "observed-holiday" };
      }
    }
  }
  return null;
}

/** Why a prescriber cannot be reached on this date, if they cannot. */
export function closureOn(
  date: Date,
): { reason: ClosureReason; label: string } | null {
  const holiday = federalHoliday(date);
  if (holiday) return { reason: holiday.reason, label: holiday.name };

  const dow = date.getUTCDay();
  if (dow === 6) return { reason: "saturday", label: "Saturday" };
  if (dow === 0) return { reason: "sunday", label: "Sunday" };
  return null;
}

export function isBusinessDay(date: Date): boolean {
  return closureOn(date) === null;
}

/** The next day a prior authorization can actually be worked. */
export function nextBusinessDay(from: Date): Date {
  let cursor = new Date(from.getTime() + 86_400_000);
  for (let guard = 0; guard < 14; guard++) {
    if (isBusinessDay(cursor)) return cursor;
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return cursor;
}

// ---------------------------------------------------------------------------

export interface EmergencySupplyRequest {
  dateOfService: Date;
  daysSupply: number;
  /** NCPDP 418-DK. The pharmacy must signal an emergency fill. */
  levelOfService?: string;
}

export interface EmergencySupplyDecision {
  /** Whether this fill may bypass the authorization at no member cost. */
  eligible: boolean;
  requested: boolean;
  closure: { reason: ClosureReason; label: string } | null;
  maxDaysSupply: number;
  /** Why, in words, for the trace and the reject message. */
  detail: string;
  workableOn: Date | null;
}

export function emergencySupplyEligibility(
  request: EmergencySupplyRequest,
): EmergencySupplyDecision {
  const requested = request.levelOfService === LEVEL_OF_SERVICE_EMERGENCY;
  const closure = closureOn(request.dateOfService);
  const withinDays = request.daysSupply <= EMERGENCY_SUPPLY.maxDaysSupply;

  const eligible = requested && closure !== null && withinDays;

  const detail = (() => {
    if (!requested) {
      return "The pharmacy did not submit this as an emergency fill (NCPDP 418-DK level of service 3), so the authorization requirement stands.";
    }
    if (!closure) {
      return "The fill date is a business day, when the prescriber's office can be reached to obtain the authorization, so the emergency supply does not apply.";
    }
    if (!withinDays) {
      return `An emergency supply is limited to ${EMERGENCY_SUPPLY.maxDaysSupply} days and this claim is for ${request.daysSupply}.`;
    }
    return `Dispensed on a ${closure.label}, when the prescriber cannot be reached. Up to ${EMERGENCY_SUPPLY.maxDaysSupply} days is payable at no member cost share, and the authorization is worked on the next business day.`;
  })();

  return {
    eligible,
    requested,
    closure,
    maxDaysSupply: EMERGENCY_SUPPLY.maxDaysSupply,
    detail,
    workableOn: eligible ? nextBusinessDay(request.dateOfService) : null,
  };
}
