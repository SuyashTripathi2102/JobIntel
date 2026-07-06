import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AtsProvider, Company, CrawlTier, DiscoveryStage, Prisma } from '@prisma/client';
import type { CompanyCandidate, DiscoveryResult } from '@careeros/shared';
import { CRAWLABLE_PROVIDERS } from '@careeros/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { detectAts } from '../companies/ats-detector';

/**
 * Confidence signals → 0-100 score. The score answers: "how sure are we this
 * is a real, monitorable employer whose jobs we're actually receiving?"
 */
export interface ConfidenceSignals {
  websiteVerified: boolean;
  careerPageFound: boolean;
  atsDetected: boolean;
  jobsExtracted: boolean;
  monitoringHealthy: boolean;
}

const SIGNAL_WEIGHTS: Record<keyof ConfidenceSignals, number> = {
  websiteVerified: 15,
  careerPageFound: 20,
  atsDetected: 25,
  jobsExtracted: 25,
  monitoringHealthy: 15,
};

export function computeConfidence(signals: Partial<ConfidenceSignals>): number {
  let score = 0;
  for (const [key, weight] of Object.entries(SIGNAL_WEIGHTS)) {
    if (signals[key as keyof ConfidenceSignals]) score += weight;
  }
  return score;
}

/** Probe cooldowns: unresolved companies get retried, but with patience. */
const REPROBE_AFTER_DAYS: Partial<Record<DiscoveryStage, number>> = {
  [DiscoveryStage.DISCOVERED]: 7,
  [DiscoveryStage.WEBSITE_VERIFIED]: 7,
  [DiscoveryStage.CAREER_PAGE_FOUND]: 7,
  [DiscoveryStage.UNRESOLVABLE]: 30,
};

@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bulk-register candidates from any discovery source. Dedupe order:
   * ATS identity (strongest) → website host → case-insensitive name.
   * Returns how many were genuinely new — the top of the conversion funnel.
   */
  async bulkDiscover(source: string, candidates: CompanyCandidate[]) {
    let created = 0;
    let merged = 0;

    for (const c of candidates) {
      const detected = c.atsHintUrl ? detectAts(c.atsHintUrl) : null;

      let existing: Company | null = null;
      if (detected?.identifier) {
        existing = await this.prisma.company.findUnique({
          where: {
            atsProvider_atsIdentifier: {
              atsProvider: detected.provider,
              atsIdentifier: detected.identifier,
            },
          },
        });
      }
      if (!existing && c.website) {
        existing = await this.prisma.company.findFirst({
          where: { website: { contains: this.hostOf(c.website), mode: 'insensitive' } },
        });
      }
      if (!existing) {
        existing = await this.prisma.company.findFirst({
          where: { name: { equals: c.name, mode: 'insensitive' } },
        });
      }

      if (existing) {
        merged++;
        // Enrich blanks — never overwrite existing data with directory data.
        await this.prisma.company.update({
          where: { id: existing.id },
          data: {
            website: existing.website ?? c.website ?? undefined,
            industry: existing.industry ?? c.industry ?? undefined,
            country: existing.country ?? c.country ?? undefined,
            city: existing.city ?? c.city ?? undefined,
            teamSize: existing.teamSize ?? c.teamSize ?? undefined,
            description: existing.description ?? c.description ?? undefined,
          },
        });
        continue;
      }

      const monitorable =
        detected?.identifier && CRAWLABLE_PROVIDERS.includes(detected.provider);
      await this.prisma.company.create({
        data: {
          name: c.name,
          website: c.website ?? undefined,
          careerPageUrl: c.atsHintUrl ?? undefined,
          atsProvider: detected?.identifier ? detected.provider : AtsProvider.UNKNOWN,
          atsIdentifier: detected?.identifier ?? undefined,
          industry: c.industry ?? undefined,
          country: c.country ?? undefined,
          city: c.city ?? undefined,
          teamSize: c.teamSize ?? undefined,
          description: c.description ?? undefined,
          discoverySource: source,
          discoveryStage: monitorable ? DiscoveryStage.MONITORED : DiscoveryStage.DISCOVERED,
          confidence: computeConfidence({
            websiteVerified: false,
            atsDetected: !!detected?.identifier,
          }),
          confidenceSignals: { atsDetected: !!detected?.identifier } as object,
          nextCrawlAt: new Date(), // monitorable ones get crawled on the next tick
        },
      });
      created++;
    }

    this.logger.log(`bulk-discover[${source}]: ${created} new, ${merged} merged`);
    return { created, merged };
  }

  /** Companies the prober should work on now (batched, oldest-probed first). */
  probeDue(limit: number) {
    const now = Date.now();
    const or: Prisma.CompanyWhereInput[] = Object.entries(REPROBE_AFTER_DAYS).map(
      ([stage, days]) => ({
        discoveryStage: stage as DiscoveryStage,
        OR: [
          { lastProbedAt: null },
          { lastProbedAt: { lt: new Date(now - days * 24 * 60 * 60 * 1000) } },
        ],
      }),
    );
    return this.prisma.company.findMany({
      where: { OR: or },
      orderBy: [{ lastProbedAt: { sort: 'asc', nulls: 'first' } }],
      take: limit,
      select: {
        id: true,
        name: true,
        website: true,
        careerPageUrl: true,
        discoveryStage: true,
      },
    });
  }

  /** Apply what the prober found: stage transition + confidence recompute. */
  async applyResult(companyId: string, result: DiscoveryResult) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');

    const prevSignals = (company.confidenceSignals ?? {}) as Partial<ConfidenceSignals>;
    const atsProvider = result.atsProvider ? AtsProvider[result.atsProvider] : null;
    const monitorable =
      !!atsProvider &&
      !!result.atsIdentifier &&
      CRAWLABLE_PROVIDERS.includes(result.atsProvider!);

    // Detected board already claimed by another company row? Merge signal — skip claim.
    if (monitorable) {
      const claimed = await this.prisma.company.findUnique({
        where: {
          atsProvider_atsIdentifier: {
            atsProvider: atsProvider!,
            atsIdentifier: result.atsIdentifier!,
          },
        },
      });
      if (claimed && claimed.id !== companyId) {
        await this.prisma.company.update({
          where: { id: companyId },
          data: {
            discoveryStage: DiscoveryStage.UNRESOLVABLE,
            lastProbedAt: new Date(),
            confidenceSignals: {
              ...prevSignals,
              duplicateOf: claimed.id,
              probeLog: result.probeLog,
            } as object,
          },
        });
        return { stage: DiscoveryStage.UNRESOLVABLE, duplicateOf: claimed.id };
      }
    }

    const signals: Partial<ConfidenceSignals> = {
      ...prevSignals,
      websiteVerified: result.websiteVerified,
      careerPageFound: !!result.careerPageUrl,
      atsDetected: !!result.atsIdentifier,
    };

    let stage: DiscoveryStage;
    if (monitorable) stage = DiscoveryStage.MONITORED;
    else if (result.careerPageUrl) stage = DiscoveryStage.CAREER_PAGE_FOUND;
    else if (result.websiteVerified) stage = DiscoveryStage.WEBSITE_VERIFIED;
    else stage = DiscoveryStage.UNRESOLVABLE; // dead website — monthly retry

    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        discoveryStage: stage,
        lastProbedAt: new Date(),
        website: result.website ?? company.website,
        careerPageUrl: result.careerPageUrl ?? company.careerPageUrl,
        ...(monitorable
          ? {
              atsProvider: atsProvider!,
              atsIdentifier: result.atsIdentifier!,
              crawlTier: CrawlTier.WARM,
              nextCrawlAt: new Date(), // first crawl on the next 15-min tick
            }
          : {}),
        description: company.description ?? result.metadata?.description ?? undefined,
        confidence: computeConfidence(signals),
        confidenceSignals: { ...signals, probeLog: result.probeLog } as object,
      },
    });

    return { stage };
  }

  /** "https://www.stripe.com/about" → "stripe.com" — dedupe key for websites. */
  private hostOf(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  /** The Phase B success metric: % of discovered companies now monitored. */
  async funnelStats() {
    const rows = await this.prisma.company.groupBy({
      by: ['discoveryStage'],
      _count: { _all: true },
    });
    const byStage = Object.fromEntries(
      rows.map((r) => [r.discoveryStage, r._count._all]),
    ) as Record<string, number>;
    const total = rows.reduce((s, r) => s + r._count._all, 0);
    const monitored = byStage[DiscoveryStage.MONITORED] ?? 0;
    return {
      total,
      byStage,
      monitored,
      conversionRate: total > 0 ? Math.round((monitored / total) * 1000) / 10 : 0,
    };
  }
}
