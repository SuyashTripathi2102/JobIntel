import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * The two audit surfaces: what CareerOS could not decide, and what it threw
 * away. Both read the canonical stored verdict on JobMatch. Neither recomputes
 * eligibility, and neither may change a dashboard count or send a
 * notification — an audit view that alters what it audits is not an audit.
 */
@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  private async activeVersionId(userId: string): Promise<string | null> {
    const v = await this.prisma.resumeVersion.findFirst({
      where: { resume: { userId, isPrimary: true }, activatedAt: { not: null } },
      orderBy: { versionNumber: 'desc' },
      select: { id: true },
    });
    return v?.id ?? null;
  }

  /**
   * Jobs the classifier was not confident enough to accept or reject. These
   * never auto-APPLY and never trigger an instant Telegram — the whole point
   * is that a human looks. Already-reviewed jobs drop out of the queue.
   */
  async needsReview(userId: string) {
    const resumeVersionId = await this.activeVersionId(userId);
    if (!resumeVersionId) return { jobs: [], reviewed: 0 };

    const [matches, reviewed] = await Promise.all([
      this.prisma.jobMatch.findMany({
        where: {
          userId,
          resumeVersionId,
          verdict: 'NEEDS_REVIEW',
          job: { status: 'ACTIVE', reviewFeedback: { none: { userId } } },
        },
        orderBy: [{ opportunityScore: 'desc' }],
        include: {
          job: {
            include: {
              company: { select: { name: true } },
              classifications: { orderBy: { classifierVersion: 'desc' }, take: 1 },
            },
          },
        },
      }),
      this.prisma.jobReviewFeedback.count({ where: { userId } }),
    ]);

    return {
      reviewed,
      jobs: matches.map((m) => {
        const c = m.job.classifications[0];
        return {
          jobId: m.jobId,
          title: m.job.title,
          company: m.job.company.name,
          location: m.job.location,
          url: m.job.url,
          postedAgeDays: ageDays(m.job.postedAt ?? m.job.firstSeenAt),
          roleFamily: c?.roleFamily ?? 'AMBIGUOUS',
          primaryFunction: c?.primaryFunction ?? 'AMBIGUOUS',
          codingIntensity: c?.codingIntensity ?? 'UNKNOWN',
          seniority: c?.seniority ?? 'UNKNOWN',
          minimumYears: c?.minimumYears ?? null,
          // The four dimensions, never collapsed into one number.
          developmentConfidence: m.developmentConfidence,
          targetRoleFit: m.targetRoleFit,
          specializationFit: m.specializationFit,
          resumeFit: m.overallScore,
          requiredSkills: c?.requiredSkills ?? [],
          developmentEvidence: c?.developmentEvidence ?? [],
          nonDevelopmentEvidence: c?.nonDevelopmentEvidence ?? [],
          whyUncertain: c?.classificationReason ?? m.verdictReason ?? 'No classification stored.',
        };
      }),
    };
  }

  /** Record the human judgement. Never written to job_classifications. */
  async review(userId: string, jobId: string, relevant: boolean, note?: string) {
    const match = await this.prisma.jobMatch.findFirst({ where: { userId, jobId } });
    if (!match) throw new NotFoundException('No match for this job');

    return this.prisma.jobReviewFeedback.upsert({
      where: { userId_jobId: { userId, jobId } },
      create: { userId, jobId, relevant, note },
      update: { relevant, note },
    });
  }

  /**
   * Everything CareerOS rejected, and exactly why. Read-only: this view exists
   * so a wrong exclusion is visible rather than silent.
   */
  async excluded(userId: string) {
    const resumeVersionId = await this.activeVersionId(userId);
    if (!resumeVersionId) return { total: 0, buckets: [] };

    const matches = await this.prisma.jobMatch.findMany({
      where: { userId, resumeVersionId, verdict: 'SKIP', job: { status: 'ACTIVE' } },
      orderBy: [{ opportunityScore: 'desc' }],
      include: {
        job: {
          include: {
            company: { select: { name: true } },
            classifications: { orderBy: { classifierVersion: 'desc' }, take: 1 },
          },
        },
      },
    });

    const byCode = new Map<string, ReturnType<typeof this.excludedRow>[]>();
    for (const m of matches) {
      const code = m.verdictCode ?? 'UNCODED';
      (byCode.get(code) ?? byCode.set(code, []).get(code)!).push(this.excludedRow(m));
    }

    return {
      total: matches.length,
      buckets: [...byCode.entries()]
        .map(([code, jobs]) => ({ code, label: BUCKET_LABELS[code] ?? code, count: jobs.length, jobs }))
        .sort((a, b) => b.count - a.count),
    };
  }

  private excludedRow(m: {
    jobId: string;
    verdictReason: string | null;
    developmentConfidence: number | null;
    targetRoleFit: number | null;
    specializationFit: number | null;
    job: {
      title: string;
      location: string | null;
      url: string;
      postedAt: Date | null;
      firstSeenAt: Date;
      company: { name: string };
      classifications: { roleFamily: string; developmentEvidence: string[]; nonDevelopmentEvidence: string[] }[];
    };
  }) {
    const c = m.job.classifications[0];
    return {
      jobId: m.jobId,
      title: m.job.title,
      company: m.job.company.name,
      location: m.job.location,
      url: m.job.url,
      postedAgeDays: ageDays(m.job.postedAt ?? m.job.firstSeenAt),
      roleFamily: c?.roleFamily ?? 'AMBIGUOUS',
      reason: m.verdictReason ?? 'No reason recorded.',
      developmentConfidence: m.developmentConfidence,
      targetRoleFit: m.targetRoleFit,
      specializationFit: m.specializationFit,
      evidence: [...(c?.nonDevelopmentEvidence ?? []), ...(c?.developmentEvidence ?? [])].slice(0, 3),
    };
  }
}

const ageDays = (d: Date) => Math.floor((Date.now() - d.getTime()) / 86_400_000);

/** Never collapsed. "Not development" and "wrong specialization" are not the same rejection. */
const BUCKET_LABELS: Record<string, string> = {
  NOT_DEVELOPMENT: 'Not a development role',
  DEVELOPMENT_WRONG_SPECIALIZATION: 'Genuine engineering, different specialization',
  TARGET_ROLE_TOO_SENIOR: 'Beyond your experience',
  TARGET_ROLE_BELOW_LEVEL: 'Below your level (internship / trainee)',
  TARGET_ROLE_EXPERIENCE_STRETCH: 'Experience stretch',
  TARGET_ROLE_WEAK_STACK: 'Core-stack mismatch',
  AMBIGUOUS_NEEDS_REVIEW: 'Ambiguous',
  UNCODED: 'Rejected before verdict codes existed',
};
