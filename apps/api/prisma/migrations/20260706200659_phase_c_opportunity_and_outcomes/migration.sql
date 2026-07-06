-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "resumeVersionId" TEXT,
ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "job_matches" ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "opportunityScore" DOUBLE PRECISION,
ADD COLUMN     "scoreBreakdown" JSONB;
