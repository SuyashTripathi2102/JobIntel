import type { GitHubPerson } from './github-people';
import { rankReferrals } from './referral-ranking';

const base: GitHubPerson = {
  login: 'dev',
  name: 'Dev Person',
  url: 'https://github.com/dev',
  avatarUrl: null,
  bio: null,
  company: null,
  location: null,
  email: null,
  blog: null,
  twitter: null,
  publicMember: false,
  contributions: 0,
  viaRepos: [],
};

const person = (over: Partial<GitHubPerson>): GitHubPerson => ({ ...base, ...over });

describe('rankReferrals', () => {
  it('ranks a confirmed public org member above an outside contributor', () => {
    const ranked = rankReferrals(
      [
        person({ login: 'contrib', publicMember: false, viaRepos: ['sdk'] }),
        person({ login: 'employee', publicMember: true }),
      ],
      { companyName: 'Acme', userSkills: [] },
    );
    expect(ranked[0].login).toBe('employee');
    expect(ranked[0].priority).toBeGreaterThan(ranked[1].priority);
  });

  it('classifies a recruiter from their bio and explains why', () => {
    const [r] = rankReferrals(
      [person({ login: 'tal', bio: 'Technical recruiter, hiring engineers', publicMember: true })],
      { companyName: 'Acme', userSkills: [] },
    );
    expect(r.role).toBe('RECRUITER');
    expect(r.reason.toLowerCase()).toContain('recruiter');
  });

  it('classifies an engineering leader', () => {
    const [r] = rankReferrals(
      [person({ login: 'lead', bio: 'Engineering Manager, Platform', publicMember: true })],
      { companyName: 'Acme', userSkills: [] },
    );
    expect(r.role).toBe('HIRING_MANAGER');
  });

  it('only claims shared tech that literally appears in the person text', () => {
    const [r] = rankReferrals(
      [person({ login: 'eng', bio: 'I build things with React and Node.js', publicMember: true })],
      { companyName: 'Acme', userSkills: ['React', 'Node.js', 'Kubernetes'] },
    );
    expect(r.sharedTech).toEqual(expect.arrayContaining(['React', 'Node.js']));
    expect(r.sharedTech).not.toContain('Kubernetes');
    expect(r.reason).toContain('shares your');
  });

  it('does not false-match a skill substring inside another word', () => {
    const [r] = rankReferrals(
      [person({ login: 'eng', bio: 'reactive systems and gopher', publicMember: true })],
      { companyName: 'Acme', userSkills: ['React', 'Go'] },
    );
    expect(r.sharedTech).toEqual([]);
  });

  it('never crashes on a malformed skills list (undefined / non-string entries)', () => {
    const skills = ['React', undefined, null, 42, 'Node.js'] as unknown as string[];
    expect(() =>
      rankReferrals([person({ login: 'e', bio: 'React and Node.js', publicMember: true })], {
        companyName: 'Acme',
        userSkills: skills,
      }),
    ).not.toThrow();
    const [r] = rankReferrals([person({ login: 'e', bio: 'React and Node.js', publicMember: true })], {
      companyName: 'Acme',
      userSkills: skills,
    });
    expect(r.sharedTech).toEqual(expect.arrayContaining(['React', 'Node.js']));
  });

  it('rewards a reachable public email over no contact path', () => {
    const withEmail = rankReferrals(
      [person({ login: 'a', publicMember: true, email: 'a@acme.dev' })],
      { companyName: 'Acme', userSkills: [] },
    )[0];
    const without = rankReferrals([person({ login: 'b', publicMember: true })], {
      companyName: 'Acme',
      userSkills: [],
    })[0];
    expect(withEmail.priority).toBeGreaterThan(without.priority);
    expect(withEmail.reason.toLowerCase()).toContain('email');
  });
});
