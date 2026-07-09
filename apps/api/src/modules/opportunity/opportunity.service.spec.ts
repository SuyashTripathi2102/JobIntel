import { HiringTrend } from '@prisma/client';
import { OpportunityService } from './opportunity.service';

/** compute() is pure — no Prisma needed for these tests. */
const service = new OpportunityService(null as never);

function ctx(overrides: Partial<Parameters<OpportunityService['compute']>[0]> = {}) {
  return {
    match: {
      overallScore: 85,
      technicalScore: 80,
      experienceScore: 90,
      missingSkills: ['docker'],
      ...(overrides.match ?? {}),
    },
    job: {
      title: 'Backend Engineer',
      location: 'Bengaluru, India',
      postedAt: new Date(Date.now() - 2 * 3_600_000), // 2h ago
      firstSeenAt: new Date(),
      workMode: 'REMOTE',
      salaryMin: 2_000_000,
      salaryMax: 3_000_000,
      currency: 'INR',
      companyId: 'c1',
      ...(overrides.job ?? {}),
    },
    prefs: overrides.prefs !== undefined ? overrides.prefs : {
      workModes: ['REMOTE'],
      minSalary: 1_200_000,
      salaryCurrency: 'INR',
      cities: ['Bengaluru', 'Indore'],
    },
    company: {
      name: 'Acme',
      confidence: 90,
      hiringTrend: HiringTrend.GROWING,
      recentJobs14d: 6,
      ...(overrides.company ?? {}),
    },
  };
}

describe('OpportunityService.compute', () => {
  it('scores a strong fresh match highly with all modules applicable', () => {
    const r = service.compute(ctx());
    expect(r.opportunityScore).toBeGreaterThan(80);
    expect(r.breakdown.map((m) => m.module)).toEqual(
      expect.arrayContaining([
        'resumeFit',
        'experienceFit',
        'freshness',
        'remotePreference',
        'salaryPreference',
        'companyQuality',
        'hiringVelocity',
        'skillGap',
      ]),
    );
  });

  it('renormalizes weights when salary/remote/velocity data is missing', () => {
    const r = service.compute(
      ctx({
        job: { salaryMin: null, salaryMax: null, currency: null, workMode: null } as never,
        company: {
          name: 'Acme',
          confidence: 90,
          hiringTrend: HiringTrend.INSUFFICIENT_DATA,
          recentJobs14d: 0,
        },
      }),
    );
    const modules = r.breakdown.map((m) => m.module);
    expect(modules).not.toContain('salaryPreference');
    expect(modules).not.toContain('remotePreference');
    // Missing data must not act as a penalty: score stays high, not dragged to ~60.
    expect(r.opportunityScore).toBeGreaterThan(75);
  });

  it('falls back to the live 14-day signal when the hiring trend is unknown', () => {
    const quiet = service.compute(
      ctx({
        company: {
          name: 'Acme',
          confidence: 90,
          hiringTrend: HiringTrend.INSUFFICIENT_DATA,
          recentJobs14d: 0,
        },
      }),
    );
    const active = service.compute(
      ctx({
        company: {
          name: 'Acme',
          confidence: 90,
          hiringTrend: HiringTrend.INSUFFICIENT_DATA,
          recentJobs14d: 12,
        },
      }),
    );
    const velocity = (r: ReturnType<OpportunityService['compute']>) =>
      r.breakdown.find((m) => m.module === 'hiringVelocity')!;

    // Never drops out — an unknown trend is not the same as no information.
    expect(velocity(quiet).reason).toBe('no new openings in 14d');
    expect(velocity(active).reason).toContain('actively hiring');
    expect(velocity(active).score).toBeGreaterThan(velocity(quiet).score);
  });

  it('applies the verification gate below confidence 40 (dampen + flag)', () => {
    const trusted = service.compute(ctx());
    const unverified = service.compute(
      ctx({ company: { name: 'Acme', confidence: 0, hiringTrend: null, recentJobs14d: 0 } }),
    );
    expect(unverified.opportunityScore).toBeLessThan(trusted.opportunityScore * 0.9);
    expect(unverified.breakdown.some((m) => m.module === 'verification')).toBe(true);
  });

  it('decays freshness for stale postings', () => {
    const fresh = service.compute(ctx());
    const stale = service.compute(
      ctx({ job: { postedAt: new Date(Date.now() - 40 * 86_400_000) } as never }),
    );
    expect(stale.opportunityScore).toBeLessThan(fresh.opportunityScore);
    const staleModule = stale.breakdown.find((m) => m.module === 'freshness');
    expect(staleModule!.score).toBeLessThanOrEqual(40);
  });

  it('penalizes salary below the user floor but never when undisclosed', () => {
    const below = service.compute(
      ctx({ job: { salaryMax: 800_000 } as never }),
    );
    const salaryModule = below.breakdown.find((m) => m.module === 'salaryPreference');
    expect(salaryModule!.score).toBeLessThan(50);

    const undisclosed = service.compute(
      ctx({ job: { salaryMin: null, salaryMax: null } as never }),
    );
    expect(undisclosed.breakdown.find((m) => m.module === 'salaryPreference')).toBeUndefined();
  });

  it('content hash changes when salary changes (re-notify trigger)', () => {
    const a = service.compute(ctx());
    const b = service.compute(ctx({ job: { salaryMax: 3_500_000 } as never }));
    expect(a.contentHash).not.toEqual(b.contentHash);
  });

  // cityPreference is boost-only: a job outside the preferred cities must not be
  // penalised, because most listings carry a vague or missing location.
  it('boosts a job in a preferred city and stays silent outside it', () => {
    const preferred = service.compute(ctx());
    const elsewhere = service.compute(ctx({ job: { location: 'Chennai, India' } as never }));

    const boost = preferred.breakdown.find((m) => m.module === 'cityPreference');
    expect(boost?.score).toBe(100);
    expect(boost?.reason).toContain('Bengaluru');

    expect(elsewhere.breakdown.find((m) => m.module === 'cityPreference')).toBeUndefined();
    expect(preferred.opportunityScore).toBeGreaterThanOrEqual(elsewhere.opportunityScore);
  });

  it('drops cityPreference when the user states no city preference', () => {
    const r = service.compute(
      ctx({ prefs: { workModes: ['REMOTE'], minSalary: null, salaryCurrency: null, cities: [] } }),
    );
    expect(r.breakdown.find((m) => m.module === 'cityPreference')).toBeUndefined();
  });
});
