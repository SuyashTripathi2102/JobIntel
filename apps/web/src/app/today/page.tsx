'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet } from '@/lib/api';

type Impact = 'DO_FIRST' | 'HIGH' | 'MEDIUM' | 'LOW';
interface Action {
  kind: string;
  title: string;
  detail: string;
  chips: string[];
  impact: Impact;
  minutes: number;
  href: string;
  value?: string;
  why?: string[];
}
interface Today {
  greeting: string;
  name: string | null;
  goal: { label: string; done: number; target: number };
  weekProbability: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  probabilityReason: string;
  totalMinutes: number;
  actions: Action[];
}

const KIND_ICON: Record<string, string> = {
  REPLY: '💬',
  FOLLOW_UP: '✉️',
  APPLY: '🚀',
  TAILOR: '📄',
  REFERRAL: '🤝',
  MASTER_RESUME: '🗂️',
  LEARN: '📚',
};
const IMPACT: Record<Impact, { label: string; cls: string }> = {
  DO_FIRST: { label: 'DO THIS FIRST', cls: 'border-emerald-700 bg-emerald-950/50 text-emerald-300' },
  HIGH: { label: 'HIGH IMPACT', cls: 'border-sky-800 bg-sky-950/40 text-sky-300' },
  MEDIUM: { label: 'WORTH DOING', cls: 'border-neutral-700 bg-neutral-900 text-neutral-300' },
  LOW: { label: 'IF YOU HAVE TIME', cls: 'border-neutral-800 bg-neutral-950 text-neutral-500' },
};

export default function TodayPage() {
  const [data, setData] = useState<Today | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Today>('/today').then(setData).catch((e) => setError(String(e)));
  }, []);

  if (error) return <Shell><p className="text-red-400">{error}</p></Shell>;
  if (!data) return <Shell><p className="text-neutral-400">Planning your day…</p></Shell>;

  const goalDone = data.goal.done >= data.goal.target;
  const pct = Math.min(100, Math.round((data.goal.done / data.goal.target) * 100));

  return (
    <Shell>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight text-neutral-300">
          {data.greeting}
          {data.name ? `, ${data.name.split(' ')[0]}` : ''}
        </h1>
        <nav className="flex items-center gap-3 text-sm text-neutral-500">
          <Link href="/" className="hover:text-neutral-300">Board</Link>
          <Link href="/applications" className="hover:text-neutral-300">Applications</Link>
          <Link href="/outreach" className="hover:text-neutral-300">Outreach</Link>
        </nav>
      </div>

      {/* The mission, not a metric. */}
      <section className="mt-3">
        <div className="text-[11px] font-medium uppercase tracking-[0.15em] text-neutral-500">
          Today&apos;s mission
        </div>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight">
          {data.actions.length === 0
            ? 'Line up your next opportunity'
            : 'Your fastest path to an interview today'}
        </h2>
        <p className="mt-1 text-sm text-neutral-400">
          {data.actions.length} action{data.actions.length === 1 ? '' : 's'} · ~{data.totalMinutes} min ·{' '}
          <span className="text-neutral-500">{data.probabilityReason}</span>
        </p>
      </section>

      {/* Goal progress — something to complete. */}
      <section className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className={goalDone ? 'text-emerald-300' : 'text-neutral-200'}>
            {goalDone ? '✓ ' : ''}{data.goal.label}
          </span>
          <span className="tabular-nums text-neutral-400">
            {data.goal.done} / {data.goal.target}
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-800">
          <div
            className={`h-full rounded-full ${goalDone ? 'bg-emerald-500' : 'bg-sky-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {goalDone && (
          <p className="mt-2 text-[12px] text-emerald-400/90">
            Done for today. Anything below is a bonus — come back tomorrow.
          </p>
        )}
      </section>

      {data.actions.length === 0 ? (
        <p className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-6 text-sm text-neutral-400">
          Nothing queued right now. Head to the{' '}
          <Link href="/" className="text-sky-300 hover:underline">board</Link> — as soon as there&apos;s a
          strong fresh match, your apply / referral / tailor plan appears here.
        </p>
      ) : (
        <ol className="mt-5 space-y-3">
          {data.actions.map((a, i) => (
            <ActionCard key={i} a={a} step={i + 1} total={data.actions.length} />
          ))}
        </ol>
      )}
    </Shell>
  );
}

function ActionCard({ a, step, total }: { a: Action; step: number; total: number }) {
  const imp = IMPACT[a.impact];
  return (
    <li>
      <Link
        href={a.href}
        className={`block rounded-xl border bg-neutral-900 p-4 transition hover:border-neutral-600 ${
          a.impact === 'DO_FIRST' ? 'border-emerald-900/60' : 'border-neutral-800'
        }`}
      >
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-neutral-500">STEP {step} OF {total}</span>
          <span className={`rounded-full border px-2 py-0.5 font-medium tracking-wide ${imp.cls}`}>
            {imp.label}
          </span>
          <span className="ml-auto text-neutral-500">~{a.minutes} min</span>
        </div>

        <div className="mt-1.5 flex items-start gap-2.5">
          <span className="text-lg">{KIND_ICON[a.kind] ?? '•'}</span>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-neutral-100">{a.title}</div>
            <p className="mt-0.5 text-[12.5px] text-neutral-400">{a.detail}</p>

            {/* Why this first — remove the doubt. */}
            {a.why && a.why.length > 0 && (
              <div className="mt-2 rounded-lg border border-neutral-800 bg-neutral-950/60 p-2.5">
                <div className="text-[10px] uppercase tracking-wide text-neutral-500">Why first</div>
                <ul className="mt-1 space-y-0.5">
                  {a.why.map((w, j) => (
                    <li key={j} className="text-[12px] text-neutral-300">
                      <span className="text-emerald-400">•</span> {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(a.chips.length > 0 || a.value) && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {a.chips.map((c) => (
                  <span
                    key={c}
                    className="rounded border border-neutral-700 bg-neutral-950/60 px-1.5 py-0.5 text-[10px] text-neutral-300"
                  >
                    {c}
                  </span>
                ))}
                {a.value && <span className="text-[11px] text-emerald-400/90">{a.value}</span>}
              </div>
            )}
          </div>
          <span className="self-center text-neutral-500">→</span>
        </div>
      </Link>
    </li>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-8 text-neutral-100">
      <div className="mx-auto w-full max-w-2xl">{children}</div>
    </main>
  );
}
