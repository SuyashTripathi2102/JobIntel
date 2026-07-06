import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AdminModule } from './modules/admin/admin.module';
import { AiModule } from './modules/ai/ai.module';
import { AuthModule } from './modules/auth/auth.module';
import { MatchingModule } from './modules/matching/matching.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OpportunityModule } from './modules/opportunity/opportunity.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { CrawlModule } from './modules/crawl/crawl.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { IntelligenceModule } from './modules/intelligence/intelligence.module';
import { InternalModule } from './modules/internal/internal.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { ResumesModule } from './modules/resumes/resumes.module';
import { StorageModule } from './modules/storage/storage.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    // Global default: 100 requests/min per IP. Auth routes override stricter.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    StorageModule,
    AdminModule,
    AuthModule,
    UsersModule,
    ResumesModule,
    AiModule,
    CompaniesModule,
    DiscoveryModule,
    IntelligenceModule,
    JobsModule,
    InternalModule,
    CrawlModule,
    MatchingModule,
    NotificationsModule,
    OpportunityModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Order matters: throttle → authenticate → authorize.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
