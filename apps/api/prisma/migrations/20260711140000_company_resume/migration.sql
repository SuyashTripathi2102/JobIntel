-- The Resume Library: a resume tailored to one job. The master resume is
-- generated from the confirmed profile; this stores the company-specific
-- transform (HTML is the source of truth, PDF is output) with three-audience
-- scores, so CareerOS can later learn which versions convert.
CREATE TABLE "company_resumes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "atsScore" INTEGER,
    "recruiterScore" INTEGER,
    "hmScore" INTEGER,
    "changes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_resumes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_resumes_userId_jobId_key" ON "company_resumes"("userId", "jobId");
CREATE INDEX "company_resumes_userId_idx" ON "company_resumes"("userId");

ALTER TABLE "company_resumes" ADD CONSTRAINT "company_resumes_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "company_resumes" ADD CONSTRAINT "company_resumes_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
