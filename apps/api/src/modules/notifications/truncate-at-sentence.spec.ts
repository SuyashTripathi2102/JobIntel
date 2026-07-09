import { truncateAtSentence } from './notifications.service';

describe('truncateAtSentence', () => {
  it('leaves short reasoning untouched', () => {
    const r = truncateAtSentence('Strong React and Node.js fit.', 100);
    expect(r).toEqual({ text: 'Strong React and Node.js fit.', truncated: false });
  });

  it('cuts at the last complete sentence, never mid-sentence', () => {
    // The 2026-07-09 bug: a hard slice ended a Telegram card on "whereas you only…".
    const long =
      'Strong React and Node.js fit. Your RBAC middleware maps onto their needs. ' +
      'The role asks for four years of experience, whereas you only have two.';
    const { text, truncated } = truncateAtSentence(long, 80);

    expect(truncated).toBe(true);
    expect(text.endsWith('.')).toBe(true);
    expect(text).not.toContain('whereas you only');
    expect(long.startsWith(text)).toBe(true);
  });

  it('falls back to a word boundary when there is no sentence break', () => {
    const noSentences = 'react node express mysql docker kubernetes kafka postgres redis';
    const { text, truncated } = truncateAtSentence(noSentences, 20);

    expect(truncated).toBe(true);
    expect(text.endsWith('…')).toBe(true);
    // A word boundary, not a severed token.
    expect(text.replace('…', '').trim().split(' ').pop()).not.toBe('ex');
    expect(noSentences.startsWith(text.replace('…', '').trim())).toBe(true);
  });

  it('ignores a sentence break so early it would drop most of the text', () => {
    const s = `Ok. ${'x'.repeat(200)} more words here`;
    const { text } = truncateAtSentence(s, 100);
    // Cutting at "Ok." would throw away everything; prefer the word boundary.
    expect(text.length).toBeGreaterThan(50);
  });

  it('stays inside the character budget', () => {
    const long = 'This is a sentence. '.repeat(500);
    const { text } = truncateAtSentence(long, 2500);
    expect(text.length).toBeLessThanOrEqual(2500);
  });
});
