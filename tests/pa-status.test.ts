import { describe, expect, it } from "vitest";
import {
  formatDuration,
  IN_FLIGHT_STATUSES,
  PA_STATUS_LABEL,
  paLiveState,
  type PaTimingRow,
} from "@/lib/pa/status";

const received = new Date("2026-01-01T08:00:00Z");
const row = (over: Partial<PaTimingRow> = {}): PaTimingRow => ({
  receivedAt: received,
  decisionDueAt: new Date("2026-01-04T08:00:00Z"),
  decidedAt: null,
  prescriberStatementAt: null,
  determination: null,
  ...over,
});

describe("paLiveState", () => {
  it("keeps a request received in the future out of the queue", () => {
    expect(
      paLiveState(row(), new Date("2026-01-01T07:59:00Z")),
    ).toEqual({
      status: "NotYetReceived",
      inFlight: false,
      msToDue: 259_260_000,
      ageMs: 0,
      breached: false,
    });
  });

  it("maps past decisions to Approved or Denied and records a breach", () => {
    const approved = paLiveState(
      row({ decidedAt: new Date("2026-01-02T08:00:00Z"), determination: "Approved" }),
      new Date("2026-01-03T08:00:00Z"),
    );
    const denied = paLiveState(
      row({
        decisionDueAt: new Date("2026-01-02T08:00:00Z"),
        decidedAt: new Date("2026-01-03T08:00:01Z"),
        determination: "Denied",
      }),
      new Date("2026-01-04T08:00:00Z"),
    );

    expect(approved.status).toBe("Approved");
    expect(approved.inFlight).toBe(false);
    expect(approved.breached).toBe(false);
    expect(denied.status).toBe("Denied");
    expect(denied.ageMs).toBe(172_801_000);
    expect(denied.msToDue).toBe(-86_401_000);
    expect(denied.breached).toBe(true);
  });

  it("treats a decision dated in the future as an open request", () => {
    const state = paLiveState(
      row({ decidedAt: new Date("2026-01-01T12:00:00Z") }),
      new Date("2026-01-01T11:00:00Z"),
    );

    expect(state.status).toBe("InReview");
    expect(state.inFlight).toBe(true);
    expect(state.ageMs).toBe(10_800_000);
  });

  it("changes from Received to InReview at the exact two-hour boundary", () => {
    expect(
      paLiveState(row(), new Date("2026-01-01T09:59:59Z")).status,
    ).toBe("Received");
    expect(
      paLiveState(row(), new Date("2026-01-01T10:00:00Z")).status,
    ).toBe("InReview");
  });

  it("reports pending information only after the prescriber statement arrives", () => {
    expect(
      paLiveState(
        row({ prescriberStatementAt: new Date("2026-01-01T09:00:00Z") }),
        new Date("2026-01-01T09:00:00Z"),
      ).status,
    ).toBe("PendingInfo");
    expect(
      paLiveState(
        row({ prescriberStatementAt: new Date("2026-01-01T12:00:00Z") }),
        new Date("2026-01-01T11:00:00Z"),
      ).status,
    ).toBe("InReview");
  });

  it("leaves the due time null when no deadline was stored", () => {
    expect(
      paLiveState(row({ decisionDueAt: null }), new Date("2026-01-01T09:00:00Z")),
    ).toMatchObject({ msToDue: null, status: "Received", breached: false });
  });
});

describe("prior authorization status labels", () => {
  it("labels every status and identifies only open statuses", () => {
    expect(PA_STATUS_LABEL).toEqual({
      NotYetReceived: "Not yet received",
      Received: "Received",
      PendingInfo: "Pended for information",
      InReview: "In review",
      Approved: "Approved",
      Denied: "Denied",
    });
    expect(IN_FLIGHT_STATUSES).toEqual(["Received", "PendingInfo", "InReview"]);
  });
});

describe("formatDuration", () => {
  it("formats days, hours, minutes, and negative durations", () => {
    expect(formatDuration(2 * 86_400_000 + 3 * 3_600_000)).toBe("2d 3h");
    expect(formatDuration(4 * 3_600_000 + 20 * 60_000)).toBe("4h 20m");
    expect(formatDuration(18 * 60_000)).toBe("18m");
    expect(formatDuration(-90 * 60_000)).toBe("1h 30m");
  });
});
