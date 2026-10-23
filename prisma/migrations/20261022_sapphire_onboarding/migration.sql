CREATE TABLE IF NOT EXISTS "SapphireOnboarding" (
 "id" TEXT PRIMARY KEY, "employerKey" TEXT NOT NULL, "sponsorId" TEXT NOT NULL, "contractId" TEXT NOT NULL,
 "name" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'Draft', "revision" INTEGER NOT NULL DEFAULT 0,
 "data" TEXT NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "SapphireOnboarding_scope" ON "SapphireOnboarding" ("sponsorId","contractId","createdAt");
CREATE TABLE IF NOT EXISTS "SapphireOnboardingEvent" (
 "id" TEXT PRIMARY KEY, "onboardingId" TEXT NOT NULL, "requestKey" TEXT NOT NULL UNIQUE,
 "inputHash" TEXT NOT NULL, "actor" TEXT NOT NULL, "kind" TEXT NOT NULL, "revision" INTEGER NOT NULL,
 "data" TEXT NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "SapphireOnboardingEvent_history" ON "SapphireOnboardingEvent" ("onboardingId","createdAt");
