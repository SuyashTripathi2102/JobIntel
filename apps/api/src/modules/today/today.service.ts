import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { nextOutreachAction } from '../referrals/referral-followup';
import {
  competitionChips,
  greeting,
  impactLabel,
  istHour,
  weekMomentum,
  type Impact,
  type Momentum,
} from './today.pure';

export type TodayKind =
  | 'REPLY'
  | 'FOLLOW_UP'
  | 'APPLY'
  | 'TAILOR'
  | 'REFERRAL'
  | 'MASTER_RESUME'
  | 'LEARN';

export interface TodayAction {
  kind: TodayKind;
  title: string;
  detail: string;
  chips: string[];
  stars: number; // 1–5, internal ordering only
  impact: Impact; // what the user sees instead of stars
  minutes: number; // estimated effort
  href: string; // into an existing feature
  value?: string; // e.g. "unlocks 6 strong matches"
  why?: string[]; // "why this first" — only on the lead action
}

// Lower = earlier when priority ties. Time-sensitive replies first; passive
// learning last.
const KIND_ORDER: Record<TodayKind, number> = {
  REPLY: 0,
  FOLLOW_UP: 1,
  APPLY: 2,
  TAILOR: 3,
  REFERRAL: 4,
  MASTER_RESUME: 5,
  LEARN: 6,
};

const DAY = 86_400_000;

/**
 * The Today Command Center. A deterministic daily plan that orchestrates the
 * highest-leverage actions across every pillar CareerOS already has — apply,
 * follow up, tailor, refer, learn — ranked, time-estimated, each a link into
 * the feature that does it. Action-first, never metrics-first. No LLM.
 */
@Injectable()
export class TodayService {
  constructor(private readonly prisma: PrismaService) {}

  async today(userId: string, name?: string | null) {
    const activeVersion = await this.prisma.resumeVersion.findFirst({
      where: { resume: { userId, isPrimary: true }, activatedAt: { not: null } },
      orderBy: { versionNumber: 'desc' },
      select: { id: true },
    });
    const activeVersionId = activeVersion?.id ?? null;

    const primaryResume = await this.prisma.resume.findFirst({
      where: { userId, isPrimary: true },
      select: { masterHtml: true },
    });

    const apps = await this.prisma.application.findMany({
      where: { userId },
      select: { jobId: true, status: true },
    });
    const appliedJobIds = new Set(apps.filter((a) => a.status !== 'SAVED').map((a) => a.jobId));
    const applicationsActive = apps.filter((a) =>
      ['APPLIED', 'OA', 'INTERVIEW'].includes(a.status),
    ).length;
    const interviewsInProgress = apps.filter((a) =>
      ['OA', 'INTERVIEW', 'OFFER'].includes(a.status),
    ).length;

    const matches = activeVersionId
      ? await this.prisma.jobMatch.findMany({
          where: {
            userId,
            resumeVersionId: activeVersionId,
            verdict: 'APPLY',
            job: { status: 'ACTIVE' },
          },
          orderBy: { opportunityScore: 'desc' },
          take: 15,
          select: {
            jobId: true,
            opportunityScore: true,
            missingSkills: true,
            job: { select: { firstSeenAt: true, company: { select: { name: true } } } },
          },
        })
      : [];
    const applyCandidates = matches.filter((m) => !appliedJobIds.has(m.jobId));

    const contacts = await this.prisma.referralContact.findMany({
      where: { userId },
      select: {
        companyName: true,
        name: true,
        status: true,
        contactedAt: true,
        repliedAt: true,
        followUpCount: true,
        lastFollowUpAt: true,
      },
    });
    const contactedCompanies = new Set(
      contacts.filter((c) => c.status === 'CONTACTED' || c.status === 'REPLIED').map((c) => c.companyName),
    );
    const repliesInFlight = contacts.filter((c) => c.status === 'REPLIED').length;
    const outreachInFlight = contacts.filter((c) => c.status === 'CONTACTED').length;

    const tailored = await this.prisma.companyResume.findMany({
      where: { userId },
      select: { jobId: true },
    });
    const tailoredJobs = new Set(tailored.map((t) => t.jobId));

    const actions: Omit<TodayAction, 'impact'>[] = [];

    // 1) Outreach that needs you today — replies to answer, nudges that are due.
    const due = contacts
      .map((c) => ({
        c,
        na: nextOutreachAction({
          status: c.status,
          contactedAt: c.contactedAt,
          repliedAt: c.repliedAt,
          followUpCount: c.followUpCount,
          lastFollowUpAt: c.lastFollowUpAt,
        }),
      }))
      .filter((x) => x.na.due && (x.c.status === 'CONTACTED' || x.c.status === 'REPLIED'))
      .sort((a, b) => b.na.urgency - a.na.urgency)
      .slice(0, 2);
    for (const { c, na } of due) {
      const replied = c.status === 'REPLIED';
      actions.push({
        kind: replied ? 'REPLY' : 'FOLLOW_UP',
        title: replied ? `Reply to ${c.name} at ${c.companyName}` : `Follow up with ${c.name} at ${c.companyName}`,
        detail: na.detail,
        chips: [na.daysSince != null ? `day ${na.daysSince}` : 'today'],
        stars: replied ? 5 : na.urgency >= 3 ? 5 : 4,
        minutes: replied ? 5 : 3,
        href: '/outreach',
      });
    }

    // 2) Apply to your strongest, freshest matches you haven't applied to.
    let freshApplyMatches = 0;
    const top = applyCandidates[0] ?? null;
    for (const m of applyCandidates.slice(0, 2)) {
      const ageDays = Math.floor((Date.now() - m.job.firstSeenAt.getTime()) / DAY);
      if (ageDays <= 3) freshApplyMatches++;
      const chips = [...competitionChips(ageDays), `fit ${Math.round(m.opportunityScore ?? 0)}`];
      if (contactedCompanies.has(m.job.company.name)) chips.push('referral in flight');
      if (tailoredJobs.has(m.jobId)) chips.push('resume ready');
      const why = [
        ageDays <= 0 ? 'Posted today' : `Posted ${ageDays} day${ageDays === 1 ? '' : 's'} ago`,
        ...(ageDays <= 3 ? ['Low competition — early applicants get screened first'] : []),
        `Strong fit for your resume (${Math.round(m.opportunityScore ?? 0)})`,
        ...(tailoredJobs.has(m.jobId) ? ['Your tailored resume is ready'] : []),
        ...(contactedCompanies.has(m.job.company.name) ? ['A referral is already in flight'] : []),
      ];
      actions.push({
        kind: 'APPLY',
        title: `Apply to ${m.job.company.name}`,
        detail: "Strong match — get in while it's fresh; early applicants get screened first.",
        chips,
        stars: 5,
        minutes: 10,
        href: `/jobs/${m.jobId}`,
        why,
      });
    }

    // 3) Tailor / 4) Referral — for the top apply target, if not done yet.
    if (top) {
      if (!tailoredJobs.has(top.jobId)) {
        actions.push({
          kind: 'TAILOR',
          title: `Tailor your resume for ${top.job.company.name}`,
          detail: 'Match the JD keywords (ATS) before you apply — from your real content.',
          chips: ['1 click', 'ATS keywords'],
          stars: 4,
          minutes: 3,
          href: `/resumes/tailor/${top.jobId}`,
        });
      }
      if (!contactedCompanies.has(top.job.company.name)) {
        actions.push({
          kind: 'REFERRAL',
          title: `Find a referral at ${top.job.company.name}`,
          detail: 'A warm intro is the single biggest lever on getting seen.',
          chips: ['public sources'],
          stars: 4,
          minutes: 5,
          href: `/referrals/${top.jobId}`,
        });
      }
    }

    // 5) One-time high-value: use your real resume as the master.
    if (activeVersionId && !primaryResume?.masterHtml) {
      actions.push({
        kind: 'MASTER_RESUME',
        title: 'Set your real resume as the master',
        detail: 'Tailored resumes are using a generated copy that loses your formatting & achievements.',
        chips: ['one-time', 'upload .html'],
        stars: 4,
        minutes: 2,
        href: '/resumes/master',
      });
    }

    // 6) Highest-ROI skill to learn — the most common gap across strong matches.
    const skillCounts = new Map<string, number>();
    for (const m of applyCandidates) {
      for (const s of m.missingSkills) {
        const k = s.trim();
        if (k) skillCounts.set(k, (skillCounts.get(k) ?? 0) + 1);
      }
    }
    const topSkill = [...skillCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topSkill && topSkill[1] >= 3) {
      actions.push({
        kind: 'LEARN',
        title: `Learn ${topSkill[0]}`,
        detail: 'The most common missing requirement across your strong matches.',
        chips: ['high ROI'],
        value: `unlocks ${topSkill[1]} strong matches`,
        stars: 3,
        minutes: 120,
        href: '/insights',
      });
    }

    actions.sort((a, b) => b.stars - a.stars || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
    const ranked: TodayAction[] = actions
      .slice(0, 7)
      .map((a, i) => ({ ...a, impact: impactLabel(a.stars, i === 0) }));

    const momentum = weekMomentum({
      interviewsInProgress,
      repliesInFlight,
      outreachInFlight,
      freshApplyMatches,
      applicationsActive,
    });

    // Today's goal: get one application in. Progress people can feel.
    const istMs = Date.now() + 5.5 * 3_600_000;
    const startOfTodayUtc = new Date(Math.floor(istMs / DAY) * DAY - 5.5 * 3_600_000);
    const appliedToday = await this.prisma.application.count({
      where: { userId, appliedAt: { gte: startOfTodayUtc } },
    });

    return {
      greeting: greeting(istHour()),
      name: name ?? null,
      goal: { label: 'Get one application submitted today', done: appliedToday, target: 1 },
      weekProbability: momentum.level as Momentum,
      probabilityReason: momentum.reason,
      totalMinutes: ranked.reduce((n, a) => n + a.minutes, 0),
      actions: ranked,
    };
  }
}
