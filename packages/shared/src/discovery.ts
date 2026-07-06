import { z } from 'zod';
import { AtsProviderSchema } from './ats';

/**
 * Contracts for the Company Discovery Engine (Phase B).
 * Lifecycle: Discover → Verify Website → Extract Metadata → Find Career Page
 * → Detect ATS → Assign Tier → MONITORED (continuous crawling).
 */

/** A company candidate from any discovery source (YC, seeds, boards, manual). */
export const CompanyCandidateSchema = z.object({
  name: z.string().min(1),
  website: z.url().nullish(),
  /** A URL that might reveal the ATS directly (board/apply/careers link). */
  atsHintUrl: z.url().nullish(),
  industry: z.string().nullish(),
  country: z.string().nullish(),
  city: z.string().nullish(),
  teamSize: z.number().int().nullish(),
  description: z.string().nullish(),
});
export type CompanyCandidate = z.infer<typeof CompanyCandidateSchema>;

/** What the workers' career-page prober reports back for one company. */
export const DiscoveryResultSchema = z.object({
  websiteVerified: z.boolean(),
  /** Final URL after redirects (www/domain changes get canonicalized). */
  website: z.url().nullish(),
  careerPageUrl: z.url().nullish(),
  atsProvider: AtsProviderSchema.nullish(),
  atsIdentifier: z.string().nullish(),
  /** Homepage metadata harvest — foundation for the Company Intelligence Layer. */
  metadata: z
    .object({
      title: z.string().nullish(),
      description: z.string().nullish(),
      githubOrg: z.string().nullish(), // from github.com/{org} links on the site
      blogUrl: z.url().nullish(), // engineering blog / blog link
    })
    .nullish(),
  /** Human-readable trail of what the prober tried — kept in confidenceSignals. */
  probeLog: z.array(z.string()).default([]),
});
export type DiscoveryResult = z.infer<typeof DiscoveryResultSchema>;
