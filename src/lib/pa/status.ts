/**
 * What state a prior authorization is in right now.
 *
 * The stored row records when a request arrived, when the regulation says it
 * must be answered, and when it was in fact answered. It does not record a
 * status, because a status is not a fact about a request — it is a fact about
 * a request *and a moment*. The same row is in review at nine in the morning
 * and approved by lunchtime, and pinning that into a column would freeze the
 * queue into a snapshot.
 *
 * Deriving it instead is what makes the queue behave like a real one: requests
 * arrive, sit, age against their deadline, and turn into decisions while the
 * page is open.
 */

export type PaLiveStatus =
  | "NotYetReceived"
  | "Received"
  | "PendingInfo"
  | "InReview"
  | "Approved"
  | "Denied";

export interface PaTimingRow {
  receivedAt: Date;
  decisionDueAt: Date | null;
  decidedAt: Date | null;
  prescriberStatementAt: Date | null;
  determination: string | null;
}

export interface PaLiveState {
  status: PaLiveStatus;
  /** True while the request is still open at the current instant. */
  inFlight: boolean;
  /** Milliseconds until the regulatory deadline; negative once breached. */
  msToDue: number | null;
  /** How long the request has been open, or took to decide. */
  ageMs: number;
  breached: boolean;
}

export function paLiveState(row: PaTimingRow, now: Date): PaLiveState {
  const t = now.getTime();
  const received = row.receivedAt.getTime();
  const due = row.decisionDueAt?.getTime() ?? null;
  const decided = row.decidedAt?.getTime() ?? null;

  if (t < received) {
    return {
      status: "NotYetReceived",
      inFlight: false,
      msToDue: due === null ? null : due - t,
      ageMs: 0,
      breached: false,
    };
  }

  // Decided, and the decision has already happened by now.
  if (decided !== null && t >= decided) {
    return {
      status: row.determination === "Denied" ? "Denied" : "Approved",
      inFlight: false,
      msToDue: due === null ? null : due - decided,
      ageMs: decided - received,
      breached: due !== null && decided > due,
    };
  }

  /*
   * Still open. A request whose reviewer had to go back to the prescriber sits
   * in a different bucket from one simply waiting its turn, because that is
   * the distinction a plan sponsor asks about when turnaround slips: the plan
   * controls one queue and not the other.
   */
  const waitingOnPrescriber =
    row.prescriberStatementAt !== null &&
    t >= row.prescriberStatementAt.getTime();

  // The first hours after intake are clerical, not clinical.
  const INTAKE_MS = 2 * 3_600_000;
  const status: PaLiveStatus = waitingOnPrescriber
    ? "PendingInfo"
    : t - received < INTAKE_MS
      ? "Received"
      : "InReview";

  return {
    status,
    inFlight: true,
    msToDue: due === null ? null : due - t,
    ageMs: t - received,
    breached: due !== null && t > due,
  };
}

export const PA_STATUS_LABEL: Record<PaLiveStatus, string> = {
  NotYetReceived: "Not yet received",
  Received: "Received",
  PendingInfo: "Pended for information",
  InReview: "In review",
  Approved: "Approved",
  Denied: "Denied",
};

export const IN_FLIGHT_STATUSES: PaLiveStatus[] = [
  "Received",
  "PendingInfo",
  "InReview",
];

/** "4h 20m", "2d 3h", "18m" — short enough to sit in a table cell. */
export function formatDuration(ms: number): string {
  const abs = Math.abs(ms);
  const minutes = Math.floor(abs / 60_000);
  const hours = Math.floor(minutes / 60);
  const dayspan = Math.floor(hours / 24);
  if (dayspan > 0) return `${dayspan}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}
