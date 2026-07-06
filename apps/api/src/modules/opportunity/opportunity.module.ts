import { Module } from '@nestjs/common';
import { OpportunityService } from './opportunity.service';

@Module({
  providers: [OpportunityService],
  exports: [OpportunityService],
})
export class OpportunityModule {}
