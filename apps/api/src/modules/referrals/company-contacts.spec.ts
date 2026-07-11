import { classifyEmail, extractEmails } from './company-contacts';

describe('classifyEmail', () => {
  it('recognises recruiting mailboxes', () => {
    for (const l of ['careers', 'jobs', 'hiring', 'recruiting', 'talent', 'hr', 'people'])
      expect(classifyEmail(l)).toBe('RECRUITING');
  });
  it('recognises general mailboxes and everything else', () => {
    expect(classifyEmail('hello')).toBe('GENERAL');
    expect(classifyEmail('info')).toBe('GENERAL');
    expect(classifyEmail('priya.sharma')).toBe('OTHER');
  });
});

describe('extractEmails', () => {
  const html = `
    <a href="mailto:careers@acme.com">Join us</a>
    Reach us at hello@acme.com or info@acme.com.
    Vendor: support@sentry.io  Placeholder: you@example.com
    Third party: sales@othercorp.com
  `;

  it('keeps only same-domain company mailboxes and ranks recruiting first', () => {
    const emails = extractEmails(html, 'acme.com');
    expect(emails[0]).toEqual({ address: 'careers@acme.com', kind: 'RECRUITING' });
    const addrs = emails.map((e) => e.address);
    expect(addrs).toContain('hello@acme.com');
    expect(addrs).not.toContain('support@sentry.io'); // third-party widget
    expect(addrs).not.toContain('sales@othercorp.com'); // different company
    expect(addrs).not.toContain('you@example.com'); // placeholder
  });

  it('when the domain is unknown, still drops junk/placeholder addresses', () => {
    const emails = extractEmails(html, null);
    const addrs = emails.map((e) => e.address);
    expect(addrs).toContain('careers@acme.com');
    expect(addrs).not.toContain('you@example.com');
  });
});
