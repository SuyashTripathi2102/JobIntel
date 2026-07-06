-- CreateEnum
CREATE TYPE "HiringTrend" AS ENUM ('GROWING', 'STABLE', 'DECLINING', 'INSUFFICIENT_DATA');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AtsProvider" ADD VALUE 'WORKABLE';
ALTER TYPE "AtsProvider" ADD VALUE 'BREEZY';

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "engineeringBlogUrl" TEXT;

-- CreateTable
CREATE TABLE "company_intelligence" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "techStack" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "remoteFriendly" BOOLEAN,
    "visaMentioned" BOOLEAN,
    "hiresJuniors" BOOLEAN,
    "avgExperienceReq" DOUBLE PRECISION,
    "roleMix" JSONB,
    "salaryMinMedian" INTEGER,
    "salaryMaxMedian" INTEGER,
    "activeJobs" INTEGER NOT NULL DEFAULT 0,
    "hiringVelocity" JSONB,
    "hiringTrend" "HiringTrend" NOT NULL DEFAULT 'INSUFFICIENT_DATA',
    "derivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_intelligence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_intelligence_companyId_key" ON "company_intelligence"("companyId");

-- AddForeignKey
ALTER TABLE "company_intelligence" ADD CONSTRAINT "company_intelligence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
