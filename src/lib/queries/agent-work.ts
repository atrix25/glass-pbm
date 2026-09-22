import { prisma } from "@/lib/db";
import { AGENTS } from "@/lib/agents/registry";
import { PROPOSAL_STATUS_SQL, type WorkFilters } from "@/lib/agents/work";
import type { SimulationClock } from "@/lib/clock";

// Runs and proposals are separate work records. A run may finish with several
// unresolved proposals; neither its completion nor another proposal closes them.
const WORK_CTE = `WITH work AS (
 SELECT p.id, 'Proposal' AS kind, p."runId", p."agentId", p.headline AS task,
 p.rationale AS summary, ${PROPOSAL_STATUS_SQL} AS status, r.outcome,
 p."createdAt" AS at, p."subjectType", p."subjectId"
 FROM "AgentProposal" p JOIN "AgentRun" r ON r.id=p."runId"
 WHERE p."createdAt" <= ($1::timestamptz AT TIME ZONE 'UTC') AND r."endedAt" <= ($1::timestamptz AT TIME ZONE 'UTC')
 UNION ALL
 SELECT r.id, 'Run', r.id, r."agentId", r.goal, r.summary, r.outcome, r.outcome,
 r."endedAt", r."subjectType", r."subjectId"
 FROM "AgentRun" r WHERE r."endedAt" <= ($1::timestamptz AT TIME ZONE 'UTC')
)`;
export interface WorkRow { id: string; kind: string; runId: string; agentId: string; task: string; summary: string; status: string; outcome: string; at: Date; subjectType: string | null; subjectId: string | null }
const FILTER = ` WHERE ($2 = '' OR w."agentId" = $2)
 AND ($3 = '' OR w."agentId" = ANY($4::text[]))
 AND ($5 = 'All' OR ($5 = 'Unresolved' AND w.status IN ('Awaiting review','Awaiting action')) OR w.status = $5)
 AND ($6 = '' OR POSITION(LOWER($6) IN LOWER(CONCAT_WS(' ',w.task,w.summary,w."subjectId",w."agentId"))) > 0)`;
export async function getAgentWork(clock: SimulationClock, filters: WorkFilters) {
  const teams = AGENTS.filter(a => a.owner === filters.team).map(a => a.id);
  const args = [clock.now, filters.agent, filters.team, teams, filters.status, filters.q];
  const [count] = await prisma.$queryRawUnsafe<{ total: bigint }[]>(`${WORK_CTE} SELECT COUNT(*) AS total FROM work w ${FILTER}`, ...args);
  const total = Number(count.total);
  const pages = Math.max(1, Math.ceil(total / 25));
  const page = Math.min(filters.page, pages);
  const rows = await prisma.$queryRawUnsafe<WorkRow[]>(`${WORK_CTE} SELECT w.* FROM work w ${FILTER} ORDER BY w.at DESC, w.id ASC, w.kind ASC LIMIT 25 OFFSET $7`, ...args, (page-1)*25);
  return { rows, total, page, pages };
}
export async function getWorkOverview(clock: SimulationClock) {
  const counts = await prisma.$queryRawUnsafe<{ agentId: string; status: string; count: bigint }[]>(`${WORK_CTE} SELECT "agentId",status,COUNT(*) AS count FROM work GROUP BY "agentId",status`, clock.now);
  const latest = await prisma.$queryRawUnsafe<{agentId:string; endedAt:Date; summary:string}[]>(`SELECT DISTINCT ON ("agentId") "agentId", "endedAt", summary FROM "AgentRun" WHERE "endedAt" <= ($1::timestamptz AT TIME ZONE 'UTC') ORDER BY "agentId", "endedAt" DESC, id ASC`, clock.now);
  const policies = await prisma.agentPolicy.findMany({ where: { effectiveFrom: { lte: clock.now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: clock.now } }] }, orderBy: { effectiveFrom: "desc" } });
  const count = (status: string, agentId?: string) => counts.filter(c => c.status === status && (!agentId || c.agentId === agentId)).reduce((sum,c) => sum+Number(c.count),0);
  return { review: count("Awaiting review"), action: count("Awaiting action"), failed: count("Failed"), unavailable: count("Status unavailable"), agents: AGENTS.map(def => ({ def, review: count("Awaiting review",def.id), action: count("Awaiting action",def.id), autonomy: policies.find(p=>p.agentId===def.id)?.autonomy ?? def.autonomy, latest: latest.find(r=>r.agentId===def.id)?.endedAt ?? null, latestSummary: latest.find(r=>r.agentId===def.id)?.summary ?? null })) };
}
export async function getWorkDetail(id: string, clock: SimulationClock) {
  const run = await prisma.agentRun.findFirst({ where: { id, endedAt: { lte: clock.now } }, include: { steps: { orderBy: { ordinal: "asc" } }, proposals: { where: { createdAt: { lte: clock.now } }, orderBy: { createdAt: "asc" } } } });
  if (!run) return null;
  const def = AGENTS.find(a=>a.id===run.agentId);
  const related = run.subjectType && run.subjectId ? await prisma.agentRun.findMany({ where: { id: { not: id }, subjectType: run.subjectType, subjectId: run.subjectId, endedAt: { lte: clock.now } }, orderBy: { endedAt: "desc" }, take: 10, select: { id:true, agentId:true, summary:true, endedAt:true } }) : [];
  return { run, def, related };
}
