import { detectAts } from '@careeros/shared';

describe('detectAts (shared)', () => {
  const cases: [string, string, string | null][] = [
    ['https://boards.greenhouse.io/stripe', 'GREENHOUSE', 'stripe'],
    ['https://boards.greenhouse.io/stripe/jobs/123', 'GREENHOUSE', 'stripe'],
    ['https://job-boards.greenhouse.io/airbnb', 'GREENHOUSE', 'airbnb'],
    ['https://boards.greenhouse.io/embed/job_board?for=acme', 'GREENHOUSE', 'acme'],
    ['https://jobs.lever.co/plaid', 'LEVER', 'plaid'],
    ['https://jobs.lever.co/plaid/uuid-123', 'LEVER', 'plaid'],
    ['https://jobs.ashbyhq.com/openai', 'ASHBY', 'openai'],
    ['https://acme.wd5.myworkdayjobs.com/External', 'WORKDAY', 'acme/External'],
    ['https://bunq.recruitee.com/o/lead-dev', 'RECRUITEE', 'bunq'],
    ['https://acme.teamtailor.com/jobs', 'TEAMTAILOR', 'acme'],
    ['https://jobs.smartrecruiters.com/Bosch/123', 'SMARTRECRUITERS', 'Bosch'],
    ['https://apply.workable.com/ironclad/', 'WORKABLE', 'ironclad'],
    ['https://apply.workable.com/ironclad/j/ABC123/', 'WORKABLE', 'ironclad'],
    ['https://acme.workable.com', 'WORKABLE', 'acme'],
    ['https://mason.breezy.hr/p/some-role', 'BREEZY', 'mason'],
    // Negatives — must not misfire:
    ['https://www.workable.com/pricing', 'UNKNOWN', null],
    ['https://app.breezy.hr/login', 'UNKNOWN', null],
    ['https://remoteok.com/remote-jobs/x', 'UNKNOWN', null],
    ['https://stripe.com/jobs', 'UNKNOWN', null],
    ['not a url at all', 'UNKNOWN', null],
  ];

  it.each(cases)('%s -> %s/%s', (url, provider, identifier) => {
    const result = detectAts(url);
    expect(result.provider).toBe(provider);
    expect(result.identifier).toBe(identifier);
  });

  it('workable api path is not an account', () => {
    expect(detectAts('https://apply.workable.com/api/v1/widget/accounts/x').identifier).toBeNull();
  });
});
