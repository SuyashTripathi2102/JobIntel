import {
  buildContactLadder,
  buildPlan,
  buildStrategy,
  companyGraph,
  contactConfidence,
  whyBullets,
  type ContactLike,
} from './outreach-strategy';
import type { CompanyChannels } from './company-contacts';

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

describe('contactConfidence', () => {
  it('rates a recruiter max on referral and an emailable engineer high on response', () => {
    expect(contactConfidence(c({ role: 'RECRUITER', publicMember: true })).referral).toBe(5);
    const eng = contactConfidence(
      c({ role: 'ENGINEER', publicMember: true, email: 'a@b.dev', sharedTech: ['Node.js'], contributions: 40 }),
    );
    expect(eng.response).toBe(5);
    expect(eng.referral).toBe(4);
  });

  it('rates an unreachable outside contributor low on both', () => {
    const x = contactConfidence(c({ role: 'ENGINEER', publicMember: false, email: null }));
    expect(x.referral).toBe(2);
    expect(x.response).toBe(2);
  });
});

const emptyChannels: CompanyChannels = { emails: [], careerPageUrl: null, contactPageUrl: null };

describe('buildContactLadder', () => {
  it('leads with a person and always ends in "apply anyway"', () => {
    const ladder = buildContactLadder(
      [c({ id: 'p', role: 'ENGINEER', priority: 80 })],
      { ...emptyChannels, careerPageUrl: 'https://acme.com/careers' },
      { companyName: 'Acme', jobUrl: 'https://acme.com/job/1' },
    );
    expect(ladder[0].kind).toBe('REFERRAL');
    expect(ladder[0].action).toEqual({ type: 'anchor', value: 'contact-p' });
    expect(ladder.some((r) => r.kind === 'CAREERS_PAGE')).toBe(true);
    expect(ladder[ladder.length - 1].kind).toBe('APPLY');
  });

  it('never dead-ends: with no people it falls through to a recruiting email then apply', () => {
    const ladder = buildContactLadder(
      [],
      { emails: [{ address: 'careers@acme.com', kind: 'RECRUITING' }], careerPageUrl: null, contactPageUrl: null },
      { companyName: 'Acme', jobUrl: 'https://acme.com/job/1' },
    );
    expect(ladder.some((r) => r.kind === 'COMPANY_EMAIL' && r.action?.value === 'careers@acme.com')).toBe(true);
    expect(ladder[ladder.length - 1].kind).toBe('APPLY');
    expect(ladder.every((r) => r.kind !== 'REFERRAL')).toBe(true);
  });

  it('always offers apply-anyway even with nothing at all', () => {
    const ladder = buildContactLadder([], emptyChannels, { companyName: 'Acme', jobUrl: null });
    expect(ladder).toHaveLength(1);
    expect(ladder[0].kind).toBe('APPLY');
    expect(ladder[0].action).toBeNull();
  });
});
