CREATE TABLE "SapphirePlanStudy" ("id" TEXT PRIMARY KEY,"sponsorId" TEXT NOT NULL,"contractId" TEXT NOT NULL,"revision" INTEGER NOT NULL DEFAULT 0,"data" TEXT NOT NULL,"createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "SapphirePlanStudy_scope" ON "SapphirePlanStudy" ("sponsorId","contractId","createdAt");
CREATE TABLE "SapphirePlanStudyEvent" ("id" TEXT PRIMARY KEY,"studyId" TEXT NOT NULL,"requestKey" TEXT NOT NULL UNIQUE,"inputHash" TEXT NOT NULL,"actor" TEXT NOT NULL,"kind" TEXT NOT NULL,"revision" INTEGER NOT NULL,"data" TEXT NOT NULL,"createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "SapphirePlanStudyEvent_history" ON "SapphirePlanStudyEvent" ("studyId","createdAt");
