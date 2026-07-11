import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import { TodayService } from './today.service';

/** The daily plan — the action-first home of CareerOS. JWT-guarded (global). */
@Controller('today')
export class TodayController {
  constructor(
    private readonly today: TodayService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async get(@CurrentUser() user: AuthenticatedUser) {
    const u = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { name: true },
    });
    return this.today.today(user.id, u?.name ?? null);
  }
}
