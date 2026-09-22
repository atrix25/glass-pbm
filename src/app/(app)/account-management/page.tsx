import { prisma } from "@/lib/db";
import { latestRelease } from "@/lib/benefit-release";
import { getRole, getSessionUser, getClock } from "@/lib/session";
import { demoFeaturesEnabled } from "@/lib/config";
import { AccountManagement } from "@/components/account-management";
import type { Analysis } from "@/lib/agents/account-management/service";
export const dynamic = "force-dynamic";
export default async function Page() {
  const clock = await getClock();
  const job = await prisma.job.findFirst({
    where: { type: "account_management" },
    orderBy: { createdAt: "desc" },
  });
  const release = await latestRelease();
  const user = await getSessionUser();
  const role = await getRole();
  const canWrite =
    Boolean(user && ["admin", "ops", "plan_sponsor"].includes(user.role)) ||
    (demoFeaturesEnabled() && ["admin", "sponsor"].includes(role));
  const tasks = release
    ? await prisma.agentProposal.findMany({
        where: {
          subjectType: "BenefitRelease",
          subjectId: release.id,
          action: "review-benefit-release",
        },
        select: { id: true, agentId: true, status: true, reviewedBy: true },
      })
    : [];
  return (
    <AccountManagement
      canWrite={canWrite}
      job={
        job
          ? {
              id: job.id,
              status: job.status,
              progress: job.progress,
              error: job.error,
            }
          : null
      }
      analysis={
        job?.status === "succeeded" && job.result
          ? (JSON.parse(job.result) as Analysis)
          : null
      }
      release={
        release
          ? {
              id: release.id,
              effectiveAt: release.effectiveAt,
              actor: release.actor,
              proposalId: release.proposalId,
              scheduled: Date.parse(release.effectiveAt) > clock.now.getTime(),
            }
          : null
      }
      tasks={tasks}
    />
  );
}
