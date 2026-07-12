'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiGet, apiPatch, apiPost } from '@/lib/api';

type Role = 'RECRUITER' | 'HIRING_MANAGER' | 'ENGINEER';
type Status = 'SUGGESTED' | 'DRAFTED' | 'CONTACTED' | 'REPLIED' | 'ARCHIVED';

interface Contact {
  id: string;
  name: string;
  handle: string;
  role: Role;
  priority: number;
  reason: string;
  profileUrl: string;
  avatarUrl: string | null;
  bio: string | null;
  location: string | null;
  email: string | null;
  blog: string | null;
  twitter: string | null;
  sharedTech: string[];
  via: string | null;
  publicMember: boolean;
  contributions: number;
  why: string[];
  confidence: { referral: number; response: number };
  status: Status;
  draft: string | null;
}
interface LadderRung {
  kind: string;
  label: string;
  detail: string;
  action: { type: 'anchor' | 'mailto' | 'link'; value: string } | null;
  confidence: number;
}
interface Pick {
  id: string;
  name: string;
  role: Role;
}
interface Strategy {
  primary: Pick | null;
  secondary: Pick | null;
  recruiterFallback: Pick | null;
}
interface Graph {
  recruiters: number;
  leaders: number;
  engineers: number;
  contactable: number;
  total: number;
}
interface PlanStep {
  step: number;
  title: string;
  detail: string;
  stars: number;
  href?: string;
}
interface Data {
  jobTitle: string;
  companyName: string;
  contacts: Contact[];
  graph: Graph;
  strategy: Strategy;
  plan: PlanStep[];
  contactLadder: LadderRung[];
  channels: { emails: { address: string; kind: string }[] };
  searchedNote: string | null;
}

const ROLE_LABEL: Record<Role, string> = {
  RECRUITER: 'Recruiter / talent',
  HIRING_MANAGER: 'Engineering leader',
  ENGINEER: 'Engineer',
};
const ROLE_STYLE: Record<Role, string> = {
  RECRUITER: 'border-violet-800 bg-violet-950/40 text-violet-200',
  HIRING_MANAGER: 'border-amber-800 bg-amber-950/40 text-amber-200',
  ENGINEER: 'border-sky-800 bg-sky-950/40 text-sky-200',
};

export default function ReferralsPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!jobId) return;
    apiGet<Data>(`/referrals/job/${jobId}`)
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [jobId]);

  useEffect(load, [load]);

  function patchContact(id: string, patch: Partial<Contact>) {
    setData((d) =>
      d ? { ...d, contacts: d.contacts.map((c) => (c.id === id ? { ...c, ...patch } : c)) } : d,
    );
  }

  if (error)
    return (
      <Shell>
        <p className="text-red-400">{error}</p>
      </Shell>
    );
  if (!data)
    return (
      <Shell>
        <p className="text-neutral-400">Finding people who could refer you…</p>
      </Shell>
    );

  return (
    <Shell>
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ways in — {data.companyName}</h1>
          <p className="text-sm text-neutral-400">{data.jobTitle}</p>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/outreach" className="text-sm text-sky-300 hover:text-sky-200">
            Outreach inbox →
          </Link>
          <Link href={`/jobs/${jobId}`} className="text-sm text-neutral-500 hover:text-neutral-300">
            ← Back to job
          </Link>
        </div>
      </div>

      {/* The ethic, stated plainly — this is a referral tool, not a spam cannon. */}
      <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 text-[13px] leading-relaxed text-neutral-300">
        Found from <strong>public GitHub</strong> only — people who show they work here or build the
        company&apos;s open source. CareerOS never messages anyone: drafts are yours to review, edit,
        and send. <strong>One thoughtful message per person — never spam.</strong>
      </div>

      {/* Honest empty-state: says what we searched, never "no presence", points down. */}
      {data.searchedNote && (
        <p className="mt-4 rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-[13px] text-amber-200/90">
          {data.searchedNote}
        </p>
      )}

      {/* The play, not just the pile: best sequence to win this application. */}
      {data.plan.length > 0 && (
        <section className="mt-5 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-400">
            Your application success plan
          </h2>
          <ol className="mt-3 space-y-2.5">
            {data.plan.map((s) => (
              <li key={s.step} className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-neutral-800 text-[11px] text-neutral-300">
                  {s.step}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {s.href ? (
                      <Link href={s.href} className="text-[14px] font-medium text-sky-300 hover:underline">
                        {s.title} →
                      </Link>
                    ) : (
                      <span className="text-[14px] font-medium text-neutral-100">{s.title}</span>
                    )}
                    <span className="text-[11px] text-amber-300" title="How much this step moves your odds">
                      {'★'.repeat(s.stars)}
                      <span className="text-neutral-700">{'★'.repeat(5 - s.stars)}</span>
                    </span>
                  </div>
                  <p className="text-[12px] text-neutral-400">{s.detail}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[11px] text-neutral-500">★ = how much the step moves your odds. A quiet inbox never blocks you — the plan always ends in “apply anyway”.</p>
        </section>
      )}

      {/* Company graph — who is even reachable here. */}
      {data.graph.total > 0 && (
        <div className="mt-4 flex flex-wrap gap-2 text-[12px]">
          <GraphChip n={data.graph.recruiters} label="recruiter" />
          <GraphChip n={data.graph.leaders} label="eng leader" />
          <GraphChip n={data.graph.engineers} label="engineer" />
          <GraphChip n={data.graph.contactable} label="reachable" accent />
        </div>
      )}

      {/* Ways in — best first, never a dead end. */}
      {data.contactLadder.length > 0 && (
        <section className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-400">
            Ways in — best first
          </h2>
          <ol className="mt-3 space-y-2">
            {data.contactLadder.map((r, i) => (
              <LadderItem key={i} rung={r} />
            ))}
          </ol>
          <p className="mt-2 text-[11px] text-neutral-500">
            People first, then the company&apos;s own published channels, then apply anyway. Emails
            are only ones the company posted publicly — never guessed.
          </p>
        </section>
      )}

      <div className="mt-5 space-y-4">
        {data.contacts.map((c) => (
          <ContactCard key={c.id} c={c} tag={tagFor(c.id, data.strategy)} onPatch={patchContact} />
        ))}
      </div>
    </Shell>
  );
}

const LADDER_ICON: Record<string, string> = {
  REFERRAL: '🤝',
  RECRUITER: '🧭',
  HIRING_MANAGER: '👤',
  ENG_BLOG: '📝',
  COMPANY_EMAIL: '✉️',
  CAREERS_PAGE: '🌐',
  CONTACT_PAGE: '📨',
  APPLY: '🚀',
};

function LadderItem({ rung }: { rung: LadderRung }) {
  const scrollTo = () => {
    if (rung.action?.type === 'anchor') {
      document.getElementById(rung.action.value)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };
  const inner = (
    <>
      <span className="font-medium text-neutral-100">{rung.label}</span>
      <span className="text-[11px] text-amber-300" title="Reach / referral likelihood">
        {'★'.repeat(rung.confidence)}
        <span className="text-neutral-700">{'★'.repeat(5 - rung.confidence)}</span>
      </span>
    </>
  );
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 flex-none">{LADDER_ICON[rung.kind] ?? '•'}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {rung.action?.type === 'anchor' ? (
            <button onClick={scrollTo} className="text-[14px] text-sky-300 hover:underline">
              {inner}
            </button>
          ) : rung.action ? (
            <a
              href={rung.action.type === 'mailto' ? `mailto:${rung.action.value}` : rung.action.value}
              target={rung.action.type === 'link' ? '_blank' : undefined}
              rel="noreferrer"
              className="flex items-center gap-2 text-[14px] text-sky-300 hover:underline"
            >
              {inner}
            </a>
          ) : (
            <span className="flex items-center gap-2">{inner}</span>
          )}
        </div>
        <p className="text-[12px] text-neutral-400">{rung.detail}</p>
      </div>
    </li>
  );
}

function tagFor(id: string, s: Strategy): string | null {
  if (s.primary?.id === id) return 'Primary';
  if (s.secondary?.id === id) return 'Secondary';
  if (s.recruiterFallback?.id === id) return 'Recruiter fallback';
  return null;
}

function ConfidenceStat({ label, n }: { label: string; n: number }) {
  return (
    <span>
      {label}:{' '}
      <span className="text-amber-300">
        {'★'.repeat(n)}
        <span className="text-neutral-700">{'★'.repeat(5 - n)}</span>
      </span>
    </span>
  );
}

function GraphChip({ n, label, accent }: { n: number; label: string; accent?: boolean }) {
  return (
    <span
      className={`rounded-full border px-2.5 py-1 ${
        accent
          ? 'border-emerald-800 bg-emerald-950/40 text-emerald-300'
          : 'border-neutral-800 bg-neutral-900 text-neutral-300'
      }`}
    >
      <b className="tabular-nums">{n}</b> {label}
      {n === 1 ? '' : 's'}
    </span>
  );
}

function ContactCard({
  c,
  tag,
  onPatch,
}: {
  c: Contact;
  tag: string | null;
  onPatch: (id: string, patch: Partial<Contact>) => void;
}) {
  const [draft, setDraft] = useState(c.draft ?? '');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      const r = await apiPost<{ draft: string }>(`/referrals/${c.id}/draft`, {});
      setDraft(r.draft);
      onPatch(c.id, { draft: r.draft, status: c.status === 'CONTACTED' || c.status === 'REPLIED' ? c.status : 'DRAFTED' });
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: Status) {
    onPatch(c.id, { status });
    await apiPatch(`/referrals/${c.id}/status`, { status }).catch(() => undefined);
  }

  function copy() {
    navigator.clipboard.writeText(draft).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const initials = c.name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div id={`contact-${c.id}`} className="scroll-mt-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-start gap-3">
        {c.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.avatarUrl} alt="" className="h-11 w-11 rounded-full" />
        ) : (
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-800 text-sm text-neutral-300">
            {initials}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-neutral-100">{c.name}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${ROLE_STYLE[c.role]}`}>
              {ROLE_LABEL[c.role]}
            </span>
            {c.publicMember && (
              <span className="rounded-full border border-emerald-800 bg-emerald-950/40 px-2 py-0.5 text-[11px] text-emerald-300">
                verified employee
              </span>
            )}
            {tag && (
              <span className="rounded-full border border-violet-700 bg-violet-950/50 px-2 py-0.5 text-[11px] font-medium text-violet-200">
                {tag}
              </span>
            )}
            <span className="ml-auto text-[11px] tabular-nums text-neutral-500">
              match {c.priority}
            </span>
          </div>
          <ul className="mt-1.5 space-y-0.5">
            {c.why.map((w, i) => (
              <li key={i} className="text-[12.5px] text-neutral-300">
                <span className="text-emerald-400">✓</span> {w}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-400">
            <ConfidenceStat label="Referral likelihood" n={c.confidence.referral} />
            <ConfidenceStat label="Response likelihood" n={c.confidence.response} />
          </div>

          {c.sharedTech.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {c.sharedTech.map((t) => (
                <span
                  key={t}
                  className="rounded border border-neutral-700 bg-neutral-950/60 px-1.5 py-0.5 text-[11px] text-neutral-300"
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          <div className="mt-2 flex flex-wrap gap-3 text-[12px]">
            <a href={c.profileUrl} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
              GitHub ↗
            </a>
            {c.email && (
              <a href={`mailto:${c.email}`} className="text-sky-300 hover:underline">
                Email ↗
              </a>
            )}
            {c.blog && (
              <a href={c.blog} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
                Site ↗
              </a>
            )}
            {c.twitter && (
              <a
                href={`https://x.com/${c.twitter}`}
                target="_blank"
                rel="noreferrer"
                className="text-sky-300 hover:underline"
              >
                X ↗
              </a>
            )}
            {c.location && <span className="text-neutral-500">{c.location}</span>}
          </div>
        </div>
      </div>

      {/* Outreach — a draft the user owns. */}
      <div className="mt-3 border-t border-neutral-800 pt-3">
        {draft ? (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={8}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-[13px] leading-relaxed text-neutral-200 focus:border-neutral-500 focus:outline-none"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                onClick={copy}
                className="rounded-lg bg-neutral-100 px-3 py-1.5 text-[13px] font-medium text-neutral-950 hover:bg-white"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
              <button
                onClick={generate}
                disabled={busy}
                className="rounded-lg border border-neutral-700 px-3 py-1.5 text-[13px] text-neutral-300 hover:border-neutral-500 disabled:opacity-50"
              >
                {busy ? 'Rewriting…' : 'Regenerate'}
              </button>
              <StatusControls status={c.status} onSet={setStatus} />
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={generate}
              disabled={busy}
              className="rounded-lg border border-violet-800 bg-violet-950/40 px-3 py-1.5 text-[13px] font-medium text-violet-200 hover:bg-violet-900/40 disabled:opacity-50"
            >
              {busy ? 'Writing…' : '✍️ Draft an intro'}
            </button>
            <StatusControls status={c.status} onSet={setStatus} />
          </div>
        )}
      </div>
    </div>
  );
}

function StatusControls({ status, onSet }: { status: Status; onSet: (s: Status) => void }) {
  if (status === 'REPLIED')
    return <span className="text-[12px] text-emerald-400">💬 Replied</span>;
  if (status === 'CONTACTED')
    return (
      <>
        <span className="text-[12px] text-amber-300">✓ Reached out</span>
        <button onClick={() => onSet('REPLIED')} className="text-[12px] text-neutral-400 hover:text-neutral-200">
          Got a reply
        </button>
      </>
    );
  return (
    <button
      onClick={() => onSet('CONTACTED')}
      className="rounded-lg border border-neutral-700 px-3 py-1.5 text-[13px] text-neutral-300 hover:border-neutral-500"
    >
      I reached out
    </button>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-8 text-neutral-100">
      <div className="mx-auto w-full max-w-3xl">{children}</div>
    </main>
  );
}
