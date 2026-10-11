-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "leaseOwner" TEXT,
ADD COLUMN     "leaseUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "GemmaMonitor" (
    "id" TEXT NOT NULL,
    "sponsorId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "heartbeatAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "cutoff" TIMESTAMP(3),
    "cursor" TEXT NOT NULL DEFAULT '',
    "generatorCursor" TEXT NOT NULL DEFAULT '',
    "scanned" INTEGER NOT NULL DEFAULT 0,
    "population" INTEGER NOT NULL DEFAULT 0,
    "claims" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GemmaMonitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GemmaSignal" (
    "id" TEXT NOT NULL,
    "sponsorId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "provenance" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'Pending',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "workflowId" TEXT,
    "evidenceAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GemmaSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GemmaWorkflow" (
    "id" TEXT NOT NULL,
    "sponsorId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Detected',
    "team" TEXT NOT NULL,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "data" TEXT NOT NULL DEFAULT '{}',
    "proposalHash" TEXT,
    "savingsJobId" TEXT,
    "evidenceAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GemmaWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GemmaSubject" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "memberName" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "caseId" TEXT,
    "evidenceAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GemmaSubject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GemmaActivity" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "runId" TEXT,
    "parentRunId" TEXT,
    "dependsOn" TEXT,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "evidenceAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GemmaActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GemmaCommunication" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Prepared',
    "simulationOutcome" TEXT NOT NULL,
    "preparedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "GemmaCommunication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GemmaPolicy" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "sponsorId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Approved',
    "approvedBy" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "effectiveAt" TIMESTAMP(3),
    "validation" TEXT NOT NULL DEFAULT '{}',

    CONSTRAINT "GemmaPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GemmaDecision" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "proposalHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GemmaDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GemmaMonitor_sponsorId_contractId_key" ON "GemmaMonitor"("sponsorId", "contractId");

-- CreateIndex
CREATE UNIQUE INDEX "GemmaSignal_sourceKey_key" ON "GemmaSignal"("sourceKey");

-- CreateIndex
CREATE INDEX "GemmaSignal_sponsorId_contractId_state_createdAt_idx" ON "GemmaSignal"("sponsorId", "contractId", "state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GemmaWorkflow_sourceKey_key" ON "GemmaWorkflow"("sourceKey");

-- CreateIndex
CREATE INDEX "GemmaWorkflow_sponsorId_contractId_status_updatedAt_idx" ON "GemmaWorkflow"("sponsorId", "contractId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "GemmaSubject_memberId_workflowId_idx" ON "GemmaSubject"("memberId", "workflowId");

-- CreateIndex
CREATE INDEX "GemmaSubject_caseId_idx" ON "GemmaSubject"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "GemmaSubject_workflowId_memberId_key" ON "GemmaSubject"("workflowId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "GemmaActivity_key_key" ON "GemmaActivity"("key");

-- CreateIndex
CREATE INDEX "GemmaActivity_workflowId_evidenceAt_createdAt_idx" ON "GemmaActivity"("workflowId", "evidenceAt", "createdAt");

-- CreateIndex
CREATE INDEX "GemmaCommunication_status_preparedAt_idx" ON "GemmaCommunication"("status", "preparedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GemmaCommunication_workflowId_memberId_template_key" ON "GemmaCommunication"("workflowId", "memberId", "template");

-- CreateIndex
CREATE INDEX "GemmaPolicy_sponsorId_contractId_kind_target_effectiveAt_idx" ON "GemmaPolicy"("sponsorId", "contractId", "kind", "target", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "GemmaPolicy_workflowId_contentHash_key" ON "GemmaPolicy"("workflowId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "GemmaDecision_workflowId_requestId_key" ON "GemmaDecision"("workflowId", "requestId");

-- AddForeignKey
ALTER TABLE "GemmaSubject" ADD CONSTRAINT "GemmaSubject_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "GemmaWorkflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GemmaActivity" ADD CONSTRAINT "GemmaActivity_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "GemmaWorkflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GemmaCommunication" ADD CONSTRAINT "GemmaCommunication_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "GemmaWorkflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GemmaPolicy" ADD CONSTRAINT "GemmaPolicy_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "GemmaWorkflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GemmaDecision" ADD CONSTRAINT "GemmaDecision_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "GemmaWorkflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

