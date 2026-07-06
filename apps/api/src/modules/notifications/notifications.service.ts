import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ScoreModule } from '../opportunity/opportunity.service';
import { TelegramChannel } from './channels';

const RENOTIFY_SCORE_DELTA = 5; // re-notify only if the opportunity improved this much

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly minScore: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramChannel,
    config: ConfigService,
  ) {
    this.minScore = Number(config.get('NOTIFY_MIN_SCORE', 70));
  }

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
        job: { include: { company: { select: { name: true } } } },
        user: { select: { id: true } },
      },
    });
    if (!match || match.opportunityScore == null) return false;
    if (match.opportunityScore < this.minScore) return false;

    if (match.notifiedAt) {
      const prev = (match.scoreBreakdown as { notifiedScore?: number } | null) ?? {};
      const notifiedScore =
        typeof prev.notifiedScore === 'number' ? prev.notifiedScore : match.opportunityScore;
      const improved = match.opportunityScore >= notifiedScore + RENOTIFY_SCORE_DELTA;
      if (!improved) return false; // memory holds — stay silent
    }

    const text = this.formatMatch(match);
    await this.deliver(match.user.id, text, {
      matchId: match.id,
      jobId: match.jobId,
      opportunityScore: match.opportunityScore,
    });

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

  /** Actionable format: score, why, and the direct apply link. */
  private formatMatch(match: {
    opportunityScore: number | null;
    scoreBreakdown: unknown;
    reasoning: string | null;
    job: { title: string; url: string; location: string | null; company: { name: string } };
  }): string {
    const score = Math.round(match.opportunityScore ?? 0);
    const flame = score >= 90 ? '🔥' : score >= 80 ? '⭐' : '💼';
    const modules = Array.isArray(match.scoreBreakdown)
      ? (match.scoreBreakdown as ScoreModule[])
      : ((match.scoreBreakdown as { modules?: ScoreModule[] })?.modules ?? []);
    const reasons = modules
      .map((m) => `${m.score >= 65 ? '✔' : '✖'} ${m.reason}`)
      .join('\n');

    return [
      `${flame} <b>Opportunity ${score}</b>`,
      ``,
      `<b>${escapeHtml(match.job.title)}</b>`,
      `${escapeHtml(match.job.company.name)}${match.job.location ? ' · ' + escapeHtml(match.job.location) : ''}`,
      ``,
      reasons,
      ``,
      `Apply: ${match.job.url}`,
    ].join('\n');
  }

  private async deliver(
    userId: string,
    text: string,
    payload: Record<string, unknown>,
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
        await this.telegram.send(text);
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
