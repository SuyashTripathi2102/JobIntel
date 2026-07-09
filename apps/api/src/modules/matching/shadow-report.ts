/* eslint-disable no-console */
/**
 * SHADOW MODE: what the new eligibility gate would decide, compared with what
 * production currently recommends. Reads only. Changes nothing.
 *
 *   node dist/modules/matching/shadow-report.js
 */
import { PrismaClient } from '@prisma/client';
import { CLASSIFIER_VERSION } from './job-classifier.service';
import {
  DEFAULT_ROLE_PROFILE,
  eligibility,
  type JobClassification,
  type RoleProfile,
} from './role-classification';

const PROFILE: RoleProfile = { ...DEFAULT_ROLE_PROFILE, yearsExperience: 2 };
const prisma = new PrismaClient();

function toClassification(r: {
  primaryFunction: string;
  roleFamily: string;
  specializations: string[];
  codingIntensity: string;
  developmentConfidence: number;
  seniority: string;
  minimumYears: number | null;
  maximumYears: number | null;
  requiredSkills: string[];
  preferredSkills: string[];
  responsibilities: string[];
  developmentEvidence: string[];
  nonDevelopmentEvidence: string[];
  classificationReason: string;
}): JobClassification {
  return { ...r, specialization: r.specializations } as unknown as JobClassification;
}

function pad(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n);
}

async function main() {
  const classifications = await prisma.jobClassification.findMany({
    where: { classifierVersion: CLASSIFIER_VERSION },
    include: {
      job: {
        select: {
          id: true,
          title: true,
          company: { select: { name: true } },
          matches: {
            where: { resumeVersion: { activatedAt: { not: null } } },
            select: { opportunityScore: true, overallScore: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
    },
  });

  const currentVerdict = (opp: number | null) =>
    opp == null ? 'UNSCORED' : opp >= 75 ? 'APPLY' : opp >= 60 ? 'CONSIDER' : 'SKIP';

  const family: Record<string, number> = {};
  const seniority: Record<string, number> = {};
  const outcome: Record<string, number> = {};
  const reject: Record<string, number> = {};
  const disagreements: string[] = [];
  const newlyEligible: string[] = [];

  for (const c of classifications) {
    const cls = toClassification(c);
    const e = eligibility(cls, PROFILE);
    const m = c.job.matches[0];
    const before = currentVerdict(m?.opportunityScore ?? null);
    const after = e.eligible ? 'ELIGIBLE' : e.needsReview ? 'NEEDS_REVIEW' : 'REJECT';

    family[c.roleFamily] = (family[c.roleFamily] ?? 0) + 1;
    seniority[c.seniority] = (seniority[c.seniority] ?? 0) + 1;
    outcome[after] = (outcome[after] ?? 0) + 1;

    if (after === 'REJECT') {
      const bucket = /outside your target families/.test(e.reason)
        ? 'wrong specialization'
        : /years|senior role|lead role|staff role|principal role/i.test(e.reason)
          ? 'too senior'
          : /not a primary responsibility/.test(e.reason)
            ? 'low coding responsibility'
            : /not the core responsibility/.test(e.reason)
              ? 'not a development role'
              : 'other';
      reject[bucket] = (reject[bucket] ?? 0) + 1;
    }

    const label = `${pad(c.job.company.name, 18)} ${pad(c.job.title, 42)}`;

    // Was recommended, now blocked — every one of these needs a human look.
    if ((before === 'APPLY' || before === 'CONSIDER') && after !== 'ELIGIBLE') {
      disagreements.push(
        `${before.padEnd(8)} ${String(Math.round(m?.opportunityScore ?? 0)).padStart(3)} -> ${after.padEnd(12)} | ${label} | ${e.reason}`,
      );
    }
    // Was never recommended, now eligible — the opportunities we were missing.
    if (before !== 'APPLY' && before !== 'CONSIDER' && after === 'ELIGIBLE') {
      newlyEligible.push(
        `${before.padEnd(8)} ${String(Math.round(m?.opportunityScore ?? 0)).padStart(3)} -> ELIGIBLE     | ${label} | rel=${e.roleRelevance}% ${e.capsAtConsider ? '(caps at CONSIDER)' : ''}`,
      );
    }
  }

  const table = (t: Record<string, number>) =>
    Object.entries(t)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${String(v).padStart(4)}  ${k}`)
      .join('\n');

  console.log(`classified jobs: ${classifications.length} (classifier v${CLASSIFIER_VERSION})\n`);
  console.log('--- outcome under the new gate ---\n' + table(outcome));
  console.log('\n--- why rejected ---\n' + table(reject));
  console.log('\n--- role family distribution ---\n' + table(family));
  console.log('\n--- seniority distribution ---\n' + table(seniority));

  console.log(`\n--- DISAGREEMENTS: currently recommended, would be blocked (${disagreements.length}) ---`);
  disagreements.forEach((d) => console.log(d));

  console.log(`\n--- NEWLY ELIGIBLE: not recommended today, would pass the gate (${newlyEligible.length}) ---`);
  newlyEligible.slice(0, 25).forEach((d) => console.log(d));

  await prisma.$disconnect();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
