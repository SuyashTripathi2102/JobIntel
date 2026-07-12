import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type ReferralContact } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LLM_PROVIDER } from '../ai/llm.provider';
import type { LlmProvider } from '../ai/llm.provider';
import type { ParsedResume } from '../resumes/resume-intelligence.service';
import { discoverGithubPeople } from './github-people';
import { rankReferrals, type ReferralRole } from './referral-ranking';
import { referralDraftPrompt, type DraftPerson } from './referral-draft';
import {
  buildContactLadder,
  buildPlan,
  buildStrategy,
  companyGraph,
  contactConfidence,
  whyBullets,
  type ContactLike,
} from './outreach-strategy';
import { discoverCompanyChannels, type CompanyChannels } from './company-contacts';
import { discoverBlogAuthors } from './blog-authors';
import { followUpPrompt, nextOutreachAction } from './referral-followup';

/** How long a company's discovered shortlist stays fresh before we re-crawl. */
const FRESH_MS = 14 * 24 * 60 * 60 * 1000;
const STATUSES = ['SUGGESTED', 'DRAFTED', 'CONTACTED', 'REPLIED', 'ARCHIVED'] as const;
type ReferralStatus = (typeof STATUSES)[number];

/**
 * The Referral Engine. For a given job it finds real people at that company
 * from PUBLIC GitHub, ranks who is worth contacting and why, and — on request —
 * drafts a personalised outreach message the user reviews and sends THEMSELVES.
 *
 * Boundaries, enforced here and in every layer below:
 *   • PUBLIC sources only (GitHub). No LinkedIn, no ToS-protected scraping.
 *   • Drafts, never sends. No bulk. No automation of the actual outreach.
 *   • Results are cached per (user, company) so a click doesn't re-crawl GitHub.
 */
@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);
  private readonly githubToken?: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {
    this.githubToken = config.get<string>('GITHUB_TOKEN') || undefined;
  }

  /** Ranked referral shortlist for a job — discovered fresh or served from cache. */
  async forJob(userId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: {
        title: true,
        url: true,
        company: {
          select: {
            id: true,
            name: true,
            website: true,
            githubOrg: true,
            careerPageUrl: true,
            engineeringBlogUrl: true,
            contactChannels: true,
          },
        },
      },
    });
    if (!job) throw new NotFoundException('Job not found');
    const companyName = job.company.name;

    // Company-level public channels (recruiting emails + eng-blog authors),
    // cached ~14d ON THE COMPANY so the ladder stays rich on every load — not
    // only right after a fresh people discovery.
    const channels = await this.ensureChannels(job.company);

    const cached = await this.prisma.referralContact.findMany({
      where: { userId, companyName },
      orderBy: { priority: 'desc' },
    });
    const freshest = cached.reduce<number>((m, c) => Math.max(m, c.createdAt.getTime()), 0);
    if (cached.length > 0 && Date.now() - freshest < FRESH_MS) {
      return this.result(jobId, job.title, companyName, cached, channels, job.url, false);
    }

    // Re-discover people. Failures degrade to the channel ladder, never an error.
    let contacts = cached;
    let rateLimited = false;
    try {
      const userSkills = await this.userSkills(userId);
      const gh = await discoverGithubPeople({
        companyName,
        website: job.company.website,
        githubOrg: job.company.githubOrg,
        token: this.githubToken,
      });
      const { org, people } = gh;
      rateLimited = gh.rateLimited;
      if (org && !job.company.githubOrg) {
        await this.prisma.company
          .update({ where: { id: job.company.id }, data: { githubOrg: org } })
          .catch(() => undefined);
      }
      const ranked = rankReferrals(people, { companyName, userSkills }).slice(0, 8);
      if (ranked.length > 0) {
        await Promise.all(
          ranked.map((r) =>
            this.prisma.referralContact.upsert({
              where: { userId_companyName_handle: { userId, companyName, handle: r.login } },
              // Preserve any draft/status the user already set — only refresh facts.
              update: {
                jobId,
                companyId: job.company.id,
                name: r.name ?? r.login,
                profileUrl: r.url,
                avatarUrl: r.avatarUrl,
                bio: r.bio,
                location: r.location,
                publicEmail: r.email,
                blogUrl: r.blog,
                twitter: r.twitter,
                role: r.role,
                signals: {
                  sharedTech: r.sharedTech,
                  viaRepos: r.viaRepos,
                  contributions: r.contributions,
                  publicMember: r.publicMember,
                },
                priority: r.priority,
                reason: r.reason,
              },
              create: {
                userId,
                jobId,
                companyId: job.company.id,
                companyName,
                source: 'GITHUB',
                name: r.name ?? r.login,
                handle: r.login,
                profileUrl: r.url,
                avatarUrl: r.avatarUrl,
                bio: r.bio,
                location: r.location,
                publicEmail: r.email,
                blogUrl: r.blog,
                twitter: r.twitter,
                role: r.role,
                signals: {
                  sharedTech: r.sharedTech,
                  viaRepos: r.viaRepos,
                  contributions: r.contributions,
                  publicMember: r.publicMember,
                },
                priority: r.priority,
                reason: r.reason,
              },
            }),
          ),
        );
        contacts = await this.prisma.referralContact.findMany({
          where: { userId, companyName },
          orderBy: { priority: 'desc' },
        });
      }
    } catch (err) {
      this.logger.warn(`Referral discovery failed for ${companyName}: ${String(err)}`);
    }

    return this.result(jobId, job.title, companyName, contacts, channels, job.url, rateLimited);
  }

  /** Generate (or regenerate) the personalised outreach draft for one contact. */
  async generateDraft(userId: string, contactId: string) {
    const contact = await this.prisma.referralContact.findFirst({
      where: { id: contactId, userId },
    });
    if (!contact) throw new NotFoundException('Contact not found');

    const job = contact.jobId
      ? await this.prisma.job.findUnique({
          where: { id: contact.jobId },
          select: { title: true },
        })
      : null;

    const profile = await this.activeProfile(userId);
    const fallbackName = (
      await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
    )?.name;

    const signals = (contact.signals ?? {}) as {
      sharedTech?: string[];
      viaRepos?: string[];
      publicMember?: boolean;
    };
    const person: DraftPerson = {
      name: contact.name,
      role: contact.role as ReferralRole,
      sharedTech: signals.sharedTech ?? [],
      via: (signals.viaRepos ?? [])[0] ?? null,
      publicMember: !!signals.publicMember,
    };

    const { system, prompt } = referralDraftPrompt(
      {
        name: profile?.fullName ?? fallbackName ?? 'the candidate',
        headline: profile?.headline ?? null,
        years: profile?.totalYearsExperience ?? null,
        topSkills: skillNames(profile?.skills).slice(0, 8),
        standoutProject: pickProject(profile),
      },
      { title: job?.title ?? 'the open role', company: contact.companyName },
      person,
    );

    const out = await this.llm.generateJson<{ subject: string; body: string }>(prompt, {
      system,
      temperature: 0.5,
      maxOutputTokens: 600,
    });
    const draft = `Subject: ${out.subject}\n\n${out.body}`;

    // Drafting doesn't undo a real-world contact the user already logged.
    const status: ReferralStatus =
      contact.status === 'CONTACTED' || contact.status === 'REPLIED'
        ? (contact.status as ReferralStatus)
        : 'DRAFTED';
    await this.prisma.referralContact.update({
      where: { id: contact.id },
      data: { draft, status },
    });
    return { subject: out.subject, body: out.body, draft };
  }

  /** Move a contact along the outreach pipeline (the seed of a referral CRM). */
  async setStatus(userId: string, contactId: string, status: string) {
    if (!STATUSES.includes(status as ReferralStatus)) {
      throw new BadRequestException(`status must be one of ${STATUSES.join(', ')}`);
    }
    const contact = await this.prisma.referralContact.findFirst({
      where: { id: contactId, userId },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    const updated = await this.prisma.referralContact.update({
      where: { id: contact.id },
      data: {
        status,
        ...(status === 'CONTACTED' && !contact.contactedAt ? { contactedAt: new Date() } : {}),
        ...(status === 'REPLIED' && !contact.repliedAt ? { repliedAt: new Date() } : {}),
      },
    });
    return this.toDto(updated);
  }

  /** The outreach CRM: every contact you've engaged, "needs action" first. */
  async outreachInbox(userId: string) {
    const rows = await this.prisma.referralContact.findMany({
      where: { userId, status: { in: ['DRAFTED', 'CONTACTED', 'REPLIED'] } },
    });
    const items = rows
      .map((c) => {
        const dto = this.toDto(c);
        return { ...dto, companyName: c.companyName, jobId: c.jobId };
      })
      // Due first, then by urgency, then by how long they've been waiting.
      .sort(
        (a, b) =>
          Number(b.nextAction.due) - Number(a.nextAction.due) ||
          b.nextAction.urgency - a.nextAction.urgency ||
          (b.nextAction.daysSince ?? 0) - (a.nextAction.daysSince ?? 0),
      );
    return {
      dueCount: items.filter((i) => i.nextAction.due).length,
      total: items.length,
      items,
    };
  }

  /** Draft a short, polite follow-up nudge for a contact you've already messaged. */
  async generateFollowUp(userId: string, contactId: string) {
    const contact = await this.prisma.referralContact.findFirst({
      where: { id: contactId, userId },
    });
    if (!contact) throw new NotFoundException('Contact not found');

    const job = contact.jobId
      ? await this.prisma.job.findUnique({ where: { id: contact.jobId }, select: { title: true } })
      : null;
    const userName =
      (await this.activeProfile(userId))?.fullName ??
      (await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ??
      'the candidate';

    const { system, prompt } = followUpPrompt(
      { name: userName },
      { title: job?.title ?? 'the open role', company: contact.companyName },
      { name: contact.name, role: contact.role as ReferralRole },
      contact.followUpCount + 1,
    );
    const out = await this.llm.generateJson<{ subject: string; body: string }>(prompt, {
      system,
      temperature: 0.5,
      maxOutputTokens: 400,
    });
    return { subject: out.subject, body: out.body, draft: `Subject: ${out.subject}\n\n${out.body}` };
  }

  /** Record that the user actually sent a follow-up (advances the cadence). */
  async logFollowUp(userId: string, contactId: string) {
    const contact = await this.prisma.referralContact.findFirst({
      where: { id: contactId, userId },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    const updated = await this.prisma.referralContact.update({
      where: { id: contact.id },
      data: {
        followUpCount: { increment: 1 },
        lastFollowUpAt: new Date(),
        // Logging a follow-up implies contact was made; never downgrade a reply.
        ...(contact.status === 'REPLIED' ? {} : { status: 'CONTACTED' }),
        ...(contact.contactedAt ? {} : { contactedAt: new Date() }),
      },
    });
    return this.toDto(updated);
  }

  // ── internals ──

  /**
   * Public contact channels for a company (recruiting emails + eng-blog authors),
   * cached ~14d on the company row so the "Ways in" ladder is consistently rich —
   * independent of the per-user people cache. Best-effort: a probe failure just
   * yields the careers-page rung.
   */
  private async ensureChannels(company: {
    id: string;
    website: string | null;
    careerPageUrl: string | null;
    engineeringBlogUrl: string | null;
    contactChannels: Prisma.JsonValue;
  }): Promise<CompanyChannels> {
    const stored = (company.contactChannels ?? null) as CompanyChannels | null;
    const fresh = stored?.probedAt && Date.now() - Date.parse(stored.probedAt) < FRESH_MS;
    if (fresh && stored) {
      return { ...stored, careerPageUrl: company.careerPageUrl ?? stored.careerPageUrl ?? null };
    }

    let channels: CompanyChannels = {
      emails: [],
      careerPageUrl: company.careerPageUrl,
      contactPageUrl: null,
      blogUrl: null,
      blogAuthors: [],
    };
    try {
      const [ch, blog] = await Promise.all([
        discoverCompanyChannels({
          website: company.website,
          careerPageUrl: company.careerPageUrl,
        }).catch(() => null),
        discoverBlogAuthors({
          engineeringBlogUrl: company.engineeringBlogUrl,
          website: company.website,
        }).catch(() => null),
      ]);
      channels = {
        emails: ch?.emails ?? [],
        careerPageUrl: company.careerPageUrl,
        contactPageUrl: ch?.contactPageUrl ?? null,
        blogUrl: blog?.blogUrl ?? null,
        blogAuthors: blog?.authors ?? [],
        probedAt: new Date().toISOString(),
      };
      await this.prisma.company
        .update({
          where: { id: company.id },
          data: { contactChannels: channels as unknown as Prisma.InputJsonValue },
        })
        .catch(() => undefined);
    } catch (err) {
      this.logger.warn(`Channel probe failed for company ${company.id}: ${String(err)}`);
    }
    return channels;
  }

  private result(
    jobId: string,
    jobTitle: string,
    companyName: string,
    rows: ReferralContact[],
    channels: CompanyChannels,
    jobUrl: string | null,
    rateLimited: boolean,
  ) {
    const dtos = rows.map((c) => this.toDto(c));
    const likes: ContactLike[] = dtos.map((c) => ({
      id: c.id,
      name: c.name,
      role: c.role as ReferralRole,
      priority: c.priority,
      publicMember: c.publicMember,
      sharedTech: c.sharedTech,
      email: c.email,
      blog: c.blog,
      twitter: c.twitter,
      contributions: c.contributions,
    }));
    const contacts = dtos.map((c, i) => ({
      ...c,
      why: whyBullets(likes[i], companyName),
      confidence: contactConfidence(likes[i]),
    }));
    const strategy = buildStrategy(likes);
    const primaryPriority = likes.reduce((m, l) => Math.max(m, l.priority), 0);
    return {
      jobTitle,
      companyName,
      contacts,
      graph: companyGraph(likes),
      strategy,
      plan: buildPlan(strategy, { jobId, hasContacts: likes.length > 0, primaryPriority }),
      // The never-dead-end ladder: people → company channels → apply anyway.
      contactLadder: buildContactLadder(likes, channels, { companyName, jobUrl }),
      channels: { emails: channels.emails },
      // Honest, specific — never "no presence" when we were simply throttled, and
      // never a dead end (the ladder below always has a next action).
      searchedNote:
        rows.length > 0
          ? null
          : rateLimited
            ? `GitHub lookups are rate-limited right now, so engineers couldn't be fetched. Set a GITHUB_TOKEN to raise the limit. Use the ways in below meanwhile.`
            : `CareerOS searched ${companyName}'s GitHub org, public contributors, and org repositories — no verified engineers found automatically. Use the ways in below.`,
      message: null,
    };
  }

  private toDto(c: ReferralContact) {
    const s = (c.signals ?? {}) as {
      sharedTech?: string[];
      viaRepos?: string[];
      publicMember?: boolean;
      contributions?: number;
    };
    return {
      id: c.id,
      name: c.name,
      handle: c.handle,
      role: c.role,
      priority: c.priority,
      reason: c.reason,
      profileUrl: c.profileUrl,
      avatarUrl: c.avatarUrl,
      bio: c.bio,
      location: c.location,
      email: c.publicEmail,
      blog: c.blogUrl,
      twitter: c.twitter,
      sharedTech: s.sharedTech ?? [],
      via: (s.viaRepos ?? [])[0] ?? null,
      publicMember: !!s.publicMember,
      contributions: s.contributions ?? 0,
      status: c.status,
      draft: c.draft,
      contactedAt: c.contactedAt,
      followUpCount: c.followUpCount,
      nextAction: nextOutreachAction({
        status: c.status,
        contactedAt: c.contactedAt,
        repliedAt: c.repliedAt,
        followUpCount: c.followUpCount,
        lastFollowUpAt: c.lastFollowUpAt,
      }),
    };
  }

  private async activeProfile(userId: string): Promise<ParsedResume | null> {
    const v = await this.prisma.resumeVersion.findFirst({
      where: { resume: { userId, isPrimary: true }, activatedAt: { not: null } },
      orderBy: { versionNumber: 'desc' },
      select: { confirmedProfile: true, parsedJson: true },
    });
    return (
      (v?.confirmedProfile as ParsedResume | null) ??
      (v?.parsedJson as { structured?: ParsedResume } | null)?.structured ??
      null
    );
  }

  private async userSkills(userId: string): Promise<string[]> {
    const profile = await this.activeProfile(userId);
    return skillNames(profile?.skills);
  }
}

/**
 * The confirmed profile stores skills as a string[] (ResumeProfile), but the
 * parsed profile uses {name}[] (ParsedResume). Handle both, and never emit an
 * undefined — a single bad entry used to crash rankReferrals ('.trim' of
 * undefined) and silently zero out every company's referrals.
 */
function skillNames(skills: unknown): string[] {
  if (!Array.isArray(skills)) return [];
  return skills
    .map((s) =>
      typeof s === 'string'
        ? s
        : s && typeof s === 'object' && 'name' in s
          ? String((s as { name: unknown }).name ?? '')
          : '',
    )
    .filter((s) => s.trim().length > 0);
}

/** The project with the richest stack — the one worth name-dropping in outreach. */
function pickProject(profile: ParsedResume | null): string | null {
  const projects = profile?.projects ?? [];
  if (!projects.length) return null;
  const best = projects
    .slice()
    .sort((a, b) => (b.technologies?.length ?? 0) - (a.technologies?.length ?? 0))[0];
  const desc = best.description ? ` — ${best.description.split('. ')[0]}` : '';
  return `${best.name}${desc}`.slice(0, 160);
}
