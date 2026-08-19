import { describe, expect, it } from "vitest";
import {
  CHANNEL_LABEL,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  LEVEL_META,
  levelMeta,
} from "@/lib/utils";

describe("format utilities", () => {
  it("formats UTC dates and date-times independently of local timezone", () => {
    const date = new Date("2026-01-02T15:04:00Z");

    expect(formatDate(date)).toBe("Jan 2, 2026");
    expect(formatDate("2026-01-02T15:04:00Z")).toBe("Jan 2, 2026");
    expect(formatDateTime(date)).toBe("Jan 2, 3:04 PM");
    expect(formatDateTime("2026-01-02T15:04:00Z")).toBe("Jan 2, 3:04 PM");
  });

  it("formats numbers and percentages with requested precision", () => {
    expect(formatNumber(1234567.8)).toBe("1,234,568");
    expect(formatNumber(1234.5, 2)).toBe("1,234.50");
    expect(formatPercent(0.1267)).toBe("12.7%");
    expect(formatPercent(0.1267, 2)).toBe("12.67%");
  });
});

describe("level and channel labels", () => {
  it("returns each defined level and falls back for null and unknown levels", () => {
    expect(levelMeta("1")).toBe(LEVEL_META["1"]);
    expect(levelMeta("$0")).toBe(LEVEL_META.$0);
    expect(levelMeta("NC")).toBe(LEVEL_META.NC);
    expect(levelMeta(null)).toBe(LEVEL_META.NC);
    expect(levelMeta(undefined)).toBe(LEVEL_META.NC);
    expect(levelMeta("9")).toEqual({
      label: "Level 9",
      short: "9",
      className: "bg-ink-100 text-ink-700 ring-ink-400/25",
    });
  });

  it("exposes the known channel labels and leaves unknown keys absent", () => {
    expect(CHANNEL_LABEL).toEqual({
      Retail: "Retail",
      Retail90: "Retail 90",
      Mail: "Mail order",
      Specialty: "Specialty",
    });
    expect(CHANNEL_LABEL.Unknown).toBeUndefined();
  });
});
