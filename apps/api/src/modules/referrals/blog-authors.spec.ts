import { isPersonName } from './blog-authors';

describe('isPersonName', () => {
  it('accepts real 2–3 word human names', () => {
    for (const n of ['Asha Rao', 'Bryan Cross', 'Priya S. Sharma', "Sean O'Brien"])
      expect(isPersonName(n)).toBe(true);
  });

  it('rejects team / role / editorial labels', () => {
    for (const n of ['The Team', 'Engineering', 'Editorial Staff', 'Postman Team', 'Guest Author', 'Admin'])
      expect(isPersonName(n)).toBe(false);
  });

  it('rejects single words and over-long strings', () => {
    expect(isPersonName('Ramji')).toBe(false);
    expect(isPersonName('a b c d e')).toBe(false);
    expect(isPersonName('lowercase name')).toBe(false);
  });
});
