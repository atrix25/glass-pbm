CREATE TABLE "BenefitChange" ("id" TEXT PRIMARY KEY,"sponsorId" TEXT NOT NULL,"contractId" TEXT NOT NULL,"title" TEXT NOT NULL,"status" TEXT NOT NULL DEFAULT 'Draft',"revision" INTEGER NOT NULL DEFAULT 0,"data" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "BenefitChange_scope_updated" ON "BenefitChange" ("sponsorId","contractId","updatedAt");
CREATE TABLE "BenefitChangeEvent" ("id" TEXT PRIMARY KEY,"changeId" TEXT NOT NULL,"requestKey" TEXT UNIQUE NOT NULL,"revision" INTEGER NOT NULL,"kind" TEXT NOT NULL,"actor" TEXT NOT NULL,"data" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "BenefitChangeEvent_change_created" ON "BenefitChangeEvent" ("changeId","createdAt");
CREATE TABLE "BenefitDeployment" ("id" TEXT PRIMARY KEY,"sponsorId" TEXT NOT NULL,"contractId" TEXT NOT NULL,"revision" INTEGER NOT NULL DEFAULT 0,"changeId" TEXT,"versionId" TEXT,"payload" TEXT NOT NULL DEFAULT '{}',"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "BenefitDeployment_scope" ON "BenefitDeployment" ("sponsorId","contractId");
CREATE TABLE IF NOT EXISTS "BenefitChangeSource" ("id" TEXT PRIMARY KEY,"sponsorId" TEXT NOT NULL,"contractId" TEXT NOT NULL,"data" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS "BenefitSourceRevision" ("id" TEXT PRIMARY KEY,"revision" INTEGER NOT NULL DEFAULT 0);
INSERT INTO "BenefitSourceRevision" ("id","revision") VALUES ('reference',0) ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION glass_benefit_source_changed() RETURNS trigger AS $$
BEGIN UPDATE "BenefitSourceRevision" SET "revision"="revision"+1 WHERE "id"='reference'; RETURN NULL; END;
$$ LANGUAGE plpgsql;
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['BenefitPlan','CostShareRule','Contract','ContractRate','FormularyEntry','Drug','DrugPrice','EligibilitySpan','Pharmacy','NetworkPharmacy','PriorAuthorization','Member','Claim'] LOOP
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='glass_benefit_revision_'||t) THEN
 EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION glass_benefit_source_changed()', 'glass_benefit_revision_'||t,t);
 END IF;
 END LOOP;
END $$;
