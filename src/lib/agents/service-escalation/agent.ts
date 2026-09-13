import {
  getServiceEscalationSource,
  type ServiceEscalationSource,
} from "@/lib/queries/agent-work";
import { startRun, type Run } from "../runtime";

export interface ServiceEscalationResult {
  runId: string;
  sourceType: ServiceEscalationSource["sourceType"];
  sourceId: string;
  proposed: boolean;
}

export async function runServiceEscalationTriage(opts: {
  sourceType: ServiceEscalationSource["sourceType"];
  sourceId: string;
  at?: Date;
  persist?: boolean;
}): Promise<{ run: Run; result: ServiceEscalationResult }> {
  const at = opts.at ?? new Date();
  const run = await startRun({
    agentId: "service-escalation-triage",
    goal: `Turn unresolved ${opts.sourceType} ${opts.sourceId} into one owned service case.`,
    subject: { type: opts.sourceType, id: opts.sourceId },
    at,
  });

  const source = await run.tool(
    "getEscalationSource",
    "Use the unresolved source record and the shared case index together so one underlying problem produces one case.",
    () => getServiceEscalationSource(opts.sourceType, opts.sourceId, at),
    (value) =>
      value
        ? `${value.title} routes to ${value.queue} at ${value.priority} priority.`
        : "The source is resolved, already represented by a case or proposal, or no longer exists.",
  );

  let proposed = false;
  if (!source) {
    run.refuse(
      "No new unified service case is needed.",
      "The source query excludes resolved work and source keys already represented by ServiceCase or the governed proposal queue.",
    );
  } else {
    run.evidence(
      `${source.title} remains unresolved`,
      "Priority, queue, SLA, and summary are derived from the authoritative PA, eligibility, or agent run record.",
      {
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        occurredAt: source.occurredAt,
        slaDueAt: source.slaDueAt,
        priority: source.priority,
        queue: source.queue,
        sourceEvidence: source.evidence,
      },
    );
    run.propose({
      subjectType: source.sourceType,
      subjectId: source.sourceId,
      action: "open-service-case",
      headline: source.title,
      rationale: source.summary,
      payload: {
        title: source.title,
        summary: source.summary,
        priority: source.priority,
        queue: source.queue,
        ...(source.slaDueAt
          ? { slaDueAt: source.slaDueAt.toISOString() }
          : {}),
      },
      confidence: 1,
    });
    proposed = true;
  }

  const result: ServiceEscalationResult = {
    runId: run.id,
    sourceType: opts.sourceType,
    sourceId: opts.sourceId,
    proposed,
  };
  if (opts.persist !== false) {
    await run.finish(
      "Completed",
      proposed
        ? `${source?.title} entered the unified service queue.`
        : "No duplicate service case was opened.",
    );
  }
  return { run, result };
}
