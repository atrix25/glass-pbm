import Link from "next/link";
import { prisma } from "@/lib/db";
import { Badge, Card, CardHeader } from "@/components/ui";

export async function AgentWorkPanel({
  subjectTypes,
  subjectId,
  title = "Agent work",
}: {
  subjectTypes: string[];
  subjectId?: string;
  title?: string;
}) {
  const proposals = await prisma.agentProposal.findMany({
    where: {
      subjectType: { in: subjectTypes },
      ...(subjectId ? { subjectId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 6,
    include: { execution: { select: { status: true } } },
  });

  return (
    <Card>
      <CardHeader
        title={title}
        description="Evidence-backed recommendations share the same review and execution path."
        action={
          <Link href="/agents" className="text-[12px] text-glass-700">
            Agent fleet →
          </Link>
        }
      />
      {proposals.length === 0 ? (
        <p className="px-5 py-4 text-[13px] text-ink-500">
          No agent proposal has reached this workflow yet.
        </p>
      ) : (
        <div className="divide-y divide-ink-100">
          {proposals.map((proposal) => (
            <Link
              key={proposal.id}
              href={`/agents/runs/${proposal.runId}`}
              className="flex items-start justify-between gap-4 px-5 py-4 transition hover:bg-ink-50"
            >
              <div>
                <div className="text-[13px] font-medium text-ink-900">
                  {proposal.headline}
                </div>
                <div className="mt-1 text-[12px] text-ink-500">
                  {proposal.agentId} · {proposal.action}
                </div>
              </div>
              <Badge
                tone={
                  proposal.status === "Applied"
                    ? "positive"
                    : proposal.status === "Rejected"
                      ? "negative"
                      : proposal.consequential
                        ? "warn"
                        : "neutral"
                }
              >
                {proposal.execution?.status ?? proposal.status}
              </Badge>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}
