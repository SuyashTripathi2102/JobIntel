import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import { DailyBriefService } from './daily-brief.service';
import { Prisma } from '@prisma/client';

/**
 * Mission Control data (ROADMAP v0.3): the brief + the north-star funnel.
 * `applied` counts arrive with the tracker — shown as 0 until then, honestly.
 */
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly brief: DailyBriefService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async get(@CurrentUser() user: AuthenticatedUser) {
    const [briefData, jobsTotal, matches, ge60, notified, applied] = await Promise.all([
      this.brief.data(user.id),
      this.prisma.job.count({ where: { status: 'ACTIVE' } }),
      this.prisma.jobMatch.count({ where: { userId: user.id } }),
      this.prisma.jobMatch.count({
        where: { userId: user.id, opportunityScore: { gte: 60 } },
      }),
      this.prisma.jobMatch.count({
        where: { userId: user.id, notifiedAt: { not: null } },
      }),
      this.prisma.application.count({ where: { userId: user.id } }),
    ]);

    return {
      brief: briefData,
      funnel: { crawled: jobsTotal, matched: matches, recommended: ge60, notified, applied },
      pipeline: await this.todayPipeline(),
    };
  }

  /**
   * "Since 8 AM" funnel + system health — the answer to "why am I not getting
   * jobs?" without SSHing into prod. Recomputed from stored data, so no new
   * instrumentation to drift.
   */
  @Get('pipeline')
  async pipeline() {
    return this.todayPipeline();
  }

  private async todayPipeline() {
    // 8 AM IST today = 02:30 UTC (the brief boundary).
    const now = new Date();
    const since = new Date(now);
    since.setUTCHours(2, 30, 0, 0);
    if (since > now) since.setUTCDate(since.getUTCDate() - 1);

    const india = Prisma.sql`(j.country = 'IN' OR j.location ~* 'india|bengaluru|bangalore|mumbai|pune|delhi|hyderabad|chennai|noida|gurgaon|gurugram|indore|ahmedabad|kolkata')`;

    const [crawls, newJobs, matchRows, lastCrawl, failSample] = await Promise.all([
      this.prisma.$queryRaw<{ status: string; n: bigint }[]>`
        SELECT status, count(*) AS n FROM crawl_runs WHERE "startedAt" >= ${since} GROUP BY status`,
      this.prisma.$queryRaw<{ total: bigint; india: bigint }[]>`
        SELECT count(*) AS total, count(*) FILTER (WHERE ${india}) AS india
        FROM jobs j WHERE j."firstSeenAt" >= ${since}`,
      this.prisma.$queryRaw<{ apply: bigint; consider: bigint; skip: bigint; notified: bigint }[]>`
        SELECT count(*) FILTER (WHERE "opportunityScore" >= 75) AS apply,
               count(*) FILTER (WHERE "opportunityScore" >= 60 AND "opportunityScore" < 75) AS consider,
               count(*) FILTER (WHERE "opportunityScore" < 60) AS skip,
               count(*) FILTER (WHERE "notifiedAt" >= ${since}) AS notified
        FROM job_matches WHERE "createdAt" >= ${since}`,
      this.prisma.crawlRun.findFirst({
        where: { status: 'SUCCEEDED' },
        orderBy: { finishedAt: 'desc' },
        select: { finishedAt: true },
      }),
      this.prisma.$queryRaw<{ err: string; n: bigint }[]>`
        SELECT COALESCE(left(error, 60), 'unknown') AS err, count(*) AS n
        FROM crawl_runs WHERE "startedAt" >= ${since} AND status = 'FAILED'
        GROUP BY 1 ORDER BY 2 DESC LIMIT 3`,
    ]);

    const crawlBy = Object.fromEntries(crawls.map((r) => [r.status, Number(r.n)]));
    const m = matchRows[0] ?? { apply: 0n, consider: 0n, skip: 0n, notified: 0n };

    return {
      since: since.toISOString(),
      lastSuccessfulCrawl: lastCrawl?.finishedAt ?? null,
      crawls: {
        succeeded: crawlBy.SUCCEEDED ?? 0,
        failed: crawlBy.FAILED ?? 0,
        topFailures: failSample.map((f) => ({ reason: f.err.trim(), count: Number(f.n) })),
      },
      newJobs: Number(newJobs[0]?.total ?? 0),
      indiaJobs: Number(newJobs[0]?.india ?? 0),
      matched: Number(m.apply) + Number(m.consider) + Number(m.skip),
      apply: Number(m.apply),
      consider: Number(m.consider),
      skip: Number(m.skip),
      notificationsSent: Number(m.notified),
      // Plain-language explanation the UI shows verbatim.
      explanation:
        Number(newJobs[0]?.india ?? 0) === 0
          ? 'No new India-relevant jobs posted since 8 AM — the crawlers ran, companies just haven’t posted anything new.'
          : Number(m.apply) + Number(m.consider) === 0
            ? `${Number(newJobs[0]?.india ?? 0)} new India jobs, but none scored high enough to notify — all were low-fit or non-engineering roles.`
            : `${Number(newJobs[0]?.india ?? 0)} new India jobs → ${Number(m.apply)} APPLY, ${Number(m.consider)} CONSIDER. APPLY jobs push immediately; CONSIDER jobs go in the next digest.`,
    };
  }
}
