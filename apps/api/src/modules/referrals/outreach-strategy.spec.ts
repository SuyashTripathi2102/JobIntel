import {
  buildPlan,
  buildStrategy,
  companyGraph,
  whyBullets,
  type ContactLike,
} from './outreach-strategy';

const c = (over: Partial<ContactLike>): ContactLike => ({
  id: 'x',
  name: 'X',
  role: 'ENGINEER',
  priority: 50,
  publicMember: true,
  sharedTech: [],
  email: null,
  blog: null,
  twitter: null,
  contributions: 0,
  ...over,
});

describe('whyBullets', () => {
  it('states role, employment proof, shared tech, and contact path', () => {
    const b = whyBullets(
      c({ role: 'ENGINEER', publicMember: true, sharedTech: ['Node.js'], email: 'a@b.dev', contributions: 40 }),
      'Postman',
    );
    expect(b[0]).toMatch(/internal referral/i);
    expect(b.some((x) => /Confirmed Postman employee/.test(x))).toBe(true);
    expect(b.some((x) => /Shares your Node\.js/.test(x))).toBe(true);
    expect(b.some((x) => /Active open-source contributor/.test(x))).toBe(true);
    expect(b.some((x) => /public email/.test(x))).toBe(true);
  });

  it('degrades the contact bullet honestly when there is no public address', () => {
    const b = whyBullets(c({ email: null, blog: null, twitter: null }), 'Acme');
    expect(b.some((x) => /Message via GitHub/.test(x))).toBe(true);
  });
});

describe('companyGraph', () => {
  it('counts roles and contactable people', () => {
    const g = companyGraph([
      c({ role: 'RECRUITER', email: 'r@a.dev' }),
      c({ role: 'HIRING_MANAGER' }),
      c({ role: 'ENGINEER', twitter: 'eng' }),
      c({ role: 'ENGINEER' }),
    ]);
    expect(g).toMatchObject({ recruiters: 1, leaders: 1, engineers: 2, contactable: 2, total: 4 });
  });
});

describe('buildStrategy', () => {
  it('picks the top person as primary and a different-role secondary', () => {
    const s = buildStrategy([
      c({ id: 'lead', role: 'HIRING_MANAGER', priority: 90 }),
      c({ id: 'eng', role: 'ENGINEER', priority: 70 }),
      c({ id: 'rec', role: 'RECRUITER', priority: 65 }),
    ]);
    expect(s.primary?.id).toBe('lead');
    expect(s.secondary?.id).not.toBe('lead');
    expect(s.recruiterFallback?.id).toBe('rec');
  });

  it('returns nulls for an empty company', () => {
    expect(buildStrategy([])).toEqual({ primary: null, secondary: null, recruiterFallback: null });
  });
});

describe('buildPlan', () => {
  it('leads with the referral and always ends with a fallback when contacts exist', () => {
    const s = buildStrategy([c({ id: 'p', role: 'ENGINEER', priority: 80 })]);
    const plan = buildPlan(s, { jobId: 'j1', hasContacts: true, primaryPriority: 80 });
    expect(plan[0].title).toMatch(/Ask X for a referral/);
    expect(plan[0].stars).toBe(5);
    expect(plan.some((p) => /Tailor your resume/.test(p.title) && p.href === '/resumes/tailor/j1')).toBe(true);
    expect(plan[plan.length - 1].title).toMatch(/move on/);
  });

  it('still produces a real plan (tailor → apply) when nobody was found', () => {
    const plan = buildPlan(buildStrategy([]), { jobId: 'j1', hasContacts: false, primaryPriority: 0 });
    expect(plan.some((p) => /Tailor your resume/.test(p.title))).toBe(true);
    expect(plan.some((p) => /Apply on the company site/.test(p.title))).toBe(true);
    expect(plan.every((p) => !/referral/i.test(p.title))).toBe(true);
  });
});
