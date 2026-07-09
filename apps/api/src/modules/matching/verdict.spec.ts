import { verdictOf } from './matching.service';

describe('verdictOf', () => {
  it('maps opportunity scores onto the notification tiers', () => {
    expect(verdictOf(75)).toBe('APPLY');
    expect(verdictOf(100)).toBe('APPLY');
    expect(verdictOf(74.9)).toBe('CONSIDER');
    expect(verdictOf(60)).toBe('CONSIDER');
    expect(verdictOf(59.9)).toBe('SKIP');
    expect(verdictOf(0)).toBe('SKIP');
  });

  // The re-notify rule from the resume-version change: a new resume must not
  // re-announce jobs already sent, unless the verdict materially improves.
  const materialUpgrade = (before: number | null, after: number) =>
    verdictOf(after) === 'APPLY' && before !== null && verdictOf(before) !== 'APPLY';

  it('treats SKIP → APPLY and CONSIDER → APPLY as material upgrades', () => {
    expect(materialUpgrade(40, 80)).toBe(true);
    expect(materialUpgrade(65, 78)).toBe(true);
  });

  it('does not re-announce a job that was already APPLY', () => {
    expect(materialUpgrade(76, 88)).toBe(false);
  });

  it('does not treat a downgrade or a still-low score as an upgrade', () => {
    expect(materialUpgrade(80, 55)).toBe(false);
    expect(materialUpgrade(40, 65)).toBe(false);
  });
});
