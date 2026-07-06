import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { PDFParse } from 'pdf-parse';
import { StorageService } from '../storage/storage.service';
import { ResumesRepository } from './resumes.repository';
import { PARSE_RESUME_QUEUE } from './resumes.processor';

const MAX_RESUMES_PER_USER = 10;

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
    const rawText = await this.extractText(file.buffer);

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

      // Kick off AI parsing (structured extraction + skills + embedding).
      await this.parseQueue.add(
        'parse',
        { resumeVersionId: version.id },
        { jobId: `parse-${version.id}`, removeOnComplete: true, removeOnFail: true },
      );

      return { resumeId: resume.id, version };
    } catch (err) {
      // Storage/DB failed after we created the resume shell — undo it.
      if (createdNew) await this.resumes.delete(resume.id).catch(() => undefined);
      throw err;
    }
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

  private async extractText(buffer: Buffer): Promise<string> {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      const text = (result.text ?? '').replace(CONTROL_CHARS, '').trim();
      if (!text) {
        // Scanned/image-only PDF — accept the file, flag for OCR later.
        this.logger.warn('PDF contained no extractable text (possibly scanned)');
      }
      return text;
    } catch {
      throw new BadRequestException('Could not read this PDF — is the file corrupted?');
    } finally {
      await parser.destroy();
    }
  }
}
