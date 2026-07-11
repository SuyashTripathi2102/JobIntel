import {
  competitionChips,
  greeting,
  impactLabel,
  istHour,
  weekMomentum,
  type MomentumSignals,
} from './today.pure';

const sig = (over: Partial<MomentumSignals>): MomentumSignals => ({
  interviewsInProgress: 0,
  repliesInFlight: 0,
  outreachInFlight: 0,
  freshApplyMatches: 0,
  applicationsActive: 0,
  ...over,
});

describe('weekMomentum', () => {
  it('is LOW with nothing in motion', () => {
    expect(weekMomentum(sig({})).level).toBe('LOW');
  });

  it('an interview in progress dominates the read', () => {
    const m = weekMomentum(sig({ interviewsInProgress: 1, applicationsActive: 1 }));
    expect(m.level).toBe('HIGH');
    expect(m.reason).toMatch(/interview/i);
  });

  it('replies to act on lift momentum and headline the reason', () => {
    const m = weekMomentum(sig({ repliesInFlight: 1, outreachInFlight: 1 }));
    expect(['MEDIUM', 'HIGH']).toContain(m.level);
    expect(m.reason).toMatch(/waiting on you/i);
  });

  it('reaches VERY_HIGH when lots is moving', () => {
    const m = weekMomentum(
      sig({ interviewsInProgress: 2, repliesInFlight: 1, outreachInFlight: 2, freshApplyMatches: 3, applicationsActive: 4 }),
    );
    expect(m.level).toBe('VERY_HIGH');
  });
});

describe('competitionChips', () => {
  it('flags fresh, low-competition postings', () => {
    expect(competitionChips(1)).toEqual(['Fresh', 'Low competition']);
    expect(competitionChips(30)).toEqual(['Older posting']);
    expect(competitionChips(null)).toEqual([]);
  });
});

describe('impactLabel', () => {
  it('marks the first action DO_FIRST and grades the rest by leverage', () => {
    expect(impactLabel(5, true)).toBe('DO_FIRST');
    expect(impactLabel(4, false)).toBe('HIGH');
    expect(impactLabel(3, false)).toBe('MEDIUM');
    expect(impactLabel(2, false)).toBe('LOW');
  });
});

describe('greeting / istHour', () => {
  it('greets by time of day', () => {
    expect(greeting(9)).toBe('Good morning');
    expect(greeting(14)).toBe('Good afternoon');
    expect(greeting(20)).toBe('Good evening');
  });
  it('istHour is within 0..23', () => {
    const h = istHour(new Date('2026-07-12T09:00:00Z')); // 14:30 IST
    expect(h).toBe(14);
  });
});
