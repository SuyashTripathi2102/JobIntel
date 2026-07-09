import { Prisma } from '@prisma/client';

/**
 * The active resume version for a user: newest ACTIVATED version of the primary
 * resume.
 *
 * job_matches is unique on (userId, jobId, resumeVersionId), so a user with two
 * resume versions has two rows per job. Every query that reads matches must
 * pin this version or it double-counts and can surface a score computed against
 * a resume the user has replaced.
 */
export function activeVersionSql(userId: string): Prisma.Sql {
  return Prisma.sql`(
    SELECT rv.id FROM resume_versions rv
    JOIN resumes r ON r.id = rv."resumeId"
    WHERE r."userId" = ${userId}
      AND r."isPrimary" = true
      AND rv."activatedAt" IS NOT NULL
    ORDER BY rv."versionNumber" DESC
    LIMIT 1
  )`;
}
