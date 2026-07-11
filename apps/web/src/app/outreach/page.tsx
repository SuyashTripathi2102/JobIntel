'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet, apiPatch, apiPost } from '@/lib/api';

interface NextAction {
  action: string;
  label: string;
  detail: string;
  due: boolean;
  urgency: number;
  daysSince: number | null;
}
interface Item {
  id: string;
  name: string;
  role: 'RECRUITER' | 'HIRING_MANAGER' | 'ENGINEER';
  companyName: string;
  jobId: string | null;
  status: string;
  followUpCount: number;
  profileUrl: string;
  email: string | null;
  nextAction: NextAction;
}
interface Inbox {
  dueCount: number;
  total: number;
  items: Item[];
}

const ROLE_LABEL: Record<string, string> = {
  RECRUITER: 'Recruiter',
  HIRING_MANAGER: 'Eng leader',
  ENGINEER: 'Engineer',
};

export default function OutreachPage() {
  const [data, setData] = useState<Inbox | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<Inbox>('/referrals/outreach')
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(load, [load]);

  if (error) return <Shell><p className="text-red-400">{error}</p></Shell>;
  if (!data) return <Shell><p className="text-neutral-400">Loading your outreach…</p></Shell>;

  return (
    <Shell>
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Outreach</h1>
          <p className="text-sm text-neutral-400">
            Everyone you&apos;ve reached out to — who needs a nudge today, and what to say.
            CareerOS never sends anything; drafts are yours.
          </p>
        </div>
        <a href="/" className="text-sm text-neutral-500 hover:text-neutral-300">
          Mission Control
        </a>
      </div>

      <div className="mt-4 flex gap-2 text-[12px]">
        <span className="rounded-full border border-amber-800 bg-amber-950/40 px-2.5 py-1 text-amber-200">
          <b className="tabular-nums">{data.dueCount}</b> need action today
        </span>
        <span className="rounded-full border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-neutral-300">
          <b className="tabular-nums">{data.total}</b> in flight
        </span>
      </div>

      {data.items.length === 0 ? (
        <p className="mt-6 text-neutral-400">
          Nothing in flight yet. Open a job → <b>Find a referral</b> → draft an intro, and it&apos;ll
          show up here so you never lose a thread.
        </p>
      ) : (
        <div className="mt-5 space-y-3">
          {data.items.map((it) => (
            <OutreachRow key={it.id} it={it} onChange={load} />
          ))}
        </div>
      )}
    </Shell>
  );
}

function OutreachRow({ it, onChange }: { it: Item; onChange: () => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const na = it.nextAction;
  const tone = na.action === 'REPLIED'
    ? 'border-emerald-800 bg-emerald-950/30'
    : na.due && na.urgency >= 3
      ? 'border-red-900/60 bg-red-950/20'
      : na.due
        ? 'border-amber-900/50 bg-amber-950/20'
        : 'border-neutral-800 bg-neutral-900';

  async function draftFollowUp() {
    setBusy(true);
    try {
      const r = await apiPost<{ draft: string }>(`/referrals/${it.id}/followup`, {});
      setDraft(r.draft);
    } finally {
      setBusy(false);
    }
  }
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      setDraft(null);
      onChange();
    } finally {
      setBusy(false);
    }
  }
  function copy() {
    if (!draft) return;
    navigator.clipboard.writeText(draft).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const isFollowUp = na.action === 'FOLLOW_UP' || na.action === 'FOLLOW_UP_2';

  return (
    <div className={`rounded-xl border p-4 ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-neutral-100">{it.name}</span>
        <span className="text-[11px] text-neutral-400">{ROLE_LABEL[it.role]}</span>
        <span className="text-[11px] text-neutral-500">·</span>
        {it.jobId ? (
          <Link href={`/jobs/${it.jobId}`} className="text-[12px] text-sky-300 hover:underline">
            {it.companyName}
          </Link>
        ) : (
          <span className="text-[12px] text-neutral-300">{it.companyName}</span>
        )}
        <span className="ml-auto text-[11px] text-neutral-500">
          {it.followUpCount > 0 && `${it.followUpCount} nudge${it.followUpCount === 1 ? '' : 's'} · `}
          {it.status.toLowerCase()}
        </span>
      </div>

      <div className="mt-1.5">
        <span className="text-[13px] font-medium text-neutral-100">{na.label}</span>
        <p className="text-[12px] text-neutral-400">{na.detail}</p>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {it.status === 'DRAFTED' && (
          <button onClick={() => act(() => apiPatch(`/referrals/${it.id}/status`, { status: 'CONTACTED' }))} disabled={busy}
            className="rounded-lg border border-neutral-700 px-3 py-1.5 text-[12px] text-neutral-200 hover:border-neutral-500 disabled:opacity-50">
            I sent my intro
          </button>
        )}
        {isFollowUp && (
          <>
            <button onClick={draftFollowUp} disabled={busy}
              className="rounded-lg border border-amber-800 bg-amber-950/40 px-3 py-1.5 text-[12px] font-medium text-amber-200 hover:bg-amber-900/40 disabled:opacity-50">
              {busy ? 'Writing…' : '✍️ Draft follow-up'}
            </button>
            <button onClick={() => act(() => apiPost(`/referrals/${it.id}/followup/logged`, {}))} disabled={busy}
              className="rounded-lg border border-neutral-700 px-3 py-1.5 text-[12px] text-neutral-200 hover:border-neutral-500 disabled:opacity-50">
              I sent a nudge
            </button>
          </>
        )}
        {it.status !== 'REPLIED' && (
          <button onClick={() => act(() => apiPatch(`/referrals/${it.id}/status`, { status: 'REPLIED' }))} disabled={busy}
            className="rounded-lg border border-emerald-800 bg-emerald-950/30 px-3 py-1.5 text-[12px] text-emerald-200 hover:bg-emerald-900/30 disabled:opacity-50">
            They replied
          </button>
        )}
        <button onClick={() => act(() => apiPatch(`/referrals/${it.id}/status`, { status: 'ARCHIVED' }))} disabled={busy}
          className="text-[12px] text-neutral-500 hover:text-neutral-300">
          Archive
        </button>
        {it.email && (
          <a href={`mailto:${it.email}`} className="text-[12px] text-sky-300 hover:underline">Email ↗</a>
        )}
        <a href={it.profileUrl} target="_blank" rel="noreferrer" className="text-[12px] text-sky-300 hover:underline">
          GitHub ↗
        </a>
      </div>

      {draft && (
        <div className="mt-3">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={6}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-[13px] leading-relaxed text-neutral-200 focus:border-neutral-500 focus:outline-none" />
          <div className="mt-2 flex gap-2">
            <button onClick={copy} className="rounded-lg bg-neutral-100 px-3 py-1.5 text-[12px] font-medium text-neutral-950 hover:bg-white">
              {copied ? '✓ Copied' : 'Copy'}
            </button>
            <button onClick={() => act(() => apiPost(`/referrals/${it.id}/followup/logged`, {}))} disabled={busy}
              className="rounded-lg border border-neutral-700 px-3 py-1.5 text-[12px] text-neutral-200 hover:border-neutral-500 disabled:opacity-50">
              Copied & sent — log it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-8 text-neutral-100">
      <div className="mx-auto w-full max-w-3xl">{children}</div>
    </main>
  );
}
