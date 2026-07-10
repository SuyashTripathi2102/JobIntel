import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { activeVersionSql, notActedOnSql } from '../matching/active-resume.sql';
import { locationTags } from '../matching/location-filter';
import { TelegramChannel } from './channels';

/**
 * ⭐ Daily Brief (ROADMAP v0.3): the morning answer to "what should I do
 * next?". Ships on Telegram first — the same queries become the dashboard
 * API. Medium-priority matches live here instead of interrupting the phone.
 */
@Injectable()
export class DailyBriefService {
  private readonly logger = new Logger(DailyBriefService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramChannel,
    config: ConfigService,
  ) {
    // The dashboard shares the CORS origin — one env, one truth.
    this.dashboardUrl = config.get<string>('CORS_ORIGIN') || null;
  }

  private readonly dashboardUrl: string | null;

  /**
   * Midday CONSIDER digest (notification policy, 2026-07-09): APPLY jobs push
   * immediately all day via the notification gate; good-but-not-perfect
   * CONSIDER jobs (60–74, India, fresh, unnotified) would otherwise rot —
   * batch them once at ~2 PM so nothing good is silently lost. Marks them
   * notified so they don't repeat.
   */
  async sendConsiderDigest(): Promise<{ sent: number }> {
    const users = await this.prisma.user.findMany({
      where: {
        resumes: { some: { isPrimary: true, versions: { some: { embedding: { isNot: null } } } } },
      },
      select: { id: true },
    });

    let sent = 0;
    for (const user of users) {
      const jobs = await this.prisma.$queryRaw<
        { matchId: string; score: number; title: string; company: string; jobId: string }[]
      >`
        SELECT m.id AS "matchId", round(m."opportunityScore") AS score, j.title,
               c.name AS company, j.id AS "jobId"
        FROM job_matches m
        JOIN jobs j ON j.id = m."jobId" AND j.status = 'ACTIVE'
        JOIN companies c ON c.id = j."companyId"
        WHERE m."userId" = ${user.id}
          AND m."resumeVersionId" = ${activeVersionSql(user.id)}
          AND m.verdict = 'CONSIDER'
          AND m."notifiedAt" IS NULL
          AND COALESCE(j."postedAt", j."firstSeenAt") >= now() - interval '30 days'
          AND (j.country = 'IN' OR j.location ~* 'india|bengaluru|bangalore|mumbai|pune|delhi|hyderabad|chennai|noida|gurgaon|indore|ahmedabad')
          AND ${notActedOnSql(user.id)}
        ORDER BY m."opportunityScore" DESC
        LIMIT 8
      `;
      if (jobs.length === 0) continue;

      const lines = [
        `🟡 <b>Midday digest — ${jobs.length} worth a look</b>`,
        `Good matches that didn't quite hit "apply now" — your call:`,
        ``,
        ...jobs.map(
          (j) => `• ${j.score} · <b>${escapeHtml(j.title)}</b> — ${escapeHtml(j.company)}`,
        ),
      ];
      const buttons = this.dashboardUrl?.startsWith('http')
        ? [[{ text: '📊 Open Mission Control', url: this.dashboardUrl }]]
        : undefined;

      if (this.telegram.isConfigured()) {
        await this.telegram.send(lines.join('\n'), { buttons });
      } else {
        this.logger.log(`[consider-digest]\n${lines.join('\n').replace(/<[^>]+>/g, '')}`);
      }
      // Mark notified so the digest doesn't repeat them tomorrow.
      await this.prisma.jobMatch.updateMany({
        where: { id: { in: jobs.map((j) => j.matchId) } },
        data: { notifiedAt: new Date() },
      });
      sent++;
    }
    return { sent };
  }

  /** Compose + send the brief for every user with a parsed primary resume. */
  async sendAll(): Promise<{ sent: number }> {
    const users = await this.prisma.user.findMany({
      where: {
        resumes: { some: { isPrimary: true, versions: { some: { embedding: { isNot: null } } } } },
      },
      select: { id: true, name: true },
    });

    let sent = 0;
    for (const user of users) {
      try {
        const text = await this.compose(user.id, user.name);
        if (this.telegram.isConfigured()) {
          await this.telegram.send(text, {
            buttons: this.dashboardUrl?.startsWith('http')
              ? [[{ text: '📊 Open Mission Control', url: this.dashboardUrl }]]
              : undefined,
          });
          sent++;
        } else {
          this.logger.log(`[daily-brief]\n${text.replace(/<[^>]+>/g, '')}`);
        }
      } catch (err) {
        this.logger.error(
          `daily brief failed for ${user.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return { sent };
  }

  /** Structured brief — consumed by the Telegram formatter AND the dashboard. */
  async data(userId: string) {
    const dayAgo = new Date(Date.now() - 24 * 3_600_000);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    // Matches from superseded resume versions stay in the table for outcome
    // analytics; nothing user-facing may read them.
    const activeVersionId = await this.activeVersionId(userId);

    const [newJobs24h, indiaNew24h, recommended24h, mustApply, worthALook, trending, skills] =
      await Promise.all([
        this.prisma.job.count({ where: { firstSeenAt: { gte: dayAgo } } }),
        this.prisma.$queryRaw<[{ n: bigint }]>`
          SELECT count(*) AS n FROM jobs j
          WHERE j."firstSeenAt" >= ${dayAgo}
            AND (j.country = 'IN' OR j.location ~* 'india|bengaluru|bangalore|mumbai|pune|delhi|hyderabad|chennai|noida|gurgaon|gurugram|indore|kolkata')
        `,
        this.prisma.jobMatch.count({
          where: {
            userId,
            resumeVersionId: activeVersionId ?? '',
            createdAt: { gte: dayAgo },
            verdict: { in: ['APPLY', 'CONSIDER'] },
          },
        }),
        this.prisma.$queryRaw<
          { jobId: string; score: number; title: string; company: string; location: string | null; workMode: string | null; url: string }[]
        >`
          SELECT j.id AS "jobId", round(m."opportunityScore") AS score, j.title, c.name AS company,
                 j.location, j."workMode"::text AS "workMode", j.url
          FROM job_matches m
          JOIN jobs j ON j.id = m."jobId" AND j.status = 'ACTIVE'
          JOIN companies c ON c.id = j."companyId"
          WHERE m."userId" = ${userId}
            AND m."resumeVersionId" = ${activeVersionSql(userId)}
            AND m.verdict = 'APPLY'
            AND COALESCE(j."postedAt", j."firstSeenAt") >= ${weekAgo}
            AND ${notActedOnSql(userId)}
          ORDER BY m."opportunityScore" DESC LIMIT 3
        `,
        this.prisma.$queryRaw<
          { jobId: string; score: number; title: string; company: string; location: string | null; workMode: string | null; url: string }[]
        >`
          SELECT j.id AS "jobId", round(m."opportunityScore") AS score, j.title, c.name AS company,
                 j.location, j."workMode"::text AS "workMode", j.url
          FROM job_matches m
          JOIN jobs j ON j.id = m."jobId" AND j.status = 'ACTIVE'
          JOIN companies c ON c.id = j."companyId"
          WHERE m."userId" = ${userId}
            AND m."resumeVersionId" = ${activeVersionSql(userId)}
            AND m.verdict = 'CONSIDER'
            AND COALESCE(j."postedAt", j."firstSeenAt") >= ${new Date(Date.now() - 30 * 86_400_000)}
            AND ${notActedOnSql(userId)}
          ORDER BY m."opportunityScore" DESC LIMIT 3
        `,
        // "Fresh roles this week": companies with the most FRESH (≤7d posted),
        // India, engineering-titled openings. The old query grouped every job
        // firstSeenAt this week — a company's first crawl made its whole board
        // (sales, HR, ops, any country) look freshly hiring.
        this.prisma.$queryRaw<{ company: string; n: bigint }[]>`
          SELECT c.name AS company, count(*) AS n
          FROM jobs j JOIN companies c ON c.id = j."companyId"
          WHERE j.status = 'ACTIVE'
            AND now()::date - COALESCE(j."postedAt", j."firstSeenAt")::date <= 7
            AND (j.country = 'IN' OR j.location ~* 'india|bengaluru|bangalore|mumbai|pune|delhi|hyderabad|chennai|noida|gurgaon|gurugram|indore|ahmedabad|kolkata')
            AND j.title ~* 'engineer|developer|sde|full.?stack|backend|frontend|node|react|software'
          GROUP BY c.name ORDER BY n DESC LIMIT 3
        `,
        // "Learn next": skills blocking the jobs you could ACTUALLY get. Scoped
        // to APPLY/CONSIDER on the active resume — without the verdict filter it
        // counted skills from marketing/SRE/data roles too, and told a Node dev
        // to learn Python because 300 irrelevant AI roles mention it.
        this.prisma.$queryRaw<{ skill: string; n: bigint }[]>`
          SELECT skill, count(*) AS n
          FROM job_matches m
          JOIN jobs j ON j.id = m."jobId" AND j.status = 'ACTIVE'
          CROSS JOIN LATERAL unnest(m."missingSkills") AS skill
          WHERE m."userId" = ${userId}
            AND m."resumeVersionId" = ${activeVersionSql(userId)}
            AND m.verdict IN ('APPLY', 'CONSIDER')
            AND (j.country = 'IN' OR j.location ~* 'india|bengaluru|bangalore|mumbai|pune|delhi|hyderabad|chennai|noida|gurgaon|gurugram|indore|ahmedabad|kolkata')
          GROUP BY skill ORDER BY n DESC LIMIT 3
        `,
      ]);

    // Follow-up intelligence v1: applications sitting in APPLIED for 7+ days.
    const followUps = await this.prisma.application.findMany({
      where: {
        userId,
        status: 'APPLIED',
        appliedAt: { lte: new Date(Date.now() - 7 * 86_400_000) },
      },
      orderBy: { appliedAt: 'asc' },
      take: 3,
      select: {
        appliedAt: true,
        job: { select: { title: true, company: { select: { name: true } } } },
      },
    });

    return {
      newJobs24h,
      indiaNew24h: Number(indiaNew24h[0]?.n ?? 0),
      recommended24h,
      mustApply: mustApply.map((j) => ({ ...j, score: Number(j.score) })),
      worthALook: worthALook.map((j) => ({ ...j, score: Number(j.score) })),
      trending: trending.map((t) => ({ company: t.company, newJobs7d: Number(t.n) })),
      missingSkills: skills.map((s) => ({ skill: s.skill, count: Number(s.n) })),
      followUps: followUps.map((f) => ({
        title: f.job.title,
        company: f.job.company.name,
        daysWaiting: Math.floor((Date.now() - (f.appliedAt?.getTime() ?? Date.now())) / 86_400_000),
      })),
    };
  }

  private async compose(userId: string, name: string | null): Promise<string> {
    const {
      newJobs24h,
      indiaNew24h,
      recommended24h,
      mustApply,
      worthALook,
      trending,
      missingSkills,
      followUps,
    } = await this.data(userId);

    const lines: string[] = [
      `☀️ <b>Daily Brief — ${new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</b>`,
      `Good morning${name ? ` ${escapeHtml(name.split(' ')[0])}` : ''} 👋`,
      ``,
      `📥 New jobs (24h): <b>${newJobs24h}</b> · 🇮🇳 India: <b>${indiaNew24h}</b>`,
      `🎯 Recommended for you (24h): <b>${recommended24h}</b>`,
    ];

    if (mustApply.length > 0) {
      lines.push(``, `🔥 <b>Apply today</b>`);
      mustApply.forEach((j, i) => {
        const tags = locationTags(j.location, j.workMode);
        lines.push(
          `${i + 1}. 🟢 ${j.score} · <b>${escapeHtml(j.title)}</b> — ${escapeHtml(j.company)}${tags ? ' · ' + escapeHtml(tags) : ''}`,
        );
      });
    }

    if (worthALook.length > 0) {
      lines.push(``, `🟡 <b>Consider</b>`);
      for (const j of worthALook) {
        const tags = locationTags(j.location, j.workMode);
        lines.push(
          `• 🟡 ${j.score} · ${escapeHtml(j.title)} — ${escapeHtml(j.company)}${tags ? ' · ' + escapeHtml(tags) : ''}`,
        );
      }
    }

    if (mustApply.length === 0 && worthALook.length === 0) {
      lines.push(``, `No qualified opportunities today — the bar stays high on purpose.`);
    }

    if (followUps.length > 0) {
      lines.push(``, `📬 <b>Follow up</b> — no response yet:`);
      for (const f of followUps) {
        lines.push(
          `• ${escapeHtml(f.title)} — ${escapeHtml(f.company)} · applied ${f.daysWaiting}d ago`,
        );
      }
    }

    if (trending.length > 0) {
      lines.push(
        ``,
        `📈 <b>Hiring this week:</b> ${trending.map((t) => `${escapeHtml(t.company)} (+${t.newJobs7d})`).join(', ')}`,
      );
    }
    if (missingSkills.length > 0) {
      lines.push(
        `🧩 <b>Learn next:</b> ${missingSkills.map((s) => `${escapeHtml(s.skill)} → unlocks ${s.count} matches`).join(' · ')}`,
      );
    }

    return lines.join('\n');
  }

  /** Newest activated version of the primary resume; '' when none is active. */
  private async activeVersionId(userId: string): Promise<string> {
    const v = await this.prisma.resumeVersion.findFirst({
      where: { resume: { userId, isPrimary: true }, activatedAt: { not: null } },
      orderBy: { versionNumber: 'desc' },
      select: { id: true },
    });
    return v?.id ?? '';
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
