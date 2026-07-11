import { atsKeywordAudit } from './ats-keywords';

const RESUME = `
SKILLS
Backend: JavaScript (ES6+), Node.js, Express.js, RESTful APIs, Socket.io, Strapi
Databases: MySQL
Frontend: React.js, HTML5, CSS3
`;
const SKILLS = ['JavaScript', 'Node.js', 'Express.js', 'RESTful APIs', 'MySQL', 'React.js', 'HTML5', 'CSS3'];

describe('atsKeywordAudit', () => {
  it('marks the JD exact phrase PRESENT when the resume literally contains it', () => {
    const a = atsKeywordAudit(['Node.js', 'React.js', 'MySQL'], [], RESUME, SKILLS);
    expect(a.required.every((k) => k.status === 'PRESENT')).toBe(true);
    expect(a.requiredMatchPct).toBe(100);
    expect(a.addExact).toEqual([]);
  });

  it('flags VARIANT when you have the tech but the JD writes it differently', () => {
    // Resume says "RESTful APIs"; the JD keyword is "REST API". Same skill, but
    // a literal ATS filter for "REST API" would miss the resume.
    const a = atsKeywordAudit(['REST API'], [], RESUME, SKILLS);
    expect(a.required[0].status).toBe('VARIANT');
    expect(a.required[0].yourTerm).toBe('RESTful APIs');
    expect(a.addExact).toEqual(['REST API']);
  });

  it('treats "ExpressJS" as a variant of "Express.js"', () => {
    const a = atsKeywordAudit(['ExpressJS'], [], RESUME, SKILLS);
    expect(a.required[0].status).toBe('VARIANT');
    expect(a.addExact).toEqual(['ExpressJS']);
  });

  it('marks a technology you do not have at all as MISSING', () => {
    const a = atsKeywordAudit(['Docker', 'Kubernetes'], [], RESUME, SKILLS);
    expect(a.required.map((k) => k.status)).toEqual(['MISSING', 'MISSING']);
    expect(a.addExact).toEqual(['Docker', 'Kubernetes']);
  });

  it('ranks required above preferred and never double-counts a shared keyword', () => {
    const a = atsKeywordAudit(['Docker', 'Node.js'], ['Docker', 'GraphQL'], RESUME, SKILLS);
    expect(a.required.map((k) => k.keyword)).toEqual(['Docker', 'Node.js']);
    // Docker is required, so it is not repeated under preferred.
    expect(a.preferred.map((k) => k.keyword)).toEqual(['GraphQL']);
  });

  it('the actionable list adds missing/variant required first, then preferred variants only', () => {
    const a = atsKeywordAudit(['Docker', 'REST API'], ['MySQL'], RESUME, SKILLS);
    // Docker missing + REST API variant are required adds; MySQL preferred is PRESENT so not added.
    expect(a.addExact).toEqual(['Docker', 'REST API']);
  });

  it('computes the required literal-match percentage honestly', () => {
    const a = atsKeywordAudit(['Node.js', 'Docker', 'Redis', 'MySQL'], [], RESUME, SKILLS);
    // Node.js + MySQL literal-present of 4 required = 50%.
    expect(a.requiredMatchPct).toBe(50);
  });
});
