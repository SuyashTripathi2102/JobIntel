import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ReferralsService } from './referrals.service';

/**
 * Referral Engine — public-source people discovery + user-sent outreach drafts.
 * JWT-guarded (the global guard); every route is scoped to the current user.
 */
@Controller('referrals')
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  /** Ranked shortlist of who could refer you into this job (cached per company). */
  @Get('job/:jobId')
  forJob(@CurrentUser() user: AuthenticatedUser, @Param('jobId') jobId: string) {
    return this.referrals.forJob(user.id, jobId);
  }

  /** Outreach CRM: everyone you've engaged, "needs a nudge today" first. */
  @Get('outreach')
  outreach(@CurrentUser() user: AuthenticatedUser) {
    return this.referrals.outreachInbox(user.id);
  }

  /** Draft a short follow-up nudge — you review and send it. */
  @Post(':id/followup')
  @HttpCode(HttpStatus.OK)
  followUp(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.referrals.generateFollowUp(user.id, id);
  }

  /** Record that you sent a follow-up (advances the cadence). */
  @Post(':id/followup/logged')
  @HttpCode(HttpStatus.OK)
  followUpLogged(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.referrals.logFollowUp(user.id, id);
  }

  /** Draft a personalised outreach message for one contact — you review & send it. */
  @Post(':id/draft')
  @HttpCode(HttpStatus.OK)
  draft(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.referrals.generateDraft(user.id, id);
  }

  /** Advance a contact through the outreach pipeline (SUGGESTED → … → REPLIED). */
  @Patch(':id/status')
  status(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    return this.referrals.setStatus(user.id, id, body.status);
  }
}
