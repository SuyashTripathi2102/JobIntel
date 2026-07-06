-- CreateEnum
CREATE TYPE "DiscoveryStage" AS ENUM ('DISCOVERED', 'WEBSITE_VERIFIED', 'CAREER_PAGE_FOUND', 'MONITORED', 'UNRESOLVABLE');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "confidenceSignals" JSONB,
ADD COLUMN     "discoverySource" TEXT,
ADD COLUMN     "discoveryStage" "DiscoveryStage" NOT NULL DEFAULT 'DISCOVERED',
ADD COLUMN     "lastProbedAt" TIMESTAMP(3),
ADD COLUMN     "teamSize" INTEGER;

-- CreateIndex
CREATE INDEX "companies_discoveryStage_lastProbedAt_idx" ON "companies"("discoveryStage", "lastProbedAt");

-- Hand-added backfill: companies already syncing jobs are MONITORED with the
-- corresponding signals; everything else starts at DISCOVERED (default).
UPDATE "companies"
SET "discoveryStage" = 'MONITORED',
    "confidence" = 90,
    "confidenceSignals" = '{"websiteVerified":true,"careerPageFound":true,"atsDetected":true,"jobsExtracted":true,"monitoringHealthy":true}'::jsonb
WHERE "atsIdentifier" IS NOT NULL AND "atsProvider" NOT IN ('UNKNOWN');

UPDATE "companies"
SET "discoverySource" = 'remoteok'
WHERE "discoverySource" IS NULL AND "careerPageUrl" IS NULL AND "atsIdentifier" IS NULL;
