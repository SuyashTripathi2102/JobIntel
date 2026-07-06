import { Injectable } from '@nestjs/common';
import { HiringTrend, JobStatus, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Opportunity Score (ADR-10): modular scorers, each returning a 0-100 score,
 * its weight, and a human reason. Non-applicable modules (no data) drop out
 * and remaining weights renormalize — an unknown salary must not silently
 * drag a score down. The breakdown ships with every notification:
 * CareerOS explains, it doesn't just rank.
 */

export interface ScoreModule {
  module: string;
  score: number; // 0-100
  weight: number;
  reason: string;
}

export interface OpportunityResult {
  opportunityScore: number;
  breakdown: ScoreModule[];
  contentHash: string;
}

interface ScoringContext {
  match: {
    overallScore: number;
    technicalScore: number;
    experienceScore: number;
    missingSkills: string[];
  };
  job: {
    title: string;
    postedAt: Date | null;
    firstSeenAt: Date;
    workMode: string | null;
    salaryMin: number | null;
    salaryMax: number | null;
    currency: string | null;
    companyId: string;
  };
  prefs: {
    workModes: string[];
    minSalary: number | null;
    salaryCurrency: string | null;
  } | null;
  company: {
    confidence: number;
    hiringTrend: HiringTrend | null;
  };
}

const WEIGHTS = {
  resumeFit: 35,
  experienceFit: 15,
  freshness: 15,
  remotePreference: 10,
  salaryPreference: 10,
  companyQuality: 5,
  hiringVelocity: 5,
  skillGap: 5,
} as const;

@Injectable()
export class OpportunityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Compute + persist the opportunity score for one JobMatch. */
  async scoreMatch(matchId: string): Promise<OpportunityResult | null> {
    const match = await this.prisma.jobMatch.findUnique({
      where: { id: matchId },
      include: {
        job: { include: { company: { include: { intelligence: true } } } },
        user: { include: { preference: true } },
      },
    });
    if (!match || match.job.status !== JobStatus.ACTIVE) return null;

    const result = this.compute({
      match: {
        overallScore: match.overallScore,
        technicalScore: match.technicalScore,
        experienceScore: match.experienceScore,
        missingSkills: match.missingSkills,
      },
      job: {
        title: match.job.title,
        postedAt: match.job.postedAt,
        firstSeenAt: match.job.firstSeenAt,
        workMode: match.job.workMode,
        salaryMin: match.job.salaryMin,
        salaryMax: match.job.salaryMax,
        currency: match.job.currency,
        companyId: match.job.companyId,
      },
      prefs: match.user.preference
        ? {
            workModes: match.user.preference.workModes,
            minSalary: match.user.preference.minSalary,
            salaryCurrency: match.user.preference.salaryCurrency,
          }
        : null,
      company: {
        confidence: match.job.company.confidence,
        hiringTrend: match.job.company.intelligence?.hiringTrend ?? null,
      },
    });

    await this.prisma.jobMatch.update({
      where: { id: matchId },
      data: {
        opportunityScore: result.opportunityScore,
        scoreBreakdown: result.breakdown as unknown as Prisma.InputJsonValue,
        contentHash: result.contentHash,
      },
    });
    return result;
  }

  compute(ctx: ScoringContext): OpportunityResult {
    const modules: ScoreModule[] = [];

    // 1. Resume fit — the LLM's overall verdict carries the most weight.
    modules.push({
      module: 'resumeFit',
      score: ctx.match.overallScore,
      weight: WEIGHTS.resumeFit,
      reason: `${Math.round(ctx.match.overallScore)}% resume match`,
    });

    // 2. Experience fit — seniority mismatches waste applications.
    modules.push({
      module: 'experienceFit',
      score: ctx.match.experienceScore,
      weight: WEIGHTS.experienceFit,
      reason:
        ctx.match.experienceScore >= 70
          ? 'experience level fits'
          : ctx.match.experienceScore >= 40
            ? 'experience level is a stretch'
            : 'seniority mismatch',
    });

    // 3. Freshness — applying within 48h measurably raises response rates.
    const seen = ctx.job.postedAt ?? ctx.job.firstSeenAt;
    const ageHours = (Date.now() - seen.getTime()) / 3_600_000;
    const freshScore =
      ageHours <= 24 ? 100 : ageHours <= 72 ? 85 : ageHours <= 168 ? 65 : ageHours <= 720 ? 40 : 15;
    modules.push({
      module: 'freshness',
      score: freshScore,
      weight: WEIGHTS.freshness,
      reason:
        ageHours <= 1
          ? 'posted minutes ago'
          : ageHours <= 24
            ? `posted ${Math.round(ageHours)}h ago`
            : `posted ${Math.round(ageHours / 24)}d ago`,
    });

    // 4. Remote preference — only when the user stated one AND the job says.
    if (ctx.prefs?.workModes?.length && ctx.job.workMode) {
      const fits = ctx.prefs.workModes.includes(ctx.job.workMode);
      modules.push({
        module: 'remotePreference',
        score: fits ? 100 : 25,
        weight: WEIGHTS.remotePreference,
        reason: fits
          ? `${ctx.job.workMode.toLowerCase()} — matches your preference`
          : `${ctx.job.workMode.toLowerCase()} — outside your preference`,
      });
    }

    // 5. Salary preference — only when both sides disclose.
    if (ctx.prefs?.minSalary && ctx.job.salaryMax) {
      const sameCurrency =
        !ctx.prefs.salaryCurrency ||
        !ctx.job.currency ||
        ctx.prefs.salaryCurrency === ctx.job.currency;
      if (sameCurrency) {
        const meets = ctx.job.salaryMax >= ctx.prefs.minSalary;
        modules.push({
          module: 'salaryPreference',
          score: meets ? 100 : 30,
          weight: WEIGHTS.salaryPreference,
          reason: meets
            ? `salary up to ${ctx.job.currency ?? ''} ${ctx.job.salaryMax.toLocaleString()} meets your floor`
            : 'disclosed salary below your floor',
        });
      }
    }

    // 6. Company quality — discovery confidence as a proxy until richer data.
    modules.push({
      module: 'companyQuality',
      score: ctx.company.confidence,
      weight: WEIGHTS.companyQuality,
      reason: `company confidence ${Math.round(ctx.company.confidence)}/100`,
    });

    // 7. Hiring velocity — a growing team reads more applications.
    if (ctx.company.hiringTrend && ctx.company.hiringTrend !== HiringTrend.INSUFFICIENT_DATA) {
      const score =
        ctx.company.hiringTrend === HiringTrend.GROWING
          ? 100
          : ctx.company.hiringTrend === HiringTrend.STABLE
            ? 60
            : 25;
      modules.push({
        module: 'hiringVelocity',
        score,
        weight: WEIGHTS.hiringVelocity,
        reason: `hiring trend: ${ctx.company.hiringTrend.toLowerCase()}`,
      });
    }

    // 8. Skill gap — a couple of missing skills is normal; many is a wall.
    const gaps = ctx.match.missingSkills.length;
    modules.push({
      module: 'skillGap',
      score: gaps === 0 ? 100 : gaps <= 2 ? 70 : gaps <= 4 ? 40 : 15,
      weight: WEIGHTS.skillGap,
      reason:
        gaps === 0
          ? 'no missing skills'
          : `missing: ${ctx.match.missingSkills.slice(0, 3).join(', ')}${gaps > 3 ? '…' : ''}`,
    });

    const totalWeight = modules.reduce((s, m) => s + m.weight, 0);
    const opportunityScore =
      Math.round(
        (modules.reduce((s, m) => s + m.score * m.weight, 0) / totalWeight) * 10,
      ) / 10;

    const contentHash = createHash('sha256')
      .update(`${ctx.job.title}|${ctx.job.salaryMin}|${ctx.job.salaryMax}`)
      .digest('hex')
      .slice(0, 16);

    return { opportunityScore, breakdown: modules, contentHash };
  }
}
