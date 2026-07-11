'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet } from '@/lib/api';

type Momentum = 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
interface Action {
  kind: string;
  title: string;
  detail: string;
  chips: string[];
  stars: number;
  minutes: number;
  href: string;
  value?: string;
}
interface Today {
  greeting: string;
  name: string | null;
  weekProbability: Momentum;
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

const PROB_LABEL: Record<Momentum, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High ↑',
  VERY_HIGH: 'Very high ↑',
};
const PROB_STYLE: Record<Momentum, string> = {
  LOW: 'text-neutral-300',
  MEDIUM: 'text-amber-300',
  HIGH: 'text-emerald-300',
  VERY_HIGH: 'text-emerald-300',
};

const Stars = ({ n }: { n: number }) => (
  <span className="text-amber-300">
    {'★'.repeat(n)}
    <span className="text-neutral-700">{'★'.repeat(5 - n)}</span>
  </span>
);

export default function TodayPage() {
  const [data, setData] = useState<Today | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Today>('/today').then(setData).catch((e) => setError(String(e)));
  }, []);

  if (error) return <Shell><p className="text-red-400">{error}</p></Shell>;
  if (!data) return <Shell><p className="text-neutral-400">Planning your day…</p></Shell>;

  return (
    <Shell>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          {data.greeting}
          {data.name ? `, ${data.name.split(' ')[0]}` : ''}
        </h1>
        <nav className="flex items-center gap-3 text-sm text-neutral-500">
          <Link href="/" className="hover:text-neutral-300">Board</Link>
          <Link href="/applications" className="hover:text-neutral-300">Applications</Link>
          <Link href="/outreach" className="hover:text-neutral-300">Outreach</Link>
        </nav>
      </div>

      {/* Momentum — a qualitative read, not a fake %. */}
      <section className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">
              Interview momentum this week
            </div>
            <div className={`text-2xl font-semibold ${PROB_STYLE[data.weekProbability]}`}>
              {PROB_LABEL[data.weekProbability]}
            </div>
          </div>
          <div className="text-right text-[12px] text-neutral-400">
            {data.actions.length} action{data.actions.length === 1 ? '' : 's'} worth doing
            <br />~{data.totalMinutes} min
          </div>
        </div>
        <p className="mt-1 text-[13px] text-neutral-400">{data.probabilityReason}.</p>
      </section>

      {data.actions.length === 0 ? (
        <p className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/60 p-6 text-sm text-neutral-400">
          Nothing queued right now. Head to the <Link href="/" className="text-sky-300 hover:underline">board</Link> to
          find fresh matches — as soon as there&apos;s a strong one, an apply/referral/tailor plan shows up here.
        </p>
      ) : (
        <div className="mt-5 space-y-3">
          {data.actions.map((a, i) => (
            <Link
              key={i}
              href={a.href}
              className="block rounded-xl border border-neutral-800 bg-neutral-900 p-4 transition hover:border-neutral-600"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 text-lg">{KIND_ICON[a.kind] ?? '•'}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Stars n={a.stars} />
                    <span className="font-medium text-neutral-100">{a.title}</span>
                    {i === 0 && (
                      <span className="rounded-full border border-emerald-800 bg-emerald-950/40 px-2 py-0.5 text-[10px] text-emerald-300">
                        start here
                      </span>
                    )}
                    <span className="ml-auto text-[11px] text-neutral-500">~{a.minutes} min</span>
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-neutral-400">{a.detail}</p>
                  {(a.chips.length > 0 || a.value) && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
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
          ))}
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-8 text-neutral-100">
      <div className="mx-auto w-full max-w-2xl">{children}</div>
    </main>
  );
}
