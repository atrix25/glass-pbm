export type CaseBadgeTone =
  | "neutral"
  | "positive"
  | "negative"
  | "warn"
  | "accent";

const PRIORITY_RANK: Record<string, number> = {
  Urgent: 0,
  High: 1,
  Normal: 2,
  Low: 3,
};

export function priorityRank(priority: string): number {
  return PRIORITY_RANK[priority] ?? 4;
}

export function priorityTone(priority: string): CaseBadgeTone {
  switch (priority) {
    case "Urgent":
      return "negative";
    case "High":
      return "warn";
    case "Low":
      return "neutral";
    default:
      return "accent";
  }
}

export function sourceLabel(sourceType: string): string {
  return sourceType
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}

export function sourceHref(
  sourceType: string,
  sourceId: string,
): string | null {
  switch (sourceType) {
    case "PriorAuthorization":
      return `/pa/${sourceId}`;
    case "EligibilityTransaction":
      return "/eligibility";
    case "MacAppeal":
      return "/mac";
    case "RebateInvoice":
    case "SponsorInvoice":
      return "/settlement";
    case "IntegritySignal":
      return "/integrity";
    case "PlanDesign":
      return "/trends";
    case "AgentRun":
      return `/agents/runs/${sourceId}`;
    default:
      return null;
  }
}

export function formatSla(
  dueAt: Date | null,
  now: Date,
): { label: string; overdue: boolean } {
  if (!dueAt) return { label: "No deadline", overdue: false };

  const difference = dueAt.getTime() - now.getTime();
  const overdue = difference < 0;
  const absoluteMinutes = Math.max(1, Math.round(Math.abs(difference) / 60_000));
  const duration =
    absoluteMinutes < 60
      ? `${absoluteMinutes}m`
      : absoluteMinutes < 1_440
        ? `${Math.round(absoluteMinutes / 60)}h`
        : `${Math.round(absoluteMinutes / 1_440)}d`;

  return {
    label: overdue ? `${duration} overdue` : `${duration} remaining`,
    overdue,
  };
}
