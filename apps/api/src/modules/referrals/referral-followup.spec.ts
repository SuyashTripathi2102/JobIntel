import { followUpPrompt, nextOutreachAction, type OutreachContactState } from './referral-followup';

const days = (n: number) => new Date(Date.now() - n * 86_400_000);
const state = (over: Partial<OutreachContactState>): OutreachContactState => ({
  status: 'CONTACTED',
  contactedAt: days(0),
  repliedAt: null,
  followUpCount: 0,
  lastFollowUpAt: null,
  ...over,
});

describe('nextOutreachAction', () => {
  it('drafted-but-unsent → send your intro', () => {
    const a = nextOutreachAction(state({ status: 'DRAFTED', contactedAt: null }));
    expect(a.action).toBe('CONTACT');
    expect(a.due).toBe(true);
  });

  it('contacted, still fresh → await (not due)', () => {
    const a = nextOutreachAction(state({ contactedAt: days(1) }));
    expect(a.action).toBe('AWAIT');
    expect(a.due).toBe(false);
    expect(a.label).toMatch(/Follow up in 2 days/);
  });

  it('contacted, silent 3+ days, no nudges → first follow-up due', () => {
    const a = nextOutreachAction(state({ contactedAt: days(4), followUpCount: 0 }));
    expect(a.action).toBe('FOLLOW_UP');
    expect(a.due).toBe(true);
    expect(a.daysSince).toBe(4);
  });

  it('measures the second nudge from the last follow-up, not first contact', () => {
    const notYet = nextOutreachAction(
      state({ contactedAt: days(10), followUpCount: 1, lastFollowUpAt: days(2) }),
    );
    expect(notYet.action).toBe('AWAIT'); // only 2 days since the first nudge
    const due = nextOutreachAction(
      state({ contactedAt: days(20), followUpCount: 1, lastFollowUpAt: days(6) }),
    );
    expect(due.action).toBe('FOLLOW_UP_2');
    expect(due.due).toBe(true);
  });

  it('caps at two nudges — then rest', () => {
    const a = nextOutreachAction(state({ followUpCount: 2, lastFollowUpAt: days(30) }));
    expect(a.action).toBe('RESTING');
    expect(a.due).toBe(false);
  });

  it('replied always surfaces as the top action', () => {
    const a = nextOutreachAction(state({ status: 'REPLIED', repliedAt: days(1) }));
    expect(a.action).toBe('REPLIED');
    expect(a.urgency).toBe(3);
  });
});

describe('followUpPrompt', () => {
  it('is short, references the role, and softens the second nudge', () => {
    const p2 = followUpPrompt(
      { name: 'Suyash' },
      { title: 'Backend Engineer', company: 'Postman' },
      { name: 'Asha', role: 'ENGINEER' },
      2,
    );
    expect(p2.prompt).toContain('Backend Engineer');
    expect(p2.prompt).toContain('Asha');
    expect(p2.system).toMatch(/40–70 words/);
    expect(p2.system).toMatch(/SECOND and final/);
  });
});
