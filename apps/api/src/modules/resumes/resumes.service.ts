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
  async profile(userId: string, resumeVersionId: string): Promise<ResumeProfile> {
    const version = await this.ownedVersion(userId, resumeVersionId);
    const parsedJson = version.parsedJson as {
      rawText?: string;
      structured?: ParsedResume;
    } | null;
    const structured = parsedJson?.structured;
    if (!structured) {
      throw new BadRequestException('This version has not been parsed yet');
    }
    const confirmed = version.confirmedProfile as ResumeProfile | null;
    if (confirmed) return confirmed;

    const raw = parsedJson?.rawText ?? '';
    return {
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
   * Save the user's corrections. Skills absent from the resume text are warned
   * about, never blocked — AI extraction misses real information, and the user
   * is the authority on their own history.
   */
  async saveProfile(userId: string, resumeVersionId: string, profile: ResumeProfile) {
    const version = await this.ownedVersion(userId, resumeVersionId);
    const raw = (
      (version.parsedJson as { rawText?: string } | null)?.rawText ?? ''
    ).toLowerCase();

    const unsupportedSkills = profile.skills.filter((s) => !raw.includes(s.toLowerCase()));

    await this.prisma.resumeVersion.update({
      where: { id: version.id },
      data: { confirmedProfile: profile as unknown as Prisma.InputJsonValue },
    });

    return {
      saved: true,
      warnings: unsupportedSkills.length
        ? [
            `${unsupportedSkills.join(', ')} ${unsupportedSkills.length === 1 ? 'does' : 'do'} not appear in the resume text. Recruiters search the document, not this profile — add it to the PDF too, and only if you can defend it in an interview.`,
          ]
        : [],
      unsupportedSkills,
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
    await this.prisma.resumeVersion.update({
      where: { id: version.id },
      data: { activatedAt: new Date(), reconciledAt: null, reconcileReport: Prisma.DbNull },
    });
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
    return {
      status: version.reconciledAt ? 'complete' : version.activatedAt ? 'running' : 'not-activated',
      reconciledAt: version.reconciledAt,
      report: version.reconcileReport,
    };
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
