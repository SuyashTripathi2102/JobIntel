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

/**
 * True when the user has NOT already acted on job `j`. Every "you should apply"
 * surface — the brief, the digest, the push — must include this, or CareerOS
 * keeps recommending jobs the user already applied to (2026-07-10). SAVED is a
 * bookmark and still nudgeable; any status past it means done.
 *
 * Assumes the jobs table is aliased `j` in the surrounding query.
 */
export function notActedOnSql(userId: string): Prisma.Sql {
  return Prisma.sql`NOT EXISTS (
    SELECT 1 FROM applications a
    WHERE a."jobId" = j.id
      AND a."userId" = ${userId}
      AND a.status <> 'SAVED'
  )`;
}
