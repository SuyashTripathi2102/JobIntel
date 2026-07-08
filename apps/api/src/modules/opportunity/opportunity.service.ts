import { Injectable } from '@nestjs/common';
import { HiringTrend, JobStatus, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { companyTier } from './company-tier';

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
    location: string | null;
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
    cities: string[];
  } | null;
  company: {
    name: string;
    confidence: number;
    hiringTrend: HiringTrend | null;
    /** Jobs this company added in the last 14 days — live hiring activity. */
    recentJobs14d: number;
  };
}

const WEIGHTS = {
  resumeFit: 35,
  experienceFit: 15,
  freshness: 20, // raised 15→20 (2026-07-08): 70d-old postings were reading "High"
  remotePreference: 10,
  salaryPreference: 5,
  companyQuality: 5,
  hiringVelocity: 5,
  cityPreference: 5, // boost-only module — added only on a match
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
        location: match.job.location,
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
            cities: match.user.preference.cities,
          }
        : null,
      company: {
        name: match.job.company.name,
        confidence: match.job.company.confidence,
        hiringTrend: match.job.company.intelligence?.hiringTrend ?? null,
        // Prefer postedAt: firstSeenAt spikes on a company's FIRST crawl
        // (whole board looks "new"), inflating the hiring-activity signal.
        recentJobs14d: await this.prisma.job.count({
          where: {
            companyId: match.job.companyId,
            OR: [
              { postedAt: { gte: new Date(Date.now() - 14 * 86_400_000) } },
              { postedAt: null, firstSeenAt: { gte: new Date(Date.now() - 14 * 86_400_000) } },
            ],
          },
        }),
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
    // Steep by design: a 60d-old posting is probably in late stages or a
    // zombie listing; it must not compete with this week's openings.
    const seen = ctx.job.postedAt ?? ctx.job.firstSeenAt;
    const ageHours = (Date.now() - seen.getTime()) / 3_600_000;
    const ageDays = ageHours / 24;
    const freshScore =
      ageHours <= 24 ? 100
      : ageDays <= 2 ? 95
      : ageDays <= 3 ? 90
      : ageDays <= 7 ? 80
      : ageDays <= 14 ? 65
      : ageDays <= 21 ? 50
      : ageDays <= 30 ? 35
      : ageDays <= 45 ? 20
      : ageDays <= 60 ? 10
      : 0;
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

    // 6. Company quality — discovery confidence, floored for curated big tech.
    const tier = companyTier(ctx.company.name);
    modules.push({
      module: 'companyQuality',
      score: tier === 'BIG_TECH' ? Math.max(ctx.company.confidence, 85) : ctx.company.confidence,
      weight: WEIGHTS.companyQuality,
      reason:
        tier === 'BIG_TECH'
          ? `big tech (${ctx.company.name})`
          : `company confidence ${Math.round(ctx.company.confidence)}/100`,
    });

    // 7. Hiring velocity — a growing team reads more applications. Prefer the
    // derived intelligence trend; fall back to the LIVE signal (jobs added in
    // the last 14 days) so this module never silently drops out.
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
    } else {
      const recent = ctx.company.recentJobs14d;
      modules.push({
        module: 'hiringVelocity',
        score: recent >= 10 ? 95 : recent >= 3 ? 75 : recent >= 1 ? 55 : 30,
        weight: WEIGHTS.hiringVelocity,
        reason:
          recent >= 3
            ? `actively hiring — ${recent} new roles in 14d`
            : recent >= 1
              ? `${recent} new role(s) in 14d`
              : 'no new openings in 14d',
      });
    }

    // 7b. City preference — boost only, never penalize (location is often
    // missing or generic; absence of a match must not drag the score).
    if (ctx.prefs?.cities?.length && ctx.job.location) {
      const loc = ctx.job.location.toLowerCase();
      const hit = ctx.prefs.cities.find((c) => loc.includes(c.toLowerCase()));
      if (hit) {
        modules.push({
          module: 'cityPreference',
          score: 100,
          weight: WEIGHTS.cityPreference,
          reason: `in your preferred city (${hit})`,
        });
      }
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
    let opportunityScore =
      Math.round(
        (modules.reduce((s, m) => s + m.score * m.weight, 0) / totalWeight) * 10,
      ) / 10;

    // Verification gate: never silently recommend a company we barely know.
    // The 5%-weight quality module can't express "we have no idea who this
    // is" — so low confidence dampens the whole score AND flags it visibly.
    if (ctx.company.confidence < 40) {
      opportunityScore = Math.round(opportunityScore * 0.85 * 10) / 10;
      modules.push({
        module: 'verification',
        score: ctx.company.confidence,
        weight: 0, // informational — the dampening already applied
        reason: `⚠ company not yet verified (confidence ${Math.round(ctx.company.confidence)}/100) — score reduced`,
      });
    }

    const contentHash = createHash('sha256')
      .update(`${ctx.job.title}|${ctx.job.salaryMin}|${ctx.job.salaryMax}`)
      .digest('hex')
      .slice(0, 16);

    return { opportunityScore, breakdown: modules, contentHash };
  }
}
