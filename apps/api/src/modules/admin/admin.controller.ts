import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CrawlStatus, JobStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';

const QUEUES = [
  'refresh-all',
  'crawl-company',
  'crawl-board',
  'discovery-fanout',
  'discover-company',
  'seed-import',
  'embed-jobs',
  'match-new-jobs',
  'generate-matches',
  'derive-intel',
];

/**
 * Internal health dashboard (ChatGPT-review request, C.5): one endpoint that
 * answers "is the machine alive and what did it do today" — invaluable the
 * first time something breaks silently on the VPS.
 */
@Controller('admin/health')
export class AdminController {
  private readonly redisUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.redisUrl = config.get<string>('REDIS_URL', 'redis://localhost:6379');
  }

  @Get()
  async health() {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      companiesByStage,
      activeJobs,
      jobsToday,
      matchesTotal,
      notificationsToday,
      runs24h,
      failingCompanies,
      lastRun,
    ] = await Promise.all([
      this.prisma.company.groupBy({ by: ['discoveryStage'], _count: { _all: true } }),
      this.prisma.job.count({ where: { status: JobStatus.ACTIVE } }),
      this.prisma.job.count({ where: { firstSeenAt: { gte: dayAgo } } }),
      this.prisma.jobMatch.count(),
      this.prisma.notification.count({ where: { createdAt: { gte: dayAgo } } }),
      this.prisma.crawlRun.groupBy({
        by: ['status'],
        where: { startedAt: { gte: dayAgo } },
        _count: { _all: true },
      }),
      // Companies whose last 3 runs ALL failed — the "silently broken" list.
      this.prisma.$queryRaw<{ id: string; name: string; fails: bigint }[]>`
        SELECT c.id, c.name, count(*) AS fails FROM companies c
        JOIN LATERAL (
          SELECT status FROM crawl_runs r
          WHERE r."companyId" = c.id ORDER BY r."startedAt" DESC LIMIT 3
        ) recent ON true
        WHERE recent.status = 'FAILED'
        GROUP BY c.id, c.name HAVING count(*) >= 3
      `,
      this.prisma.crawlRun.findFirst({
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true, source: true, status: true },
      }),
    ]);

    const queues: Record<string, unknown> = {};
    for (const name of QUEUES) {
      const q = new Queue(name, { connection: { url: this.redisUrl } });
      try {
        const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'failed');
        queues[name] = counts;
      } catch {
        queues[name] = { error: 'unreachable' };
      } finally {
        await q.close().catch(() => undefined);
      }
    }

    const succeeded =
      runs24h.find((r) => r.status === CrawlStatus.SUCCEEDED)?._count._all ?? 0;
    const totalRuns = runs24h.reduce((s, r) => s + r._count._all, 0);

    return {
      timestamp: new Date().toISOString(),
      companies: Object.fromEntries(
        companiesByStage.map((r) => [r.discoveryStage, r._count._all]),
      ),
      jobs: { active: activeJobs, newLast24h: jobsToday },
      matches: matchesTotal,
      notificationsLast24h: notificationsToday,
      crawls24h: {
        total: totalRuns,
        successRate: totalRuns > 0 ? Math.round((succeeded / totalRuns) * 100) : null,
        lastRun,
      },
      failingCompanies: failingCompanies.map((c) => ({ id: c.id, name: c.name })),
      queues,
    };
  }
}
