/** Read-only interpretation of recorded work; never implies a live assignment. */
export const WORK_STATUSES = ["Unresolved", "All", "Awaiting review", "Awaiting action", "Applied", "Rejected", "Withdrawn", "Status unavailable", "Completed", "Escalated", "Refused", "Failed"] as const;
export type WorkStatus = typeof WORK_STATUSES[number];
export interface ProposalRecord { status: string; createdAt: Date; reviewedAt: Date | null; appliedAt: Date | null }
export function proposalStatus(p: ProposalRecord, at: Date): string {
  if (p.createdAt > at || (p.reviewedAt && p.reviewedAt > at) || (p.appliedAt && p.appliedAt > at)) return "Status unavailable";
  if (p.status === "Proposed" && !p.reviewedAt && !p.appliedAt) return "Awaiting review";
  if (p.status === "Approved" && p.reviewedAt && !p.appliedAt) return "Awaiting action";
  if (p.status === "Applied" && p.appliedAt) return "Applied";
  if (["Rejected", "Withdrawn"].includes(p.status) && p.reviewedAt && !p.appliedAt) return p.status;
  return "Status unavailable";
}
/** Same conservative interpretation for server-side counts, filtering and pagination. */
export const PROPOSAL_STATUS_SQL = `CASE
 WHEN p."reviewedAt" > ($1::timestamptz AT TIME ZONE 'UTC') OR p."appliedAt" > ($1::timestamptz AT TIME ZONE 'UTC') THEN 'Status unavailable'
 WHEN p.status = 'Proposed' AND p."reviewedAt" IS NULL AND p."appliedAt" IS NULL THEN 'Awaiting review'
 WHEN p.status = 'Approved' AND p."reviewedAt" IS NOT NULL AND p."appliedAt" IS NULL THEN 'Awaiting action'
 WHEN p.status = 'Applied' AND p."appliedAt" IS NOT NULL THEN 'Applied'
 WHEN p.status IN ('Rejected','Withdrawn') AND p."reviewedAt" IS NOT NULL AND p."appliedAt" IS NULL THEN p.status
 ELSE 'Status unavailable' END`;
export function nextStep(status: string) {
  switch(status) {
    case "Awaiting review": return "Review the recommendation and supporting evidence.";
    case "Awaiting action": return "Confirm the approved action in the work queue; application is not recorded.";
    case "Failed": return "Inspect the failure and follow up in the work queue.";
    case "Escalated": return "Review the escalation; employee follow-through is not recorded here.";
    case "Refused": return "Review the reason the agent declined to act.";
    case "Status unavailable": return "Check the source record; history is insufficient at this cutoff.";
    case "Applied": return "Application recorded. Confirm the outcome in the source workflow.";
    case "Rejected": return "Review the recorded employee decision.";
    case "Withdrawn": return "Review the withdrawal in the source workflow.";
    default: return "Run completed. This does not confirm completion of proposed actions.";
  }
}
export const QUEUES: Record<string, { href: string; label: string; handoff: string }> = {
  "rebate-protection": { href: "/rebate-protection", label: "Rebate protection", handoff: "Finance reviews contract interpretation, payment corrections and benefit changes in an isolated sandbox. No operational work is assigned." },
  "account-management": { href: "/account-management", label: "Benefit goals", handoff: "The benefits lead approves measured options before activation and follows rollout tasks." },
  "pa-intake": { href: "/pa/review", label: "Clinical review", handoff: "A pharmacist reviews unsupported answers and proposed denials." },
  "plan-design": { href: "/changes", label: "Benefit changes", handoff: "The account team reviews options; the sponsor decides on benefit changes." },
  "integrity-triage": { href: "/integrity", label: "Integrity cases", handoff: "A pharmacist reviews case evidence before referrals or member restrictions." },
  "eligibility-resolver": { href: "/eligibility", label: "Eligibility", handoff: "Eligibility staff review corrections and any termination of coverage." },
  "appeal-drafter": { href: "/mac", label: "MAC appeals", handoff: "A contracting pharmacist signs responses and reviews pricing changes." },
  "member-service": { href: "/assistant", label: "Member service", handoff: "Member services handles questions the agent cannot answer." },
  "data-agent": { href: "/data-agent", label: "Reporting", handoff: "Benefits and finance staff review briefings and unresolved data questions." },
};
export function workDestination(agentId: string, type?: string | null, id?: string | null) {
  if (type === "BenefitRelease") return { href: "/account-management", label: "Open rollout" };
  if (type === "PriorAuthorization" && id) return { href: `/pa/${encodeURIComponent(id)}`, label: "Open request" };
  return { href: QUEUES[agentId]?.href ?? "/agents", label: "Open work queue" };
}
export function parseWorkFilters(params: Record<string, string | string[] | undefined>) {
  const value = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
  const status = WORK_STATUSES.includes(value("status") as WorkStatus) ? value("status") : "Unresolved";
  const page = Math.max(1, Math.min(1000000, Math.floor(Number(value("page"))) || 1));
  return { q: value("q").trim().slice(0, 200), agent: value("agent"), team: value("team"), status, page };
}
export type WorkFilters = ReturnType<typeof parseWorkFilters>;
