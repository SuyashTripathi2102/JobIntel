import { Injectable } from '@nestjs/common';
import { Prisma, Resume, ResumeVersion } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type ResumeWithVersions = Prisma.ResumeGetPayload<{ include: { versions: true } }>;

@Injectable()
export class ResumesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Listing never ships parsedJson (the full resume text), confirmedProfile, or
   * fileKey (a storage path) to the browser — only what the UI renders.
   */
  findAllForUser(userId: string) {
    return this.prisma.resume.findMany({
      where: { userId },
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          select: {
            id: true,
            versionNumber: true,
            createdAt: true,
            activatedAt: true,
            reconciledAt: true,
            atsScore: true,
            atsVerdict: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findByIdForUser(id: string, userId: string): Promise<ResumeWithVersions | null> {
    return this.prisma.resume.findFirst({
      where: { id, userId },
      include: { versions: { orderBy: { versionNumber: 'desc' } } },
    });
  }

  create(userId: string, title: string, isPrimary: boolean): Promise<Resume> {
    return this.prisma.resume.create({ data: { userId, title, isPrimary } });
  }

  countForUser(userId: string): Promise<number> {
    return this.prisma.resume.count({ where: { userId } });
  }

  /** versionNumber = max + 1, computed inside a transaction to avoid races. */
  async addVersion(resumeId: string, fileKey: string, parsedJson?: Prisma.InputJsonValue) {
    return this.prisma.$transaction(async (tx): Promise<ResumeVersion> => {
      const latest = await tx.resumeVersion.findFirst({
        where: { resumeId },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });
      return tx.resumeVersion.create({
        data: {
          resumeId,
          versionNumber: (latest?.versionNumber ?? 0) + 1,
          fileKey,
          parsedJson,
        },
      });
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.resume.delete({ where: { id } });
  }
}
