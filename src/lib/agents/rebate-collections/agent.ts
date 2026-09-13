import { startRun, type Run } from "../runtime";
import { getRebateInvoiceFact } from "@/lib/queries/agent-work";

export interface RebateCollectionsResult {
  runId: string;
  invoiceId: string;
  proposed: boolean;
  amountCents: number;
  basis: "overdue" | "collection-variance" | null;
}

export async function runRebateCollections(opts: {
  invoiceId: string;
  at?: Date;
  persist?: boolean;
}): Promise<{ run: Run; result: RebateCollectionsResult }> {
  const at = opts.at ?? new Date();
  const run = await startRun({
    agentId: "rebate-collections",
    goal: `Determine whether rebate invoice ${opts.invoiceId} has a documented variance that warrants a dispute.`,
    subject: { type: "RebateInvoice", id: opts.invoiceId },
    at,
  });

  const fact = await run.tool(
    "getRebateInvoiceFact",
    "A dispute must be based on the invoice schedule and cash ledger, with future-dated collections excluded.",
    () => getRebateInvoiceFact(opts.invoiceId, at),
    (value) =>
      value
        ? `${value.manufacturer} ${value.quarter}: ${value.actionableCents} cents remain actionable.`
        : "The invoice was not submitted by the run date.",
  );

  let proposed = false;
  if (!fact) {
    run.refuse(
      "No submitted invoice exists at this date.",
      "The agent cannot dispute an invoice before the manufacturer has received it.",
    );
  } else if (fact.existingOpenDispute || fact.existingProposal) {
    run.refuse(
      "The variance is already in the governed dispute workflow.",
      "Opening a second dispute for the same invoice would duplicate the receivable and the review.",
    );
  } else if (!fact.basis || fact.actionableCents <= 0) {
    run.refuse(
      "No deterministic overdue balance or collection variance warrants a dispute.",
      "The invoice is current or its invoiced amount is fully accounted for by cash and existing disputes.",
    );
  } else {
    const reason =
      fact.basis === "overdue"
        ? `${fact.manufacturer} rebate invoice ${fact.invoiceId} is ${fact.daysOverdue} days past its contractual due date with ${fact.actionableCents} cents still uncollected and undisputed.`
        : `${fact.manufacturer} collected ${fact.collectedCents} cents against ${fact.invoicedCents} invoiced cents; after ${fact.disputedCents} cents already disputed, ${fact.actionableCents} cents remain unexplained.`;

    run.evidence(
      fact.basis === "overdue"
        ? `${fact.actionableCents} cents are ${fact.daysOverdue} days overdue`
        : `${fact.actionableCents} cents remain after collection`,
      "The amount comes directly from invoiced cents less cash received by this date and amounts already disputed.",
      {
        invoiceId: fact.invoiceId,
        manufacturer: fact.manufacturer,
        quarter: fact.quarter,
        invoicedCents: fact.invoicedCents,
        collectedCents: fact.collectedCents,
        disputedCents: fact.disputedCents,
        actionableCents: fact.actionableCents,
        dueAt: fact.dueAt,
        collectedAt: fact.collectedAt,
        daysOverdue: fact.daysOverdue,
        basis: fact.basis,
      },
    );
    run.propose({
      subjectType: "RebateInvoice",
      subjectId: fact.invoiceId,
      action: "open-rebate-dispute",
      headline: `Dispute ${fact.actionableCents} cents on ${fact.manufacturer} ${fact.quarter}`,
      rationale: reason,
      payload: {
        invoiceId: fact.invoiceId,
        amountCents: fact.actionableCents,
        reason,
        evidence: {
          quarter: fact.quarter,
          invoicedCents: fact.invoicedCents,
          collectedCents: fact.collectedCents,
          disputedCents: fact.disputedCents,
          dueAt: fact.dueAt.toISOString(),
          collectedAt: fact.collectedAt?.toISOString(),
          daysOverdue: fact.daysOverdue,
          basis: fact.basis,
        },
      },
      confidence: 1,
    });
    proposed = true;
  }

  const result: RebateCollectionsResult = {
    runId: run.id,
    invoiceId: opts.invoiceId,
    proposed,
    amountCents: fact?.actionableCents ?? 0,
    basis: fact?.basis ?? null,
  };
  if (opts.persist !== false) {
    await run.finish(
      "Completed",
      proposed
        ? `A ${fact?.basis} dispute for ${fact?.actionableCents} cents is held for finance review.`
        : "No new rebate dispute was warranted.",
    );
  }
  return { run, result };
}
