import { AtsProvider } from '@prisma/client';
import { detectAts as sharedDetectAts } from '@careeros/shared';

export interface AtsDetection {
  provider: AtsProvider;
  identifier: string | null;
}

/**
 * Thin wrapper over the shared detector (packages/shared/src/ats.ts — single
 * source of truth, also used by the workers' prober), mapping the string enum
 * onto Prisma's AtsProvider. Values are identical by design.
 */
export function detectAts(url: string): AtsDetection {
  const result = sharedDetectAts(url);
  return { provider: AtsProvider[result.provider], identifier: result.identifier };
}
