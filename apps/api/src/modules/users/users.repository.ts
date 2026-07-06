import { Injectable } from '@nestjs/common';
import { Prisma, User, UserPreference } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({ data });
  }

  getPreference(userId: string): Promise<UserPreference | null> {
    return this.prisma.userPreference.findUnique({ where: { userId } });
  }

  upsertPreference(
    userId: string,
    data: Omit<Prisma.UserPreferenceUncheckedCreateInput, 'userId' | 'id'>,
  ): Promise<UserPreference> {
    return this.prisma.userPreference.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }
}
