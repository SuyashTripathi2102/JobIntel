import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { LLM_PROVIDER } from '../ai/llm.provider';
import type { LlmProvider } from '../ai/llm.provider';

export interface ParsedResume {
  fullName: string | null;
  headline: string | null;
  totalYearsExperience: number | null;
  skills: { name: string; category: string | null; yearsOfUse: number | null }[];
  experience: {
    company: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
    highlights: string[];
  }[];
  education: { institution: string; degree: string | null; year: string | null }[];
  projects: { name: string; description: string; technologies: string[] }[];
  certifications: string[];
  summaryForMatching: string; // dense paragraph used for the embedding
}

const PARSE_PROMPT = `Extract structured data from this resume. Rules:
- skills: normalized lowercase names ("react", "node.js", "postgresql"); category one of language|framework|library|database|cloud|devops|tool|soft-skill|other; yearsOfUse when inferable, else null.
- experience: reverse-chronological; dates as YYYY-MM when present.
- totalYearsExperience: best estimate as a number, null if unclear.
- summaryForMatching: ONE dense paragraph (120-180 words) written for semantic job matching: role, seniority, years, core stack, domains, standout achievements. No fluff.
Return JSON matching exactly:
{"fullName":string|null,"headline":string|null,"totalYearsExperience":number|null,"skills":[{"name":string,"category":string|null,"yearsOfUse":number|null}],"experience":[{"company":string,"title":string,"startDate":string|null,"endDate":string|null,"highlights":[string]}],"education":[{"institution":string,"degree":string|null,"year":string|null}],"projects":[{"name":string,"description":string,"technologies":[string]}],"certifications":[string],"summaryForMatching":string}`;

@Injectable()
export class ResumeIntelligenceService {
  private readonly logger = new Logger(ResumeIntelligenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  /**
   * Parse a resume version into structured JSON, populate the skills tables,
   * and store the matching embedding. Idempotent — safe to re-run.
   */
  async parseVersion(resumeVersionId: string): Promise<ParsedResume> {
    const version = await this.prisma.resumeVersion.findUnique({
      where: { id: resumeVersionId },
    });
    if (!version) throw new NotFoundException('Resume version not found');

    const rawText =
      (version.parsedJson as { rawText?: string } | null)?.rawText ?? '';

    let parsed: ParsedResume;
    if (this.looksLikeText(rawText)) {
      parsed = await this.llm.generateJson<ParsedResume>(
        `${PARSE_PROMPT}\n\nRESUME TEXT:\n${rawText.slice(0, 40_000)}`,
      );
    } else {
      // Extraction produced gibberish (subsetted fonts, scanned pages...) —
      // let the multimodal model read the rendered PDF itself.
      this.logger.log(`rawText unusable for ${resumeVersionId} — using PDF vision fallback`);
      const pdf = await this.storage.download(version.fileKey);
      parsed = await this.llm.generateJson<ParsedResume>(PARSE_PROMPT, {
        files: [{ mimeType: 'application/pdf', data: pdf }],
      });
    }

    await this.prisma.resumeVersion.update({
      where: { id: version.id },
      data: {
        parsedJson: {
          rawText,
          structured: parsed as object,
          parsedAt: new Date().toISOString(),
        } as object,
      },
    });

    await this.syncSkills(version.id, parsed.skills);
    await this.storeEmbedding(version.id, parsed.summaryForMatching);

    return parsed;
  }

  /** Heuristic: broken font maps yield symbol soup — check the letter ratio. */
  private looksLikeText(text: string): boolean {
    if (text.length < 200) return false;
    const letters = (text.match(/[a-zA-Z\s]/g) ?? []).length;
    if (letters / text.length < 0.7) return false;
    const commonWords = (text.toLowerCase().match(/\b(the|and|of|in|to|with|for|a)\b/g) ?? [])
      .length;
    return commonWords >= 5;
  }

  private async syncSkills(
    resumeVersionId: string,
    skills: ParsedResume['skills'],
  ): Promise<void> {
    await this.prisma.resumeSkill.deleteMany({ where: { resumeVersionId } });
    for (const s of skills) {
      const name = s.name.trim().toLowerCase();
      if (!name) continue;
      const skill = await this.prisma.skill.upsert({
        where: { name },
        create: { name, category: s.category },
        update: {},
      });
      await this.prisma.resumeSkill.upsert({
        where: { resumeVersionId_skillId: { resumeVersionId, skillId: skill.id } },
        create: { resumeVersionId, skillId: skill.id, yearsOfUse: s.yearsOfUse },
        update: { yearsOfUse: s.yearsOfUse },
      });
    }
  }

  private async storeEmbedding(resumeVersionId: string, summary: string): Promise<void> {
    const [vector] = await this.llm.embed([summary]);
    const literal = `[${vector.join(',')}]`;
    // Prisma can't write Unsupported("vector") columns — raw SQL by design.
    await this.prisma.$executeRaw`
      INSERT INTO resume_embeddings (id, "resumeVersionId", model, vector, "createdAt")
      VALUES (${randomUUID()}, ${resumeVersionId}, 'gemini-embedding-2', ${literal}::vector, now())
      ON CONFLICT ("resumeVersionId")
      DO UPDATE SET vector = ${literal}::vector, model = 'gemini-embedding-2', "createdAt" = now()
    `;
  }
}
