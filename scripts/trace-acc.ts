import { prisma } from "@/lib/db";

async function main() {
  const c = await prisma.claim.findFirst({
    where: { claimNumber: "CLM000003489" },
    select: {
      claimNumber: true,
      formularyLevel: true,
      channel: true,
      patientPayCents: true,
      totalBilledCents: true,
      traceJson: true,
    },
  });
  if (!c) throw new Error("not found");
  console.log(c.claimNumber, "L" + c.formularyLevel, c.channel, "pay=" + c.patientPayCents, "billed=" + c.totalBilledCents);
  const trace = JSON.parse(c.traceJson ?? "[]") as {
    ruleId: string;
    stage: string;
    inputs?: unknown;
    output?: unknown;
    detail?: string;
  }[];
  for (const t of trace) {
    if (t.stage !== "costshare") continue;
    console.log("\n--", t.ruleId);
    console.log("   in :", JSON.stringify(t.inputs));
    console.log("   out:", JSON.stringify(t.output));
    console.log("   why:", t.detail);
  }
}

main();
