/**
 * Outreach follow-up engine — the "what next, and when" for a contact you've
 * reached out to. Pure and deterministic: it decides when a nudge is DUE and
 * builds the (honest, low-pressure) follow-up prompt. It never sends anything —
 * CareerOS surfaces the action; the user sends the message themselves.
 *
 * Cadence, deliberately restrained: first nudge after 3 days of silence, a
 * second after 5 more, then stop. Two nudges is the ceiling — persistence helps,
 * pestering doesn't, and a good tool protects the user's reputation.
 */
import type { ReferralRole } from './referral-ranking';

export type OutreachAction =
  | 'CONTACT' // drafted but not sent yet
  | 'FOLLOW_UP' // contacted, silent, first nudge due
  | 'FOLLOW_UP_2' // first nudge sent, still silent, second nudge due
  | 'AWAIT' // contacted, not yet time to nudge
  | 'RESTING' // two nudges sent — let it go
  | 'REPLIED' // they replied — advance the conversation
  | 'NONE';

export interface OutreachContactState {
  status: string; // SUGGESTED | DRAFTED | CONTACTED | REPLIED | ARCHIVED
  contactedAt: Date | null;
  repliedAt: Date | null;
  followUpCount: number;
  lastFollowUpAt: Date | null;
}

export interface NextAction {
  action: OutreachAction;
  label: string;
  detail: string;
  due: boolean; // needs the user's attention now
  urgency: number; // 0–3, for sorting the inbox
  daysSince: number | null; // since the last outreach touch
}

const DAY = 86_400_000;
const FIRST_NUDGE_DAYS = 3;
const SECOND_NUDGE_AFTER_DAYS = 5; // measured from the first nudge
const MAX_NUDGES = 2;

export function nextOutreachAction(c: OutreachContactState, now: Date = new Date()): NextAction {
  if (c.status === 'REPLIED') {
    return {
      action: 'REPLIED',
      label: 'Replied — take it forward',
      detail: 'They responded. Keep the thread going: the referral ask, a quick call, or a thank-you.',
      due: true,
      urgency: 3,
      daysSince: null,
    };
  }
  if (c.status === 'DRAFTED') {
    return {
      action: 'CONTACT',
      label: 'Send your intro',
      detail: "You've drafted a message — send it, then mark it below.",
      due: true,
      urgency: 2,
      daysSince: null,
    };
  }
  if (c.status === 'CONTACTED') {
    const last = (c.lastFollowUpAt ?? c.contactedAt)?.getTime() ?? now.getTime();
    const daysSince = Math.max(0, Math.floor((now.getTime() - last) / DAY));
    if (c.followUpCount >= MAX_NUDGES) {
      return {
        action: 'RESTING',
        label: 'Two nudges sent — let it rest',
        detail: "You've followed up twice. Put your energy into other leads.",
        due: false,
        urgency: 0,
        daysSince,
      };
    }
    const threshold = c.followUpCount === 0 ? FIRST_NUDGE_DAYS : SECOND_NUDGE_AFTER_DAYS;
    if (daysSince >= threshold) {
      const second = c.followUpCount >= 1;
      return {
        action: second ? 'FOLLOW_UP_2' : 'FOLLOW_UP',
        label: second ? 'Second nudge is due' : 'Follow up — no reply yet',
        detail: `No reply in ${daysSince} day${daysSince === 1 ? '' : 's'}. A short, polite nudge lifts reply rates.`,
        due: true,
        urgency: daysSince >= threshold + 3 ? 3 : 2,
        daysSince,
      };
    }
    const inDays = threshold - daysSince;
    return {
      action: 'AWAIT',
      label: `Follow up in ${inDays} day${inDays === 1 ? '' : 's'}`,
      detail: 'Give them a little time before the next nudge.',
      due: false,
      urgency: 1,
      daysSince,
    };
  }
  return { action: 'NONE', label: '', detail: '', due: false, urgency: 0, daysSince: null };
}

/** Prompt for a short, warm follow-up nudge the USER reviews and sends. */
export function followUpPrompt(
  user: { name: string },
  job: { title: string; company: string },
  person: { name: string; role: ReferralRole },
  nudgeNumber: number,
): { system: string; prompt: string } {
  const system = [
    'You write a VERY short, warm follow-up nudge that a job seeker will review and send themselves.',
    'Hard rules:',
    '- 40–70 words. Plain text. Sound human, never templated or needy.',
    '- Gently reference the earlier message; do not repeat it. One soft ask.',
    '- Make it trivial to reply OR to ignore — never guilt-trip, never "just bumping this up" spam.',
    nudgeNumber >= 2
      ? '- This is the SECOND and final nudge: keep it especially light and give them an easy out.'
      : '- This is the first nudge after a few days of silence.',
    'Return JSON: {"subject": string, "body": string}, signed with the sender\'s first name.',
  ].join('\n');

  const prompt = [
    `Sender: ${user.name}`,
    `Recipient: ${person.name} (${person.role === 'RECRUITER' ? 'recruiter' : person.role === 'HIRING_MANAGER' ? 'engineering leader' : 'engineer'} at ${job.company})`,
    `Context: ${user.name} earlier reached out about the "${job.title}" role at ${job.company} and hasn't heard back.`,
    `Write the follow-up now.`,
  ].join('\n');

  return { system, prompt };
}
