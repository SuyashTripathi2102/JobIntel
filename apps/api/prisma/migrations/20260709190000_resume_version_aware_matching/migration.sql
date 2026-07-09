-- Resume-version-aware matching.
--
-- Before this, job_matches was unique on (userId, jobId) and scoreAndUpsert
-- overwrote the row in place. A new resume therefore destroyed the old scores
-- instead of producing new ones, and reconcileForUser's "NOT EXISTS" skipped
-- every already-matched job — so uploading a corrected resume re-scored
-- nothing. All 674 production matches trace to one resume version.

-- 1. Resume versions gain an explicit activation gate + ATS provenance.
ALTER TABLE "resume_versions" ADD COLUMN "atsVerdict" TEXT;
ALTER TABLE "resume_versions" ADD COLUMN "confirmedProfile" JSONB;
ALTER TABLE "resume_versions" ADD COLUMN "activatedAt" TIMESTAMP(3);

-- Reconciling 312 stale jobs takes ~12 minutes of paced LLM calls, so
-- activation enqueues the work and the report is persisted here.
ALTER TABLE "resume_versions" ADD COLUMN "reconciledAt" TIMESTAMP(3);
ALTER TABLE "resume_versions" ADD COLUMN "reconcileReport" JSONB;

-- A version that has already produced matches was, by definition, active: it
-- was driving recommendations before this gate existed. Activating exactly
-- those keeps production behaviour identical across the deploy. Versions that
-- never scored anything stay inactive and face the review gate.
UPDATE "resume_versions" rv
SET "activatedAt" = rv."createdAt"
WHERE rv."activatedAt" IS NULL
  AND EXISTS (SELECT 1 FROM "job_matches" m WHERE m."resumeVersionId" = rv.id);

-- 2. A job may now hold one match per resume version.
DROP INDEX "job_matches_userId_jobId_key";

CREATE UNIQUE INDEX "job_matches_userId_jobId_resumeVersionId_key"
  ON "job_matches"("userId", "jobId", "resumeVersionId");

CREATE INDEX "job_matches_userId_resumeVersionId_idx"
  ON "job_matches"("userId", "resumeVersionId");
