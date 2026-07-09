/* eslint-disable no-console */
/**
 * DRY RUN: classify real production JDs and print the result. Writes nothing.
 *   npx ts-node -T src/modules/matching/classify-dry-run.ts fixtures.json controls.json
 */
import { readFileSync } from 'fs';
import { ConfigService } from '@nestjs/config';
import { VertexGeminiProvider } from '../ai/vertex-gemini.provider';
import { AiUsageService } from '../ai/ai-usage.service';
import { JobClassifierService } from './job-classifier.service';
import {
  DEFAULT_ROLE_PROFILE,
  eligibility,
  type RoleProfile,
} from './role-classification';

const SUYASH: RoleProfile = { ...DEFAULT_ROLE_PROFILE, yearsExperience: 2 };

interface Fixture {
  company?: string;
  title: string;
  description: string;
  bucket?: string;
  opp?: number;
  resumeMatch?: number;
}

async function main() {
  const files = process.argv.slice(2);
  const fixtures: Fixture[] = files.flatMap(
    (f) => JSON.parse(readFileSync(f, 'utf8')) as Fixture[],
  );

  const config = new ConfigService();
  const usage = { record: () => undefined } as unknown as AiUsageService;
  const llm = new VertexGeminiProvider(config, usage);
  const classifier = new JobClassifierService(llm);

  const inputs = fixtures.map((f, i) => ({
    id: String(i),
    title: f.title,
    description: f.description,
  }));

  console.log(`Classifying ${inputs.length} real production JDs (no DB writes)...\n`);
  const { classified, failedIds } = await classifier.classify(inputs);

  const byId = new Map(classified.map((c) => [c.jobId, c]));
  let admitted = 0;
  let review = 0;
  let rejected = 0;

  for (const [i, f] of fixtures.entries()) {
    const c = byId.get(String(i));
    if (!c) {
      console.log(`FAILED  ${f.title}`);
      continue;
    }
    const e = eligibility(c, SUYASH);
    const state = e.eligible ? 'ADMIT ' : e.needsReview ? 'REVIEW' : 'REJECT';
    if (e.eligible) admitted++;
    else if (e.needsReview) review++;
    else rejected++;

    const old = f.opp ? `was ${f.opp}/${f.resumeMatch}%` : (f.bucket ?? 'control');
    console.log(
      `${state} | ${f.title.slice(0, 40).padEnd(40)} | ${c.primaryFunction.padEnd(26)} ${c.roleFamily.padEnd(28)} ` +
        `code=${c.codingIntensity.padEnd(11)} conf=${String(c.developmentConfidence).padStart(3)} ` +
        `yrs=${c.minimumYears ?? '-'}-${c.maximumYears ?? '-'} ${c.seniority.padEnd(8)} ` +
        `relevance=${String(e.roleRelevance).padStart(3)}% (${old})`,
    );
    console.log(`         ${e.reason}`);
    if (c.nonDevelopmentEvidence.length) {
      console.log(`         against: ${c.nonDevelopmentEvidence.slice(0, 2).join(' | ')}`);
    }
  }

  console.log(
    `\nadmitted=${admitted}  needsReview=${review}  rejected=${rejected}  failed=${failedIds.length}`,
  );
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
