/**
 * Today Command Center — the deterministic daily planner. Pure helpers only:
 * the momentum read, the competition/freshness signal, and the greeting. No
 * network, no LLM, no fabricated percentages — every output is derived from
 * real, observed state so the home screen can lead with ACTION, not metrics.
 */

export type Momentum = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';

export interface MomentumSignals {
  interviewsInProgress: number; // OA / INTERVIEW / OFFER — the strongest signal
  repliesInFlight: number; // outreach contacts who REPLIED
  outreachInFlight: number; // contacts CONTACTED, awaiting
  freshApplyMatches: number; // strong, fresh jobs still to apply to
  applicationsActive: number; // live applications
}

/**
 * A qualitative interview-probability read for the week — Low / Medium / High /
 * Very High, never a fake number. Momentum is about motion: interviews in
 * progress, replies to act on, threads in flight, fresh strong matches queued.
 */
export function weekMomentum(s: MomentumSignals): { level: Momentum; reason: string } {
  let score = 0;
  score += Math.min(4, s.interviewsInProgress * 3); // an interview is the strongest signal
  score += Math.min(2, s.repliesInFlight * 2);
  score += Math.min(2, s.outreachInFlight);
  score += s.freshApplyMatches > 0 ? 1 : 0;
  score += s.applicationsActive > 0 ? 1 : 0;

  const level: Momentum =
    score >= 6 ? 'VERY_HIGH' : score >= 4 ? 'HIGH' : score >= 2 ? 'MEDIUM' : 'LOW';

  const reason =
    s.interviewsInProgress > 0
      ? `${s.interviewsInProgress} interview${s.interviewsInProgress > 1 ? 's' : ''}/assessment${s.interviewsInProgress > 1 ? 's' : ''} in progress`
      : s.repliesInFlight > 0
        ? `${s.repliesInFlight} repl${s.repliesInFlight > 1 ? 'ies' : 'y'} waiting on you`
        : s.outreachInFlight > 0
          ? `${s.outreachInFlight} outreach thread${s.outreachInFlight > 1 ? 's' : ''} in flight`
          : s.freshApplyMatches > 0
            ? `${s.freshApplyMatches} strong fresh match${s.freshApplyMatches > 1 ? 'es' : ''} to apply to`
            : 'warming up — get an application or a referral in motion';

  return { level, reason };
}

/** Freshness → competition read. New postings have the fewest applicants. */
export function competitionChips(jobAgeDays: number | null): string[] {
  if (jobAgeDays == null) return [];
  if (jobAgeDays <= 3) return ['Fresh', 'Low competition'];
  if (jobAgeDays <= 10) return ['Recent'];
  if (jobAgeDays >= 25) return ['Older posting'];
  return [];
}

export type Impact = 'DO_FIRST' | 'HIGH' | 'MEDIUM' | 'LOW';

/** Human impact label instead of arbitrary stars. The first action is the one. */
export function impactLabel(stars: number, isTop: boolean): Impact {
  if (isTop) return 'DO_FIRST';
  if (stars >= 4) return 'HIGH';
  if (stars === 3) return 'MEDIUM';
  return 'LOW';
}

export function greeting(hourIST: number): string {
  if (hourIST < 12) return 'Good morning';
  if (hourIST < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Current hour in IST (server runs UTC) — for the greeting only. */
export function istHour(now: Date = new Date()): number {
  return Math.floor((((now.getTime() + 5.5 * 3_600_000) % 86_400_000) + 86_400_000) % 86_400_000 / 3_600_000);
}
