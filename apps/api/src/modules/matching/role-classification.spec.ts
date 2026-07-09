import {
  actionFor,
  DEFAULT_ROLE_PROFILE,
  eligibility,
  experienceVerdict,
  roleRelevance,
  targetFit,
  type JobClassification,
  type RoleProfile,
  type TargetFit,
} from './role-classification';

const SUYASH: RoleProfile = { ...DEFAULT_ROLE_PROFILE, yearsExperience: 2 };

function classification(over: Partial<JobClassification> = {}): JobClassification {
  return {
    primaryFunction: 'SOFTWARE_ENGINEERING',
    roleFamily: 'FULL_STACK',
    specialization: ['WEB'],
    codingIntensity: 'PRIMARY',
    developmentConfidence: 95,
    seniority: 'MID',
    minimumYears: 2,
    maximumYears: 4,
    requiredSkills: ['Node.js', 'React'],
    preferredSkills: [],
    responsibilities: [],
    developmentEvidence: ['Build backend services'],
    nonDevelopmentEvidence: [],
    classificationReason: 'builds web software end to end',
    ...over,
  };
}

describe('targetFit', () => {
  it('accepts the target families', () => {
    for (const roleFamily of DEFAULT_ROLE_PROFILE.targetFamilies) {
      expect(targetFit(classification({ roleFamily }), SUYASH)).toBe('TARGET');
    }
  });

  it('marks adjacent families adjacent, not target', () => {
    expect(targetFit(classification({ roleFamily: 'SOLUTIONS_ENGINEERING' }), SUYASH)).toBe('ADJACENT');
    expect(targetFit(classification({ roleFamily: 'FRONTEND' }), SUYASH)).toBe('ADJACENT');
  });

  it('rejects excluded families outright', () => {
    for (const roleFamily of DEFAULT_ROLE_PROFILE.excludedFamilies) {
      expect(targetFit(classification({ roleFamily }), SUYASH)).toBe('NON_TARGET');
    }
  });
});

describe('roleRelevance is reported separately from resume match', () => {
  it('scores a genuine full-stack role high', () => {
    expect(roleRelevance(classification(), SUYASH)).toBeGreaterThanOrEqual(90);
  });

  // The Paytm Tag Manager role: 65% resume match, and the wrong kind of work.
  it('scores a marketing-analytics role low despite JavaScript overlap', () => {
    const tagManager = classification({
      primaryFunction: 'MARKETING_GROWTH',
      roleFamily: 'DIGITAL_MARKETING',
      codingIntensity: 'OCCASIONAL',
      developmentConfidence: 25,
    });
    expect(roleRelevance(tagManager, SUYASH)).toBeLessThan(30);
  });
});

describe('experienceVerdict — a band, not an equation', () => {
  it.each([
    [0, true, false],
    [1, true, false],
    [2, true, false],
    [3, true, true], // one year over: stretch, may CONSIDER, never auto-APPLY
    [4, false, false],
    [5, false, false],
    [6, false, false],
  ])('minimumYears %i → eligible=%s capsAtConsider=%s', (min, eligible, caps) => {
    const v = experienceVerdict(classification({ minimumYears: min }), 2);
    expect(v.eligible).toBe(eligible);
    expect(v.capsAtConsider).toBe(caps);
  });

  it('rejects senior/lead/staff titles regardless of a missing minimum', () => {
    for (const seniority of ['SENIOR', 'LEAD', 'STAFF', 'PRINCIPAL'] as const) {
      expect(experienceVerdict(classification({ seniority, minimumYears: null }), 2).eligible).toBe(false);
    }
  });

  it('trusts an explicit low minimum over "Senior" in the title', () => {
    const v = experienceVerdict(classification({ seniority: 'SENIOR', minimumYears: 2 }), 2);
    expect(v.eligible).toBe(true);
  });

  it('allows a role with no stated requirement', () => {
    expect(experienceVerdict(classification({ minimumYears: null }), 2).eligible).toBe(true);
  });
});

describe('eligibility — the hard gate, from the nine false recommendations', () => {
  it('1. Razorpay "Full Stack Builder": technical PM, 3-6y, no stack — never APPLY', () => {
    const e = eligibility(
      classification({
        primaryFunction: 'PRODUCT_MANAGEMENT',
        roleFamily: 'PRODUCT_MANAGEMENT',
        codingIntensity: 'SUBSTANTIAL',
        developmentConfidence: 40,
        seniority: 'MID',
        minimumYears: 3,
        maximumYears: 6,
        nonDevelopmentEvidence: ['technical PM', 'product sense', 'should be able to read code'],
      }),
      SUYASH,
    );
    expect(e.eligible).toBe(false);
    expect(e.fit).toBe('NON_TARGET');
    expect(e.roleRelevance).toBeLessThan(30);
  });

  it('2. Paytm "Analytics and Tag Manager Implementation Specialist" — marketing', () => {
    const e = eligibility(
      classification({
        primaryFunction: 'MARKETING_GROWTH',
        roleFamily: 'DIGITAL_MARKETING',
        codingIntensity: 'OCCASIONAL',
        developmentConfidence: 25,
        minimumYears: null,
        nonDevelopmentEvidence: ['join our digital marketing team', 'Google Tag Manager'],
      }),
      SUYASH,
    );
    expect(e.eligible).toBe(false);
    expect(e.needsReview).toBe(false);
    expect(e.reason).toMatch(/marketing growth/);
  });

  it('3. AbhiBus "Associate Product Manager" — product', () => {
    const e = eligibility(
      classification({
        primaryFunction: 'PRODUCT_MANAGEMENT',
        roleFamily: 'PRODUCT_MANAGEMENT',
        codingIntensity: 'NONE',
        developmentConfidence: 5,
      }),
      SUYASH,
    );
    expect(e.eligible).toBe(false);
  });

  it('4. Webito "QA Analyst" — QA', () => {
    const e = eligibility(
      classification({
        primaryFunction: 'QA_TEST_ENGINEERING',
        roleFamily: 'MANUAL_QA',
        codingIntensity: 'OCCASIONAL',
        developmentConfidence: 30,
      }),
      SUYASH,
    );
    expect(e.eligible).toBe(false);
  });

  it('5. PhonePe "Service Delivery Engineer, SRE" — operations', () => {
    const e = eligibility(
      classification({
        primaryFunction: 'DEVOPS_SRE',
        roleFamily: 'DEVOPS_SRE',
        codingIntensity: 'SUBSTANTIAL',
        developmentConfidence: 60,
      }),
      SUYASH,
    );
    expect(e.eligible).toBe(false);
    expect(e.fit).toBe('NON_TARGET');
  });

  it('6. PhonePe "Software Engineer, Android" — real dev, wrong stack', () => {
    const e = eligibility(
      classification({
        primaryFunction: 'SOFTWARE_ENGINEERING',
        roleFamily: 'NATIVE_ANDROID',
        codingIntensity: 'PRIMARY',
        developmentConfidence: 95,
      }),
      SUYASH,
    );
    // Genuine software engineering. Still not this user's family.
    expect(e.eligible).toBe(false);
    expect(e.fit).toBe('NON_TARGET');
    // And say so honestly — never "building software is not the core responsibility".
    expect(e.code).toBe('DEVELOPMENT_WRONG_SPECIALIZATION');
    expect(e.reason).toBe('genuine native android role, but outside your Node.js/MERN/full-stack targets');
  });

  it('7. Groww "Intern - Growth (AI & MarTech)" — marketing', () => {
    const e = eligibility(
      classification({
        primaryFunction: 'MARKETING_GROWTH',
        roleFamily: 'DIGITAL_MARKETING',
        codingIntensity: 'OCCASIONAL',
        developmentConfidence: 30,
        seniority: 'INTERN',
      }),
      SUYASH,
    );
    expect(e.eligible).toBe(false);
  });

  it('8. Paytm "Business Analyst" — SQL and Power BI', () => {
    const e = eligibility(
      classification({
        primaryFunction: 'BUSINESS_ANALYTICS',
        roleFamily: 'BUSINESS_ANALYTICS',
        codingIntensity: 'OCCASIONAL',
        developmentConfidence: 20,
      }),
      SUYASH,
    );
    expect(e.eligible).toBe(false);
  });
});

describe('eligibility — positive controls must survive the gate', () => {
  it('Full Stack Developer, React + Node.js', () => {
    expect(eligibility(classification(), SUYASH).eligible).toBe(true);
  });

  it('Backend Engineer, Node.js + REST + PostgreSQL', () => {
    const e = eligibility(classification({ roleFamily: 'BACKEND', minimumYears: 1 }), SUYASH);
    expect(e.eligible).toBe(true);
    expect(e.fit).toBe('TARGET');
  });

  it('SDE I building web services in JavaScript', () => {
    const e = eligibility(classification({ roleFamily: 'SDE', seniority: 'JUNIOR', minimumYears: 0 }), SUYASH);
    expect(e.eligible).toBe(true);
  });

  it('Product Engineer who primarily builds React and Node applications', () => {
    const e = eligibility(
      classification({ roleFamily: 'APPLICATION_ENGINEERING', codingIntensity: 'PRIMARY', developmentConfidence: 90 }),
      SUYASH,
    );
    expect(e.eligible).toBe(true);
    expect(e.fit).toBe('ADJACENT');
  });

  it('a 3-year requirement is eligible but can never auto-APPLY', () => {
    const e = eligibility(classification({ minimumYears: 3 }), SUYASH);
    expect(e.eligible).toBe(true);
    expect(e.capsAtConsider).toBe(true);
  });
});

describe('eligibility — ambiguous roles go to review, never to APPLY', () => {
  it('Solutions Engineer that builds production integrations', () => {
    const e = eligibility(
      classification({
        roleFamily: 'SOLUTIONS_ENGINEERING',
        codingIntensity: 'PRIMARY',
        developmentConfidence: 85,
        developmentEvidence: ['builds production integrations', 'writes Node.js services'],
      }),
      SUYASH,
    );
    expect(e.eligible).toBe(true);
    expect(e.fit).toBe('ADJACENT');
  });

  it('Solutions Engineer that demos products for sales', () => {
    const e = eligibility(
      classification({
        primaryFunction: 'SALES_PRE_SALES',
        roleFamily: 'SALES',
        codingIntensity: 'INCIDENTAL',
        developmentConfidence: 15,
      }),
      SUYASH,
    );
    expect(e.eligible).toBe(false);
    expect(e.needsReview).toBe(false);
  });

  it('an adjacent family with merely substantial coding needs a human look', () => {
    const e = eligibility(
      classification({
        roleFamily: 'INTEGRATION_ENGINEERING',
        codingIntensity: 'SUBSTANTIAL',
        developmentConfidence: 85,
      }),
      SUYASH,
    );
    expect(e.eligible).toBe(false);
    expect(e.needsReview).toBe(true);
  });

  // Real JD, Deepgram: adjacent family, 60% confidence — but SENIOR. An
  // unreachable role must not consume review attention.
  it('a senior ambiguous role is rejected outright, not sent to review', () => {
    const e = eligibility(
      classification({
        primaryFunction: 'IMPLEMENTATION_SERVICES',
        roleFamily: 'SOLUTIONS_ENGINEERING',
        codingIntensity: 'SUBSTANTIAL',
        developmentConfidence: 60,
        seniority: 'SENIOR',
        minimumYears: null,
      }),
      SUYASH,
    );
    expect(e.eligible).toBe(false);
    expect(e.needsReview).toBe(false);
    expect(e.reason).toMatch(/senior role/);
  });

  // Real JD, "Member of Technical Staff, AI Reliability": SRE work, coded daily.
  it('names an SRE role as engineering outside the target families', () => {
    const e = eligibility(
      classification({
        primaryFunction: 'DEVOPS_SRE',
        roleFamily: 'DEVOPS_SRE',
        codingIntensity: 'SUBSTANTIAL',
        developmentConfidence: 85,
        seniority: 'MID',
      }),
      SUYASH,
    );
    expect(e.eligible).toBe(false);
    expect(e.code).toBe('DEVELOPMENT_WRONG_SPECIALIZATION');
    expect(e.reason).toBe('genuine devops sre role, but outside your Node.js/MERN/full-stack targets');
  });

  it('an AMBIGUOUS classification never becomes eligible', () => {
    const e = eligibility(
      classification({ primaryFunction: 'AMBIGUOUS', roleFamily: 'AMBIGUOUS', developmentConfidence: 90 }),
      SUYASH,
    );
    expect(e.eligible).toBe(false);
    expect(e.needsReview).toBe(true);
    expect(e.fit).toBe('AMBIGUOUS');
  });

  it('low development confidence sends a target role to review, not to APPLY', () => {
    const e = eligibility(classification({ developmentConfidence: 55 }), SUYASH);
    expect(e.eligible).toBe(false);
    expect(e.needsReview).toBe(true);
  });

  it('Engineering Manager with no hands-on coding', () => {
    const e = eligibility(
      classification({
        primaryFunction: 'PROJECT_PROGRAM_MANAGEMENT',
        roleFamily: 'ENGINEERING_MANAGEMENT',
        codingIntensity: 'INCIDENTAL',
        developmentConfidence: 20,
      }),
      SUYASH,
    );
    expect(e.eligible).toBe(false);
  });

  it('React Native: genuine development, adjacent family, still gated on stack', () => {
    const e = eligibility(
      classification({ roleFamily: 'REACT', codingIntensity: 'PRIMARY', developmentConfidence: 90 }),
      SUYASH,
    );
    expect(e.fit).toBe('ADJACENT');
    expect(e.eligible).toBe(true); // eligible to be SCORED; stack fit decides the verdict
  });
});

describe('rejection reasons are never collapsed', () => {
  // "Not a development role" said about an Android engineer is a lie, and a
  // user who catches the system lying once stops trusting the true reasons.
  it('gives a distinct code to each kind of refusal', () => {
    const codes = [
      eligibility(classification({ primaryFunction: 'MARKETING_GROWTH', roleFamily: 'DIGITAL_MARKETING', codingIntensity: 'OCCASIONAL', developmentConfidence: 10 }), SUYASH).code,
      eligibility(classification({ roleFamily: 'NATIVE_ANDROID' }), SUYASH).code,
      eligibility(classification({ minimumYears: 6, seniority: 'SENIOR' }), SUYASH).code,
      eligibility(classification({ minimumYears: 3 }), SUYASH).code,
      eligibility(classification(), SUYASH).code,
      eligibility(classification({ developmentConfidence: 55 }), SUYASH).code,
      eligibility(classification({ primaryFunction: 'AMBIGUOUS', roleFamily: 'AMBIGUOUS' }), SUYASH).code,
    ];
    expect(codes).toEqual([
      'NOT_DEVELOPMENT',
      'DEVELOPMENT_WRONG_SPECIALIZATION',
      'TARGET_ROLE_TOO_SENIOR',
      'TARGET_ROLE_EXPERIENCE_STRETCH',
      'TARGET_ROLE_ELIGIBLE',
      'LOW_CONFIDENCE',
      'AMBIGUOUS_NEEDS_REVIEW',
    ]);
  });

  it('data engineering is excluded as a specialization, not denied as development', () => {
    const e = eligibility(
      classification({
        primaryFunction: 'DATA_ENGINEERING',
        roleFamily: 'DATA_ENGINEERING',
        codingIntensity: 'PRIMARY',
        developmentConfidence: 100,
      }),
      SUYASH,
    );
    expect(e.eligible).toBe(false);
    expect(e.code).toBe('DEVELOPMENT_WRONG_SPECIALIZATION');
    expect(e.reason).toMatch(/genuine data engineering role/);
  });

  it('states the experience stretch in the user-facing wording', () => {
    const e = eligibility(classification({ minimumYears: 3, maximumYears: 6 }), SUYASH);
    expect(e.reason).toBe(
      'Experience stretch: JD requests 3–6 years; your profile has approximately 2 years',
    );
  });
});

describe('the four dimensions must not be blended', () => {
  // Real production classifications, 2026-07-10.
  const abhibus = classification({
    roleFamily: 'FULL_STACK',
    developmentConfidence: 100,
    requiredSkills: ['React.js', 'Node.js', 'JavaScript', 'HTML5', 'CSS3', 'MySQL', 'MongoDB', 'Cassandra'],
    minimumYears: 3,
    maximumYears: 4,
  });
  const reactNative = classification({
    roleFamily: 'SDE',
    developmentConfidence: 100,
    requiredSkills: ['React Native', 'JavaScript', 'TypeScript', 'ES6+', 'XCode', 'Gradle', 'REST APIs'],
    minimumYears: 3,
    maximumYears: 5,
  });
  const appliedAi = classification({
    roleFamily: 'GENERAL_SOFTWARE_ENGINEERING',
    developmentConfidence: 100,
    requiredSkills: ['Python', 'LLMs', 'Anthropic', 'OpenAI'],
    minimumYears: 1,
    maximumYears: 4,
  });

  it('an exact Node.js + React role is target on every dimension', () => {
    const e = eligibility(abhibus, SUYASH);
    expect(e.fit).toBe('TARGET');
    expect(e.targetRoleFit).toBe(100);
    expect(e.specializationFit).toBeGreaterThanOrEqual(70);
    expect(e.capsAtConsider).toBe(true); // 3y vs 2y
  });

  it('React Native is 100% software and NOT 100% my role', () => {
    const e = eligibility(reactNative, SUYASH);
    expect(e.developmentConfidence).toBe(100);
    // "React Native" must not count as "React".
    expect(e.specializationFit).toBeLessThanOrEqual(50);
    // A neutrally-titled SDE role whose required stack is React Native is mobile.
    expect(e.fit).toBe('ADJACENT');
    expect(e.targetRoleFit).toBeLessThan(100);
  });

  it('an LLM engineering role is software, but not this stack', () => {
    const e = eligibility(appliedAi, SUYASH);
    expect(e.developmentConfidence).toBe(100);
    expect(e.specializationFit).toBe(0);
    expect(e.fit).toBe('ADJACENT');
  });
});

describe('actionFor — what to DO, not what the system concluded', () => {
  const base = { verdict: 'CONSIDER' as const, fit: 'TARGET' as TargetFit, capsAtConsider: true };

  it('a one-year stretch on the exact role and stack is WORTH_APPLYING', () => {
    expect(
      actionFor({ ...base, targetRoleFit: 100, specializationFit: 88, resumeFit: 78 }),
    ).toBe('WORTH_APPLYING');
  });

  it('an adjacent specialization is REVIEW_FIRST, not a silent skip', () => {
    expect(
      actionFor({ ...base, fit: 'ADJACENT', targetRoleFit: 71, specializationFit: 57, resumeFit: 55 }),
    ).toBe('REVIEW_FIRST');
  });

  it('a foreign stack is LOW_PRIORITY however good the score', () => {
    expect(
      actionFor({ ...base, fit: 'ADJACENT', targetRoleFit: 65, specializationFit: 0, resumeFit: 65 }),
    ).toBe('LOW_PRIORITY');
  });

  it('APPLY is APPLY_NOW; SKIP is SKIP; NEEDS_REVIEW is REVIEW_FIRST', () => {
    const args = { targetRoleFit: 100, specializationFit: 90, resumeFit: 80, fit: 'TARGET' as TargetFit, capsAtConsider: false };
    expect(actionFor({ ...args, verdict: 'APPLY' })).toBe('APPLY_NOW');
    expect(actionFor({ ...args, verdict: 'SKIP' })).toBe('SKIP');
    expect(actionFor({ ...args, verdict: 'NEEDS_REVIEW' })).toBe('REVIEW_FIRST');
  });
});

describe('Needs Review holds genuine uncertainty, not obvious non-development', () => {
  it('a zero-coding, zero-confidence AMBIGUOUS job is rejected, not queued', () => {
    const e = eligibility(
      classification({
        primaryFunction: 'AMBIGUOUS',
        roleFamily: 'AMBIGUOUS',
        codingIntensity: 'NONE',
        developmentConfidence: 0,
      }),
      SUYASH,
    );
    expect(e.needsReview).toBe(false);
    expect(e.code).toBe('NOT_DEVELOPMENT');
  });

  it('an ambiguous job with some development signal still goes to review', () => {
    const e = eligibility(
      classification({
        primaryFunction: 'AMBIGUOUS',
        roleFamily: 'AMBIGUOUS',
        codingIntensity: 'OCCASIONAL',
        developmentConfidence: 45,
      }),
      SUYASH,
    );
    expect(e.needsReview).toBe(true);
  });
});

describe('the invariant that was violated in production', () => {
  it('freshness and resume match cannot rescue an ineligible role', () => {
    // Paytm Tag Manager: resumeMatch 65, freshness 100, opportunityScore 77 → APPLY.
    // Eligibility runs before any of those weights and does not see them.
    const e = eligibility(
      classification({
        primaryFunction: 'MARKETING_GROWTH',
        roleFamily: 'DIGITAL_MARKETING',
        codingIntensity: 'OCCASIONAL',
        developmentConfidence: 25,
      }),
      SUYASH,
    );
    expect(e.eligible).toBe(false);
  });
});
