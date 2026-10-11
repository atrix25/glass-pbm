-- Additive and independently rerunnable: never sync or remove legacy tables.
CREATE TABLE IF NOT EXISTS "MemberServiceCase" (
 "id" TEXT PRIMARY KEY, "sponsorId" TEXT NOT NULL, "contractId" TEXT NOT NULL,
 "memberId" TEXT NOT NULL, "memberName" TEXT NOT NULL, "title" TEXT NOT NULL,
 "kind" TEXT NOT NULL, "team" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'Open',
 "sessionId" TEXT NOT NULL UNIQUE, "sourceKey" TEXT NOT NULL UNIQUE, "context" TEXT NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 0, "evidenceAt" TIMESTAMP(3) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "MemberServiceCase_sponsorId_contractId_evidenceAt_idx" ON "MemberServiceCase" ("sponsorId", "contractId", "evidenceAt");
CREATE TABLE IF NOT EXISTS "MemberServiceEvent" (
 "id" TEXT PRIMARY KEY, "caseId" TEXT NOT NULL REFERENCES "MemberServiceCase"("id"),
 "seq" INTEGER NOT NULL, "type" TEXT NOT NULL, "status" TEXT NOT NULL, "team" TEXT NOT NULL,
 "summary" TEXT NOT NULL, "actor" TEXT NOT NULL, "simulated" BOOLEAN NOT NULL DEFAULT false,
 "payload" TEXT NOT NULL DEFAULT '{}', "evidenceAt" TIMESTAMP(3) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE ("caseId", "seq")
);
CREATE INDEX IF NOT EXISTS "MemberServiceEvent_caseId_evidenceAt_idx" ON "MemberServiceEvent" ("caseId", "evidenceAt");
CREATE TABLE IF NOT EXISTS "MemberServiceAction" (
 "id" TEXT PRIMARY KEY, "caseId" TEXT NOT NULL REFERENCES "MemberServiceCase"("id"),
 "requestId" TEXT NOT NULL, "inputHash" TEXT NOT NULL, "kind" TEXT NOT NULL, "status" TEXT NOT NULL,
 "payload" TEXT NOT NULL DEFAULT '{}', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("caseId", "requestId")
);
