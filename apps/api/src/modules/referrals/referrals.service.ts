import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ReferralContact } from '@prisma/client';
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
          select: { id: true, name: true, website: true, githubOrg: true, careerPageUrl: true },
        },
      },
    });
    if (!job) throw new NotFoundException('Job not found');
    const companyName = job.company.name;

    const cached = await this.prisma.referralContact.findMany({
      where: { userId, companyName },
      orderBy: { priority: 'desc' },
    });
    const freshest = cached.reduce<number>((m, c) => Math.max(m, c.createdAt.getTime()), 0);
    if (cached.length > 0 && Date.now() - freshest < FRESH_MS) {
      // People are cached; skip the site fetch and lead the ladder with them.
      const channels: CompanyChannels = {
        emails: [],
        careerPageUrl: job.company.careerPageUrl,
        contactPageUrl: null,
      };
      return this.result(jobId, job.title, companyName, cached, channels, job.url, false);
    }

    // Re-discover. Failures degrade to "no source" rather than erroring the page.
    let contacts = cached;
    let rateLimited = false;
    let channels: CompanyChannels = {
      emails: [],
      careerPageUrl: job.company.careerPageUrl,
      contactPageUrl: null,
    };
    try {
      const userSkills = await this.userSkills(userId);
      // Company channels + GitHub people in parallel — both are ways in.
      const [discoveredChannels, gh] = await Promise.all([
        discoverCompanyChannels({
          website: job.company.website,
          careerPageUrl: job.company.careerPageUrl,
        }).catch(() => channels),
        discoverGithubPeople({
          companyName,
          website: job.company.website,
          githubOrg: job.company.githubOrg,
          token: this.githubToken,
        }),
      ]);
      channels = discoveredChannels;
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
        topSkills: (profile?.skills ?? [])
          .slice()
          .sort((a, b) => (b.yearsOfUse ?? 0) - (a.yearsOfUse ?? 0))
          .slice(0, 8)
          .map((s) => s.name),
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

  // ── internals ──

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
    return (profile?.skills ?? []).map((s) => s.name);
  }
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
