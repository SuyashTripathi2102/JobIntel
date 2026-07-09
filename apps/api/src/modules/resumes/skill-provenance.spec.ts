import { classifySkillOrigins, isNamedInResume, manuallyAdded } from './skill-provenance';

// The real SKILLS block from the active ATS-safe resume, verbatim.
const RESUME = `
SKILLS
Backend: JavaScript (ES6+), Node.js, Express.js, RESTful APIs,
Socket.io (WebSockets), Middleware, Strapi
Databases: MySQL
Auth & Security: JWT, OAuth 2.0, OTP (Twilio), Bcrypt, Helmet, CORS,
Rate Limiting
Payments: Razorpay (Orders API, Webhooks, HMAC SHA256 Verification)
Cloud & DevOps: AWS EC2, PM2, Nginx, Let's Encrypt SSL
Tools & Others: Git, Postman (API Testing), node-cron, Nodemailer, Joi, Cloudinary
Frontend: React.js, HTML5, CSS3
`;

describe('isNamedInResume', () => {
  describe('the skills the AI parse silently dropped', () => {
    it.each(['HTML5', 'CSS3', 'RESTful APIs', 'OAuth 2.0'])('finds %s', (skill) => {
      expect(isNamedInResume(skill, RESUME)).toBe(true);
    });

    it('finds HTML5 when the user types the canonical "HTML"', () => {
      expect(isNamedInResume('HTML', RESUME)).toBe(true);
    });

    it('finds "REST APIs" even though it is not a substring of "RESTful APIs"', () => {
      expect(RESUME.includes('REST APIs')).toBe(false);
      expect(isNamedInResume('REST APIs', RESUME)).toBe(true);
    });
  });

  describe('skills genuinely on the resume', () => {
    it.each([
      'JavaScript',
      'Node.js',
      'Express.js',
      'React.js',
      'MySQL',
      'JWT',
      'Socket.io',
      'Razorpay',
      'Nginx',
      'Joi',
      'Cloudinary',
      'Postman',
    ])('finds %s', (skill) => {
      expect(isNamedInResume(skill, RESUME)).toBe(true);
    });

    it('resolves an alias the resume writes differently: "React" vs "React.js"', () => {
      expect(isNamedInResume('React', RESUME)).toBe(true);
    });

    it('resolves "Node" against "Node.js"', () => {
      expect(isNamedInResume('Node', RESUME)).toBe(true);
    });
  });

  describe('skills NOT on the resume', () => {
    it.each(['MongoDB', 'Cassandra', 'Kubernetes', 'Docker', 'Redis', 'Kafka', 'TypeScript'])(
      'does not find %s',
      (skill) => {
        expect(isNamedInResume(skill, RESUME)).toBe(false);
      },
    );
  });

  describe('substring collisions — the bug this module exists to prevent', () => {
    it('"Java" is not found in a resume that only says "JavaScript"', () => {
      expect(isNamedInResume('Java', 'Skills: JavaScript, Node.js')).toBe(false);
    });

    it('"Go" is not found inside "Google"', () => {
      expect(isNamedInResume('Go', 'Deployed on Google Cloud')).toBe(false);
    });

    it('"Go" IS found when written as a standalone technology', () => {
      expect(isNamedInResume('Go', 'Languages: Go, Rust')).toBe(true);
    });

    it('"Go" is not found in the lowercase English verb', () => {
      expect(isNamedInResume('Go', 'helped the team go live in six weeks')).toBe(false);
    });

    it('"C" is not found inside "C++", "C#" or "CSS3"', () => {
      expect(isNamedInResume('C', 'Skills: C++, C#, CSS3')).toBe(false);
    });

    it('"React" is not found inside "React Native"', () => {
      expect(isNamedInResume('React', 'Built with React Native')).toBe(false);
    });

    it('"SQL" is not found inside "MySQL"', () => {
      expect(isNamedInResume('SQL', 'Databases: MySQL')).toBe(false);
    });

    it('"Express" is not found in "express delivery logistics"', () => {
      expect(isNamedInResume('Express', 'Worked on express delivery logistics')).toBe(false);
    });

    it('".NET" is not found inside "internet"', () => {
      expect(isNamedInResume('.NET', 'internet-scale systems')).toBe(false);
    });
  });
});

describe('classifySkillOrigins', () => {
  it('labels resume skills RESUME_EXTRACTED and invented ones MANUALLY_ADDED', () => {
    const origins = classifySkillOrigins(['React.js', 'HTML5', 'MongoDB', 'Kubernetes'], RESUME);
    expect(origins).toEqual([
      { skill: 'React.js', source: 'RESUME_EXTRACTED' },
      { skill: 'HTML5', source: 'RESUME_EXTRACTED' },
      { skill: 'MongoDB', source: 'MANUALLY_ADDED' },
      { skill: 'Kubernetes', source: 'MANUALLY_ADDED' },
    ]);
  });

  it('preserves order and reports only the manual ones as unsupported', () => {
    const origins = classifySkillOrigins(['MySQL', 'MongoDB'], RESUME);
    expect(manuallyAdded(origins)).toEqual(['MongoDB']);
  });

  it('does not stamp a genuine skill MANUALLY_ADDED because of exact-string drift', () => {
    // The old rawText.includes() check failed exactly here.
    const origins = classifySkillOrigins(['REST APIs', 'OAuth 2.0'], RESUME);
    expect(manuallyAdded(origins)).toEqual([]);
  });
});
