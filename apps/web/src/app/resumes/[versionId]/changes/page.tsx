'use client';

import { use, useEffect, useState } from 'react';
import { apiGet } from '../../../../lib/api';

type Verdict = 'APPLY' | 'CONSIDER' | 'SKIP';

interface ScoreChange {
  jobId: string;
  title: string;
  company: string;
  oldScore: number;
  newScore: number;
  oldVerdict: Verdict | null;
  newVerdict: Verdict;
}

interface ReconcileReport {
  inspected: number;
  created: number;
  newlyEvaluated: number;
  unchanged: number;
  increased: number;
  decreased: number;
  averageScoreChange: number;
  apply: number;
  consider: number;
  skip: number;
  upgradedToApply: number;
  downgraded: number;
  notified: number;
  duplicateNotificationsPrevented: number;
  failures: number;
  topChanges: ScoreChange[];
}

interface Response {
  status: 'complete' | 'running' | 'not-activated';
  reconciledAt: string | null;
  report: ReconcileReport | null;
}

const VERDICT_TONE: Record<Verdict, string> = {
  APPLY: 'text-emerald-400',
  CONSIDER: 'text-amber-400',
  SKIP: 'text-neutral-500',
};

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
      <div className={`text-xl font-semibold tabular-nums ${tone ?? 'text-neutral-100'}`}>{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
    </div>
  );
}

export default function Changes({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = use(params);
  const [data, setData] = useState<Response | null>(null);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const r = await apiGet<Response>(`/resumes/versions/${versionId}/reconcile`);
        if (stop) return;
        setData(r);
        if (r.status === 'running') setTimeout(poll, 5000);
      } catch {
        if (!stop) setTimeout(poll, 8000);
      }
    };
    void poll();
    return () => {
      stop = true;
    };
  }, [versionId]);

  if (!data) return <Shell><p className="text-neutral-400">Loading…</p></Shell>;

  if (data.status !== 'complete' || !data.report) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold tracking-tight">Re-scoring your jobs</h1>
        <p className="mt-2 text-sm text-neutral-400">
          {data.status === 'not-activated'
            ? 'This resume version has not been activated yet.'
            : 'Around 300 jobs, paced to stay inside the model rate limit. This page updates itself.'}
        </p>
      </Shell>
    );
  }

  const r = data.report;
  const avg = r.averageScoreChange;

  return (
    <Shell>
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">What changed</h1>
        <a href="/" className="text-sm text-neutral-400 hover:text-neutral-200">Mission Control</a>
      </header>
      <p className="mt-1 text-sm text-neutral-400">
        Every actionable job re-scored against your new resume. Old scores are kept, so this is a
        real before/after — not a fresh start.
      </p>

      <section className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Jobs inspected" value={r.inspected} />
        <Stat
          label="Average change"
          value={`${avg > 0 ? '+' : ''}${avg}`}
          tone={avg > 0 ? 'text-emerald-400' : avg < 0 ? 'text-red-400' : undefined}
        />
        <Stat label="Score increased" value={r.increased} tone="text-emerald-400" />
        <Stat label="Score decreased" value={r.decreased} tone="text-red-400" />
        <Stat label="New APPLY" value={r.upgradedToApply} tone="text-emerald-400" />
        <Stat label="Downgraded" value={r.downgraded} tone="text-amber-400" />
        <Stat label="Unchanged" value={r.unchanged} />
        <Stat label="First time scored" value={r.newlyEvaluated} />
      </section>

      <p className="mt-3 text-[11px] text-neutral-500">
        {r.notified} notification{r.notified === 1 ? '' : 's'} sent ·{' '}
        {r.duplicateNotificationsPrevented} suppressed as already-seen · {r.failures} failed ·{' '}
        now {r.apply} APPLY, {r.consider} CONSIDER, {r.skip} SKIP
      </p>

      {r.topChanges.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-400">
            Biggest verdict changes
          </h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-neutral-500">
                  <th className="pb-2 font-medium">Job</th>
                  <th className="pb-2 text-right font-medium">Was</th>
                  <th className="pb-2 text-right font-medium">Now</th>
                  <th className="pb-2 text-right font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {r.topChanges.map((c) => (
                  <tr key={c.jobId} className="border-t border-neutral-800">
                    <td className="py-2">
                      <a href={`/jobs/${c.jobId}`} className="text-neutral-100 hover:underline">
                        {c.title}
                      </a>
                      <div className="text-xs text-neutral-500">{c.company}</div>
                    </td>
                    <td className="py-2 text-right tabular-nums text-neutral-500">{c.oldScore}</td>
                    <td className="py-2 text-right tabular-nums text-neutral-100">{c.newScore}</td>
                    <td className="py-2 text-right text-xs">
                      <span className="text-neutral-600">{c.oldVerdict ?? '—'}</span>
                      <span className="text-neutral-700"> → </span>
                      <span className={VERDICT_TONE[c.newVerdict]}>{c.newVerdict}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-8 text-neutral-100">
      <div className="mx-auto w-full max-w-3xl">{children}</div>
    </main>
  );
}
