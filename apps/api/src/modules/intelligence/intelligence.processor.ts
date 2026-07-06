import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { IntelligenceService } from './intelligence.service';

export const DERIVE_INTEL_QUEUE = 'derive-intel';

@Processor(DERIVE_INTEL_QUEUE)
export class IntelligenceProcessor extends WorkerHost {
  private readonly logger = new Logger(IntelligenceProcessor.name);

  constructor(private readonly intel: IntelligenceService) {
    super();
  }

  async process() {
    const derived = await this.intel.deriveDueCompanies(10);
    this.logger.log(`Intelligence derivation batch done: ${derived} companies`);
    return { derived };
  }
}
