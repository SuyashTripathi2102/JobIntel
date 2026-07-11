import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { PDFParse } from 'pdf-parse';
import { checkAts } from './ats-check';
import { classifySkillOrigins, isNamedInResume, manuallyAdded } from './skill-provenance';
import { buildMasterHtml, scoreResume, tailorForJob, type ResumeChange } from './resume-builder';
import { atsKeywordAudit } from '../matching/ats-keywords';
import { MatchingService } from '../matching/matching.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { ParsedResume } from './resume-intelligence.service';
import { ResumesRepository } from './resumes.repository';
import { PARSE_RESUME_QUEUE } from './resumes.processor';

const MAX_RESUMES_PER_USER = 10;

/** What the user reviews and corrects before a resume starts matching jobs. */
export interface ResumeProfile {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  headline: string | null;
  totalYearsExperience: number | null;
  targetRoles: string[];
  skills: string[];
  experience: ParsedResume['experience'];
  projects: ParsedResume['projects'];
  education: ParsedResume['education'];
  summaryForMatching: string;
}

/**
 * What the review screen renders: the profile, plus skills a re-parse found in
 * the resume that the confirmed profile is missing. Suggestions are never
 * stored — the user accepts them, or they stay suggestions.
 */
export interface ReviewableProfile extends ResumeProfile {
  suggestedSkills: string[];
}

// PDFs frequently embed NUL and other control characters, which Postgres
// JSONB rejects ("unsupported Unicode escape sequence"). Strip everything in
// the Cc (control) category except \n, \r and \t.
const CONTROL_CHARS = /(?![\n\r\t])\p{Cc}/gu;

@Injectable()
export class ResumesService {
  private readonly logger = new Logger(ResumesService.name);

  constructor(
    private readonly resumes: ResumesRepository,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
    // Circular: MatchingModule → NotificationsModule → ResumesModule.
    @Inject(forwardRef(() => MatchingService)) private readonly matching: MatchingService,
    @InjectQueue(PARSE_RESUME_QUEUE) private readonly parseQueue: Queue,
  ) {}

  list(userId: string) {
    return this.resumes.findAllForUser(userId);
  }

  async get(userId: string, resumeId: string) {
    const resume = await this.resumes.findByIdForUser(resumeId, userId);
    if (!resume) throw new NotFoundException('Resume not found');
    return resume;
  }

  /**
   * Upload flow: PDF → MinIO → new ResumeVersion with extracted raw text.
   * Structured AI extraction (skills/experience/embeddings) is a Phase 5
   * worker job — rawText stored now is its input, so no re-download needed.
   */
  async upload(userId: string, file: Express.Multer.File, resumeId?: string, title?: string) {
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Only PDF files are supported');
    }

    // Extract before touching the DB — a bad PDF must not leave orphan rows.
    const { raw, clean: rawText } = await this.extractText(file.buffer);

    // CareerOS has a vision fallback; no ATS does. Judge the file the way the
    // market will, and tell the user before they apply with it.
    const ats = checkAts(raw);
    if (ats.verdict !== 'SAFE') {
      this.logger.warn(
        `ATS check ${ats.verdict} (${ats.score}/100, letters ${ats.letterRatio}) for user ${userId}`,
      );
    }

    let resume;
    let createdNew = false;
    if (resumeId) {
      resume = await this.resumes.findByIdForUser(resumeId, userId);
      if (!resume) throw new NotFoundException('Resume not found');
    } else {
      const count = await this.resumes.countForUser(userId);
      if (count >= MAX_RESUMES_PER_USER) {
        throw new BadRequestException(`Limit of ${MAX_RESUMES_PER_USER} resumes reached`);
      }
      // First resume becomes primary automatically.
      resume = await this.resumes.create(userId, title ?? 'My Resume', count === 0);
      createdNew = true;
    }

    try {
      const fileKey = `resumes/${userId}/${resume.id}/${randomUUID()}.pdf`;
      await this.storage.upload(fileKey, file.buffer, 'application/pdf');

      const version = await this.resumes.addVersion(resume.id, fileKey, {
        rawText,
        extractedAt: new Date().toISOString(),
      });

      // ATS provenance travels with the version, so resume-performance
      // analytics can later ask "did the readable one get more interviews?".
      await this.prisma.resumeVersion.update({
        where: { id: version.id },
        data: { atsScore: ats.score, atsVerdict: ats.verdict },
      });

      // Kick off AI parsing (structured extraction + skills + embedding).
      await this.parseQueue.add(
        'parse',
        { resumeVersionId: version.id },
        { jobId: `parse-${version.id}`, removeOnComplete: true, removeOnFail: true },
      );

      return { resumeId: resume.id, version, ats };
    } catch (err) {
      // Storage/DB failed after we created the resume shell — undo it.
      if (createdNew) await this.resumes.delete(resume.id).catch(() => undefined);
      throw err;
    }
  }

  /**
   * The profile the user reviews before activation. Contact details are pulled
   * from the raw text rather than the LLM: they are exact strings, and an
   * invented phone number is worse than a missing one.
   */
  async profile(userId: string, resumeVersionId: string): Promise<ReviewableProfile> {
    const version = await this.ownedVersion(userId, resumeVersionId);
    const parsedJson = version.parsedJson as {
      rawText?: string;
      structured?: ParsedResume;
    } | null;
    const structured = parsedJson?.structured;
    if (!structured) {
      throw new BadRequestException('This version has not been parsed yet');
    }
    const raw = parsedJson?.rawText ?? '';
    const confirmed = version.confirmedProfile as ResumeProfile | null;

    // A re-parse (after a parser fix) can find skills the confirmed profile
    // never had — the 2026-07-10 prompt bug dropped HTML5, CSS3, RESTful APIs
    // and OAuth 2.0 from a resume that named all four. Surface them for the
    // user to accept. Never merge them in silently: a profile that changes
    // without the user's knowledge is the failure the review screen exists to
    // prevent, and it works the same whether the change is wrong or right.
    if (confirmed) {
      const have = new Set(confirmed.skills.map((s) => s.toLowerCase()));
      const suggestedSkills = structured.skills
        .map((s) => s.name)
        .filter((name) => !have.has(name.toLowerCase()) && isNamedInResume(name, raw));
      return { ...confirmed, suggestedSkills };
    }

    return {
      suggestedSkills: [],
      fullName: structured.fullName,
      email: raw.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? null,
      phone: raw.match(/\+?\d[\d\s()-]{8,14}\d/)?.[0]?.trim() ?? null,
      headline: structured.headline,
      totalYearsExperience: structured.totalYearsExperience,
      // Seeded from real titles the resume contains; the user edits from there.
      targetRoles: [
        ...new Set([structured.headline, ...structured.experience.map((e) => e.title)]),
      ].filter((r): r is string => !!r),
      skills: structured.skills.map((s) => s.name),
      experience: structured.experience,
      projects: structured.projects,
      education: structured.education,
      summaryForMatching: structured.summaryForMatching,
    };
  }

  /**
   * The resume-tailoring pipeline for one job. Master HTML (from the confirmed
   * profile — real bullets, never invented) → company transform (exact ATS
   * keywords the user already has) → three-audience scores before/after →
   * stored in the Resume Library. PDF is produced client-side (print), so the
   * HTML stays the source of truth.
   */
  /**
   * The master resume — the user's canonical HTML if they've set one (source of
   * truth, preserving their real formatting), else generated from the confirmed
   * profile. `source` lets the UI render a full custom document vs a styled
   * fragment, and tells the user which they're looking at.
   */
  async getMaster(userId: string): Promise<{ html: string; source: 'custom' | 'generated' }> {
    const resume = await this.prisma.resume.findFirst({
      where: { userId, isPrimary: true },
      select: { masterHtml: true },
    });
    if (resume?.masterHtml) return { html: resume.masterHtml, source: 'custom' };

    const version = await this.prisma.resumeVersion.findFirst({
      where: { resume: { userId, isPrimary: true }, activatedAt: { not: null } },
      orderBy: { versionNumber: 'desc' },
      select: { confirmedProfile: true },
    });
    const profile = version?.confirmedProfile as ResumeProfile | null;
    if (!profile) {
      throw new BadRequestException('Upload and activate a resume first, then set your master.');
    }
    return { html: buildMasterHtml(profile), source: 'generated' };
  }

  /** Store the user's own resume HTML as the master (source of truth for tailoring). */
  async setMaster(userId: string, html: string): Promise<{ ok: true; source: 'custom' }> {
    if (!html || html.trim().length < 40) {
      throw new BadRequestException('Paste your resume HTML (the full document).');
    }
    if (html.length > 400_000) {
      throw new BadRequestException('That HTML is unusually large — paste just the resume document.');
    }
    const resume = await this.prisma.resume.findFirst({
      where: { userId, isPrimary: true },
      select: { id: true },
    });
    if (!resume) throw new BadRequestException('Upload a resume first, then set your master HTML.');
    await this.prisma.resume.update({ where: { id: resume.id }, data: { masterHtml: html } });
    return { ok: true, source: 'custom' };
  }

  /** Revert to the profile-generated master (clears the custom HTML). */
  async clearMaster(userId: string): Promise<{ ok: true; source: 'generated' }> {
    const resume = await this.prisma.resume.findFirst({
      where: { userId, isPrimary: true },
      select: { id: true },
    });
    if (resume) await this.prisma.resume.update({ where: { id: resume.id }, data: { masterHtml: null } });
    return { ok: true, source: 'generated' };
  }

  async tailorResume(userId: string, jobId: string) {
    const resume = await this.prisma.resume.findFirst({
      where: { userId, isPrimary: true },
      select: { masterHtml: true },
    });
    const version = await this.prisma.resumeVersion.findFirst({
      where: { resume: { userId, isPrimary: true }, activatedAt: { not: null } },
      orderBy: { versionNumber: 'desc' },
      select: { confirmedProfile: true, parsedJson: true },
    });
    const profile = version?.confirmedProfile as ResumeProfile | null;
    if (!profile) {
      throw new BadRequestException('Activate a reviewed resume before tailoring it to a job');
    }
    const resumeText = (version?.parsedJson as { rawText?: string } | null)?.rawText ?? '';

    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { title: true, company: { select: { name: true } } },
    });
    if (!job) throw new NotFoundException('Job not found');

    const classification = await this.prisma.jobClassification.findFirst({
      where: { jobId },
      orderBy: { classifierVersion: 'desc' },
      select: { requiredSkills: true, preferredSkills: true },
    });
    const required = classification?.requiredSkills ?? [];
    const preferred = classification?.preferredSkills ?? [];

    const custom = resume?.masterHtml ?? null;
    const masterSource: 'custom' | 'generated' = custom ? 'custom' : 'generated';
    const masterHtml = custom ?? buildMasterHtml(profile);
    const audit = atsKeywordAudit(required, preferred, resumeText, profile.skills);

    let companyHtml: string;
    let changes: ResumeChange[];
    if (custom) {
      // Never auto-rewrite the user's own HTML — the layout is theirs. Surface
      // the exact ATS phrasings to add as SUGGESTIONS; they edit the master.
      companyHtml = custom;
      changes = audit.addExact.map((k) => ({
        type: 'ADD_KEYWORD' as const,
        detail: `Add the exact ATS phrase “${k}” to your skills line`,
      }));
    } else {
      ({ companyHtml, changes } = tailorForJob(masterHtml, audit.addExact));
    }

    // Scores before (master) and after (with the added keywords in the text).
    const before = scoreResume(profile, required, preferred, resumeText);
    const after = scoreResume(
      profile,
      required,
      preferred,
      `${resumeText} ${audit.addExact.join(' ')}`,
    );

    await this.prisma.companyResume.upsert({
      where: { userId_jobId: { userId, jobId } },
      create: {
        userId,
        jobId,
        companyName: job.company.name,
        html: companyHtml,
        atsScore: after.ats,
        recruiterScore: after.recruiter,
        hmScore: after.hiringManager,
        changes: changes as unknown as Prisma.InputJsonValue,
      },
      update: {
        html: companyHtml,
        atsScore: after.ats,
        recruiterScore: after.recruiter,
        hmScore: after.hiringManager,
        changes: changes as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      jobTitle: job.title,
      company: job.company.name,
      masterHtml,
      masterSource,
      companyHtml,
      changes,
      missingRequired: audit.missingRequired,
      scores: { before, after },
    };
  }

  /**
   * Save the user's corrections. Skills absent from the resume text are warned
   * about, never blocked — AI extraction misses real information, and the user
   * is the authority on their own history.
   */
  async saveProfile(
    userId: string,
    resumeVersionId: string,
    incoming: ResumeProfile & { suggestedSkills?: string[] },
  ) {
    const version = await this.ownedVersion(userId, resumeVersionId);
    const raw = (version.parsedJson as { rawText?: string } | null)?.rawText ?? '';

    // Suggestions are a rendering concern. Whatever the client echoes back,
    // only the confirmed profile is persisted.
    const { suggestedSkills: _ignored, ...profile } = incoming;

    // Provenance, not just a warning. A skill the user adds is real profile
    // data and may be matched on, but CareerOS must never later claim the
    // submitted PDF contains it — that would poison resume tailoring.
    const origins = classifySkillOrigins(profile.skills, raw);
    const manuallyAddedSkills = manuallyAdded(origins);

    await this.prisma.resumeVersion.update({
      where: { id: version.id },
      data: {
        confirmedProfile: profile as unknown as Prisma.InputJsonValue,
        skillProvenance: origins as unknown as Prisma.InputJsonValue,
        manuallyAddedSkills,
        // Every match decided before this instant is now stale. Reconciliation
        // reads it; without it, a corrected profile changes no score.
        profileUpdatedAt: new Date(),
      },
    });

    return {
      saved: true,
      warnings: manuallyAddedSkills.length
        ? [
            `${manuallyAddedSkills.join(', ')} ${manuallyAddedSkills.length === 1 ? 'is' : 'are'} not in your resume text. CareerOS will match on ${manuallyAddedSkills.length === 1 ? 'it' : 'them'}, but recruiters search the document — add ${manuallyAddedSkills.length === 1 ? 'it' : 'them'} to the PDF too, and only if you can defend ${manuallyAddedSkills.length === 1 ? 'it' : 'them'} in an interview.`,
          ]
        : [],
      unsupportedSkills: manuallyAddedSkills,
      // Saving corrects the profile. It does NOT re-score anything — activation
      // is the only path into the matcher. Say so, or the user reads yesterday's
      // scores as today's answer.
      rescoreRequired: version.activatedAt !== null,
    };
  }

  /**
   * Activate a reviewed version, then re-evaluate every actionable job against
   * it. This is the ONLY path that starts matching — parsing deliberately does
   * not, so an unreviewed AI extraction can never drive recommendations.
   */
  async activate(userId: string, resumeVersionId: string) {
    const version = await this.ownedVersion(userId, resumeVersionId);
    if (!version.confirmedProfile) {
      throw new BadRequestException('Review and confirm the parsed profile before activating');
    }
    // Exactly one active version per user, atomically. Two "ACTIVE" resumes is
    // not a display bug — it means reads could disagree about which resume the
    // recommendations belong to.
    await this.prisma.$transaction([
      this.prisma.resumeVersion.updateMany({
        where: { resume: { userId }, activatedAt: { not: null }, id: { not: version.id } },
        data: { activatedAt: null },
      }),
      this.prisma.resumeVersion.update({
        where: { id: version.id },
        data: { activatedAt: new Date(), reconciledAt: null, reconcileReport: Prisma.DbNull },
      }),
    ]);
    this.logger.log(`Activated resume version ${version.id} for user ${userId}`);

    // Re-scoring every actionable job is ~300 paced LLM calls — minutes, not
    // milliseconds. Enqueue it; the report lands on the version when it lands.
    await this.parseQueue.add(
      'reconcile',
      { resumeVersionId: version.id, userId },
      { jobId: `reconcile-${version.id}-${Date.now()}`, removeOnComplete: true, removeOnFail: false },
    );
    return { activated: true, reconciliationQueued: true };
  }

  /** The stored before/after report, once background reconciliation finishes. */
  async reconcileReport(userId: string, resumeVersionId: string) {
    const version = await this.ownedVersion(userId, resumeVersionId);
    const report = version.reconcileReport as { error?: string } | null;
    const failed = !!report?.error;
    return {
      status: failed
        ? 'failed'
        : version.reconciledAt
          ? 'complete'
          : version.activatedAt
            ? 'running'
            : 'not-activated',
      reconciledAt: version.reconciledAt,
      error: report?.error ?? null,
      report: failed ? null : version.reconcileReport,
    };
  }

  /** Re-queue reconciliation for an already-activated version (e.g. after a failure). */
  async retryReconcile(userId: string, resumeVersionId: string) {
    const version = await this.ownedVersion(userId, resumeVersionId);
    if (!version.activatedAt) throw new BadRequestException('Activate this version first');
    await this.prisma.resumeVersion.update({
      where: { id: version.id },
      data: { reconciledAt: null, reconcileReport: Prisma.DbNull },
    });
    await this.parseQueue.add(
      'reconcile',
      { resumeVersionId: version.id, userId },
      { jobId: `reconcile-${version.id}-${Date.now()}`, removeOnComplete: true, removeOnFail: false },
    );
    return { requeued: true };
  }

  private async ownedVersion(userId: string, resumeVersionId: string) {
    const version = await this.prisma.resumeVersion.findFirst({
      where: { id: resumeVersionId, resume: { userId } },
    });
    if (!version) throw new NotFoundException('Resume version not found');
    return version;
  }

  async enqueueParse(userId: string, resumeVersionId: string) {
    // Ownership check: the version must belong to one of the user's resumes.
    const owned = await this.resumes.findAllForUser(userId);
    const exists = owned.some((r) => r.versions.some((v) => v.id === resumeVersionId));
    if (!exists) throw new NotFoundException('Resume version not found');

    await this.parseQueue.add(
      'parse',
      { resumeVersionId },
      { jobId: `parse-${resumeVersionId}-${Date.now()}`, removeOnComplete: true, removeOnFail: true },
    );
    return { enqueued: true };
  }

  async delete(userId: string, resumeId: string): Promise<void> {
    const resume = await this.get(userId, resumeId);
    // Best-effort object cleanup; DB rows cascade via the FK.
    await Promise.allSettled(resume.versions.map((v) => this.storage.delete(v.fileKey)));
    await this.resumes.delete(resume.id);
  }

  /**
   * Returns both forms: `raw` is what an ATS would see, `clean` is what
   * Postgres will accept. The ATS check must run on `raw` — stripping control
   * characters is exactly what hides a broken text layer.
   */
  private async extractText(buffer: Buffer): Promise<{ raw: string; clean: string }> {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      const raw = result.text ?? '';
      const clean = raw.replace(CONTROL_CHARS, '').trim();
      if (!clean) {
        // Scanned/image-only PDF — accept the file, flag for OCR later.
        this.logger.warn('PDF contained no extractable text (possibly scanned)');
      }
      return { raw, clean };
    } catch {
      throw new BadRequestException('Could not read this PDF — is the file corrupted?');
    } finally {
      await parser.destroy();
    }
  }
}
