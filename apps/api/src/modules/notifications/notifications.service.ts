import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { jobMatchesCountries, locationTags } from '../matching/location-filter';
import { companyTier, isEvergreen } from '../opportunity/company-tier';
import type { ScoreModule } from '../opportunity/opportunity.service';
import { InlineButton, TelegramChannel } from './channels';

// Telegram caps a message at 4096 characters; the rest of the card needs room.
const REASONING_MAX_CHARS = 2500;
import { decide, Decision, freshnessLine, salaryLine } from './decision';

const RENOTIFY_SCORE_DELTA = 5; // re-notify only if the opportunity improved this much

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly minScore: number;
  private readonly maxAgeDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramChannel,
    config: ConfigService,
  ) {
    this.minScore = Number(config.get('NOTIFY_MIN_SCORE', 70));
    this.maxAgeDays = Number(config.get('NOTIFY_MAX_AGE_DAYS')) || 30;
    this.dashboardUrl = config.get<string>('CORS_ORIGIN') || null;
  }

  private readonly dashboardUrl: string | null;

  /**
   * Notification gate + memory (the "don't spam me" contract):
   * - only matches at/above NOTIFY_MIN_SCORE;
   * - never twice for the same match, UNLESS the job's content changed
   *   (salary appeared, title changed) or the opportunity score improved
   *   meaningfully — then exactly once more.
   */
  async maybeNotifyMatch(matchId: string): Promise<boolean> {
    const match = await this.prisma.jobMatch.findUnique({
      where: { id: matchId },
      include: {
        job: {
          include: {
            company: {
              select: {
                name: true,
                atsProvider: true,
                atsIdentifier: true,
                careerPageUrl: true,
              },
            },
          },
        },
        user: { select: { id: true, preference: { select: { countries: true } } } },
      },
    });
    if (!match || match.opportunityScore == null) return false;
    if (match.opportunityScore < this.minScore) return false;

    // Preferred-countries gate (defense in depth — matching also filters, but
    // pre-existing matches and rescore sweeps must respect it too).
    const countries = match.user.preference?.countries ?? [];
    if (!jobMatchesCountries(countries, match.job)) {
      this.logger.log(
        `holding notification for ${match.job.company.name} — outside preferred countries [${countries.join(',')}]`,
      );
      return false;
    }

    // Staleness gate — context-aware: evergreen employers (big tech) and
    // companies observably still hiring get a longer window; everyone else's
    // stale postings stay searchable but never interrupt your phone.
    const tier = companyTier(match.job.company.name);
    const recentJobs14d = await this.prisma.job.count({
      where: {
        companyId: match.job.companyId,
        firstSeenAt: { gte: new Date(Date.now() - 14 * 86_400_000) },
      },
    });
    const evergreen = isEvergreen(tier);
    const activelyHiring = recentJobs14d >= 3;
    const effectiveMaxAge = evergreen || activelyHiring ? this.maxAgeDays * 2 : this.maxAgeDays;

    const ageDays =
      (Date.now() - (match.job.postedAt ?? match.job.firstSeenAt).getTime()) / 86_400_000;
    if (ageDays > effectiveMaxAge) {
      this.logger.log(
        `holding notification for "${match.job.title}" — posted ${Math.round(ageDays)}d ago (max ${effectiveMaxAge}d${evergreen ? ', evergreen' : ''})`,
      );
      return false;
    }

    // Board copy of a directly-crawled company? Hold — the official posting
    // (with the real apply link + full description) arrives within the
    // company's crawl-tier interval and notifies then. Never send a user to
    // an aggregator when we monitor the source.
    const isBoardCopy = match.job.externalId.startsWith('remoteok-');
    if (isBoardCopy && match.job.company.atsIdentifier) {
      this.logger.log(
        `holding board-copy notification for ${match.job.company.name} — official posting incoming`,
      );
      return false;
    }

    if (match.notifiedAt) {
      const prev = (match.scoreBreakdown as { notifiedScore?: number } | null) ?? {};
      const notifiedScore =
        typeof prev.notifiedScore === 'number' ? prev.notifiedScore : match.opportunityScore;
      const improved = match.opportunityScore >= notifiedScore + RENOTIFY_SCORE_DELTA;
      if (!improved) return false; // memory holds — stay silent
    }

    // Twin-posting hint: same company re-lists the same role (onsite/remote
    // variants). Without this, two identical scores look like a bug
    // (2026-07-08, the Brigit "66 × 2" confusion).
    const titleRoot = match.job.title.split(',')[0].trim();
    const twinCount = await this.prisma.job.count({
      where: {
        companyId: match.job.companyId,
        status: 'ACTIVE',
        title: { startsWith: titleRoot },
      },
    });

    // The decision gate reads the STORED verdict — it does not recompute one.
    // Until 2026-07-10 this path called decide() while the dashboard filtered
    // on opportunityScore, so a marketing role blocked here still appeared
    // under "Apply today". One decision, one source, every consumer.
    const modules = Array.isArray(match.scoreBreakdown)
      ? (match.scoreBreakdown as unknown as ScoreModule[])
      : ((match.scoreBreakdown as { modules?: ScoreModule[] })?.modules ?? []);

    // Only APPLY interrupts. NEEDS_REVIEW is visible on the dashboard and
    // never pushed; SKIP stays in-app as audit history.
    if (match.verdict !== 'APPLY') {
      this.logger.log(
        `holding notification for "${match.job.title}" — verdict ${match.verdict ?? 'UNDECIDED'} ` +
          `(${match.verdictCode ?? 'no code'}: ${match.verdictReason?.split('\n')[0] ?? 'no reason recorded'})`,
      );
      return false;
    }

    // Already acted on it? Never tell someone to apply to a job they applied
    // to (2026-07-10). SAVED means "later" and may still be nudged; anything
    // past it means done.
    if (await this.alreadyActedOn(match.user.id, match.jobId)) {
      this.logger.log(`holding notification for "${match.job.title}" — already in your applications`);
      return false;
    }

    const decision: Decision = {
      verdict: 'APPLY',
      code: (match.verdictCode as Decision['code']) ?? 'TARGET_ROLE_ELIGIBLE',
      banner: `🟢 ${Math.round(match.opportunityScore ?? 0)}/100`,
      action: '✅ APPLY',
      reasons: match.verdictReason?.split('\n').filter(Boolean) ?? [],
    };

    const text = this.formatMatch(match, twinCount, decision);
    await this.deliver(
      match.user.id,
      text,
      {
        matchId: match.id,
        jobId: match.jobId,
        opportunityScore: match.opportunityScore,
      },
      this.buildButtons(match.job),
    );

    await this.prisma.jobMatch.update({
      where: { id: match.id },
      data: {
        notifiedAt: new Date(),
        scoreBreakdown: {
          modules: match.scoreBreakdown as object,
          notifiedScore: match.opportunityScore,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    return true;
  }

  /**
   * Has the user already acted on this job? SAVED is a bookmark, not an action,
   * so it does not suppress a nudge — every later status does.
   */
  private async alreadyActedOn(userId: string, jobId: string): Promise<boolean> {
    const application = await this.prisma.application.findUnique({
      where: { userId_jobId: { userId, jobId } },
      select: { status: true },
    });
    return application != null && application.status !== 'SAVED';
  }

  /**
   * Decision-first format (ROADMAP Phase D-1): verdict + why in <10 seconds.
   * The job is evidence; the decision is the product.
   */
  private formatMatch(
    match: {
      opportunityScore: number | null;
      overallScore: number;
      missingSkills: string[];
      scoreBreakdown: unknown;
      reasoning: string | null;
      job: {
        title: string;
        url: string;
        externalId: string;
        location: string | null;
        workMode: string | null;
        postedAt: Date | null;
        firstSeenAt: Date;
        salaryMin: number | null;
        salaryMax: number | null;
        currency: string | null;
        company: {
          name: string;
          atsProvider: string;
          atsIdentifier: string | null;
          careerPageUrl: string | null;
        };
      };
    },
    twinCount = 1,
    decision: Decision,
  ): string {
    const lines: string[] = [
      `<b>${decision.action} · ${decision.banner}</b>`,
      ``,
      `<b>${escapeHtml(match.job.title)}</b>`,
      `${escapeHtml(match.job.company.name)}${(() => {
        const tags = locationTags(match.job.location, match.job.workMode);
        return tags ? ' · ' + escapeHtml(tags) : '';
      })()}`,
      `${freshnessLine(match.job.postedAt, match.job.firstSeenAt)} · ${salaryLine(match.job.salaryMin, match.job.salaryMax, match.job.currency)}`,
      ``,
      `🎯 Resume match: <b>${Math.round(match.overallScore)}%</b>`,
    ];

    if (match.missingSkills.length > 0) {
      lines.push(`❌ Missing: ${escapeHtml(match.missingSkills.join(', '))}`);
    }

    lines.push(``, `<b>Why:</b>`);
    for (const reason of decision.reasons) lines.push(`• ${escapeHtml(reason)}`);

    if (match.reasoning) {
      // Full reasoning — the "why" is the product. Telegram allows 4096 chars,
      // so cap defensively and only ever at a sentence boundary: a hard cut
      // mid-sentence ("whereas you only…") is worse than saying less.
      const { text, truncated } = truncateAtSentence(match.reasoning, REASONING_MAX_CHARS);
      lines.push(``, `<i>${escapeHtml(text)}</i>`);
      if (truncated) lines.push(`<i>Full analysis on the dashboard →</i>`);
    }

    if (twinCount > 1) {
      lines.push(``, `ℹ️ ${twinCount} postings of this role at ${escapeHtml(match.job.company.name)}`);
    }

    lines.push(``, this.officialApplyLine(match.job));
    return lines.join('\n');
  }

  /** URL buttons (callback buttons need bot polling — Phase D-4). */
  private buildButtons(job: {
    id: string;
    url: string;
    externalId: string;
    company: { atsProvider: string; atsIdentifier: string | null; careerPageUrl: string | null };
  }) {
    const isBoardCopy = job.externalId.startsWith('remoteok-');
    const applyUrl = isBoardCopy
      ? (boardRootUrl(job.company.atsProvider, job.company.atsIdentifier) ??
        job.company.careerPageUrl ??
        job.url)
      : job.url;

    const rows = [[{ text: '🚀 Apply', url: applyUrl }]];
    // "Read more": full description + why + track-application, on the dashboard.
    if (this.dashboardUrl?.startsWith('http')) {
      rows[0].push({ text: '📄 Details', url: `${this.dashboardUrl}/jobs/${job.id}` });
    }
    // "All openings" MUST point at the ATS board we actually crawl — not the
    // company's branded careers page, which shows different/cached jobs and
    // makes the notified job look "missing" (2026-07-09, AbhiBus report).
    const boardUrl =
      boardRootUrl(job.company.atsProvider, job.company.atsIdentifier) ??
      job.company.careerPageUrl;
    if (boardUrl && boardUrl !== applyUrl) {
      rows.push([{ text: '🏢 All openings', url: boardUrl }]);
    }
    return rows;
  }

  /**
   * The official-link rule: never route through an aggregator when a better
   * link exists. Direct-crawl jobs already carry the official URL; board
   * copies fall back to the company's ATS board → career page → board link
   * (honestly labeled) in that order.
   */
  private officialApplyLine(job: {
    url: string;
    externalId: string;
    company: { atsProvider: string; atsIdentifier: string | null; careerPageUrl: string | null };
  }): string {
    const isBoardCopy = job.externalId.startsWith('remoteok-');
    if (!isBoardCopy) return `Apply: ${job.url}`;

    const board = boardRootUrl(job.company.atsProvider, job.company.atsIdentifier);
    if (board) return `Apply (official board): ${board}`;

    const career = job.company.careerPageUrl;
    if (career && !career.toLowerCase().includes('remoteok')) {
      return `Apply (official careers page): ${career}`;
    }
    return `Apply (via RemoteOK — no official page found yet): ${job.url}`;
  }

  private async deliver(
    userId: string,
    text: string,
    payload: Record<string, unknown>,
    buttons?: InlineButton[][],
  ): Promise<void> {
    // Always recorded in-app; pushed to any configured channel.
    await this.prisma.notification.create({
      data: {
        userId,
        type: NotificationType.NEW_MATCHES,
        payload: { text, ...payload } as Prisma.InputJsonValue,
      },
    });

    if (this.telegram.isConfigured()) {
      try {
        await this.telegram.send(text, { buttons });
      } catch (err) {
        this.logger.error(`telegram delivery failed: ${err instanceof Error ? err.message : err}`);
      }
    } else {
      this.logger.log(`[notification] (telegram not configured)\n${text.replace(/<[^>]+>/g, '')}`);
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Cut long reasoning at the last complete sentence inside `max`. Falls back to
 * a word boundary only when the text has no sentence break at all — never
 * mid-word, and never mid-sentence.
 */
export function truncateAtSentence(
  s: string,
  max: number,
): { text: string; truncated: boolean } {
  const trimmed = s.trim();
  if (trimmed.length <= max) return { text: trimmed, truncated: false };

  const slice = trimmed.slice(0, max);
  // Refuse any boundary so early it would throw away most of the explanation —
  // a four-character "Ok.…" is not a summary.
  const floor = max * 0.4;

  const sentence = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('.\n'),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
  );
  if (sentence > floor) return { text: slice.slice(0, sentence + 1), truncated: true };

  const word = slice.lastIndexOf(' ');
  if (word > floor) return { text: `${slice.slice(0, word).trimEnd()}…`, truncated: true };

  // A single unbroken run of text: cut it and say so.
  return { text: `${slice.slice(0, max - 1).trimEnd()}…`, truncated: true };
}

/** Public board roots per ATS — official landing pages for a company's jobs. */
function boardRootUrl(provider: string, identifier: string | null): string | null {
  if (!identifier) return null;
  switch (provider) {
    case 'GREENHOUSE':
      return `https://boards.greenhouse.io/${identifier}`;
    case 'LEVER':
      return `https://jobs.lever.co/${identifier}`;
    case 'ASHBY':
      return `https://jobs.ashbyhq.com/${identifier}`;
    case 'WORKABLE':
      return `https://apply.workable.com/${identifier}`;
    case 'SMARTRECRUITERS':
      return `https://jobs.smartrecruiters.com/${identifier}`;
    case 'RECRUITEE':
      return `https://${identifier}.recruitee.com`;
    case 'BREEZY':
      return `https://${identifier}.breezy.hr`;
    default:
      return null;
  }
}
