'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPost, logout } from '../lib/api';

interface BriefJob {
  jobId?: string;
  score: number;
  title: string;
  company: string;
  location: string | null;
  workMode: string | null;
  url?: string;
}

interface Dashboard {
  brief: {
    newJobs24h: number;
    indiaNew24h: number;
    recommended24h: number;
    mustApply: BriefJob[];
    worthALook: BriefJob[];
    trending: { company: string; newJobs7d: number }[];
    missingSkills: { skill: string; count: number }[];
  };
  funnel: {
    crawled: number;
    matched: number;
    recommended: number;
    notified: number;
    applied: number;
  };
  pipeline: {
    since: string;
    lastSuccessfulCrawl: string | null;
    crawls: { succeeded: number; failed: number; topFailures: { reason: string; count: number }[] };
    newJobs: number;
    indiaJobs: number;
    matched: number;
    apply: number;
    consider: number;
    skip: number;
    notificationsSent: number;
    explanation: string;
  };
  supply: {
    freshIndiaEngineering7d: number;
    actionable: number;
    actionableEvaluated: number;
    coveragePct: number;
    zombieHidden: number;
    totalIndiaEngineering: number;
    providers: { provider: string; freshIndia7d: number; zombiePct: number | null }[];
  };
}

/** Score badge: tier semantics (status colors), number always visible. */
function ScoreBadge({ score }: { score: number }) {
  const tier =
    score >= 75
      ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
      : score >= 60
        ? 'bg-amber-950 text-amber-300 border-amber-800'
        : 'bg-red-950 text-red-300 border-red-800';
  return (
    <span
      className={`inline-flex h-9 w-12 items-center justify-center rounded-lg border text-sm font-semibold ${tier}`}
    >
      {score}
    </span>
  );
}

function locationLine(j: BriefJob): string {
  const parts = [j.location, j.workMode?.toLowerCase()].filter(Boolean);
  return parts.join(' · ');
}

function Tile({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="text-3xl font-semibold tabular-nums tracking-tight">
        {value.toLocaleString()}
      </div>
      <div className="mt-1 text-xs uppercase tracking-wide text-neutral-400">{label}</div>
      {hint && <div className="text-[11px] text-neutral-500">{hint}</div>}
    </div>
  );
}

function JobCard({ job, highlight }: { job: BriefJob; highlight: boolean }) {
  const [tracked, setTracked] = useState(false);
  const [busy, setBusy] = useState(false);

  async function markApplied() {
    if (!job.jobId || tracked || busy) return;
    setBusy(true);
    try {
      await apiPost('/applications', { jobId: job.jobId });
      setTracked(true);
    } catch {
      // leave the button; user can retry
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`flex items-center gap-4 rounded-xl border p-4 ${
        highlight ? 'border-emerald-900 bg-neutral-900' : 'border-neutral-800 bg-neutral-900/60'
      }`}
    >
      <ScoreBadge score={job.score} />
      <div className="min-w-0 flex-1">
        {job.jobId ? (
          <a href={`/jobs/${job.jobId}`} className="block truncate font-medium text-neutral-100 hover:underline">
            {job.title}
          </a>
        ) : (
          <div className="truncate font-medium text-neutral-100">{job.title}</div>
        )}
        <div className="truncate text-sm text-neutral-400">
          {job.company}
          {locationLine(job) ? ` · ${locationLine(job)}` : ''}
        </div>
      </div>
      {job.jobId && (
        <button
          onClick={markApplied}
          disabled={tracked || busy}
          className={`shrink-0 rounded-lg border px-3 py-1.5 text-sm font-medium ${
            tracked
              ? 'border-emerald-800 bg-emerald-950 text-emerald-300'
              : 'border-neutral-700 text-neutral-300 hover:border-neutral-500'
          }`}
          title="Track that you applied — feeds the Applied funnel + follow-up nudges"
        >
          {tracked ? '✓ Tracked' : busy ? '…' : 'I applied'}
        </button>
      )}
      {job.url && (
        <a
          href={job.url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-950 hover:bg-white"
        >
          Apply
        </a>
      )}
    </div>
  );
}

export default function MissionControl() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Dashboard>('/dashboard')
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  if (error)
    return (
      <Shell>
        <p className="text-red-400">{error}</p>
      </Shell>
    );
  if (!data)
    return (
      <Shell>
        <p className="text-neutral-400">Loading your day…</p>
      </Shell>
    );

  const { brief, funnel } = data;
  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <Shell>
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Mission Control</h1>
          <p className="text-sm text-neutral-400">{today}</p>
        </div>
        <nav className="flex items-center gap-4">
          <a href="/resumes" className="text-sm text-neutral-400 hover:text-neutral-200">
            Resume
          </a>
          <a href="/applications" className="text-sm text-neutral-400 hover:text-neutral-200">
            Applications
          </a>
          <button onClick={logout} className="text-sm text-neutral-500 hover:text-neutral-300">
            Sign out
          </button>
        </nav>
      </header>

      {/* FRESH SUPPLY — the real constraint. Zombie counts are hidden here on
          purpose: 6,000 "jobs watched" is a vanity number when only ~50 India
          engineering roles are actually actionable. */}
      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile
          label="Fresh this week"
          value={data.supply.freshIndiaEngineering7d}
          hint="India engineering, ≤7 days"
        />
        <Tile
          label="Actionable now"
          value={data.supply.actionable}
          hint="≤30 days old"
        />
        <Tile
          label="Evaluated"
          value={data.supply.coveragePct}
          hint={`% of actionable (${data.supply.actionableEvaluated}/${data.supply.actionable})`}
        />
        <Tile label="Applied" value={funnel.applied} hint="the number that matters" />
      </section>
      <p className="mt-2 text-[11px] text-neutral-600">
        {data.supply.zombieHidden} listings older than 90 days are hidden from these numbers —
        they&apos;re on boards but almost certainly not hiring. Total watched: {funnel.crawled.toLocaleString()}.
      </p>

      {/* Today Pipeline — "why am I / am I not getting jobs?" */}
      <section className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-400">
            Since 8 AM
          </h2>
          <span className="text-[11px] text-neutral-500">
            {data.pipeline.lastSuccessfulCrawl
              ? `last crawl ${new Date(data.pipeline.lastSuccessfulCrawl).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
              : 'no crawl yet'}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-sm sm:grid-cols-6">
          <PipeStat label="Crawls" value={data.pipeline.crawls.succeeded} />
          <PipeStat label="New jobs" value={data.pipeline.newJobs} />
          <PipeStat label="India" value={data.pipeline.indiaJobs} />
          <PipeStat label="Apply" value={data.pipeline.apply} tone="good" />
          <PipeStat label="Consider" value={data.pipeline.consider} tone="mid" />
          <PipeStat label="Sent" value={data.pipeline.notificationsSent} />
        </div>
        <p className="mt-3 text-sm text-neutral-300">{data.pipeline.explanation}</p>
        {data.pipeline.crawls.failed > 0 && (
          <p className="mt-1 text-[11px] text-amber-500/80">
            {data.pipeline.crawls.failed} crawls failed
            {data.pipeline.crawls.topFailures[0]
              ? ` · ${data.pipeline.crawls.topFailures[0].reason}`
              : ''}
          </p>
        )}
      </section>

      {/* Today */}
      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-400">
          Today — {brief.newJobs24h} new jobs · {brief.indiaNew24h} in India ·{' '}
          {brief.recommended24h} recommended
        </h2>

        <h3 className="mt-5 flex items-center gap-2 text-lg font-semibold">
          🔥 Apply today
          <span className="text-sm font-normal text-neutral-500">fresh, high-scoring</span>
        </h3>
        <div className="mt-3 space-y-2">
          {brief.mustApply.length === 0 && (
            <p className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 text-sm text-neutral-400">
              Nothing clears the bar today — it stays high on purpose.
            </p>
          )}
          {brief.mustApply.map((j, i) => (
            <JobCard key={i} job={j} highlight />
          ))}
        </div>

        {brief.worthALook.length > 0 && (
          <>
            <h3 className="mt-6 text-lg font-semibold">🟡 Consider</h3>
            <div className="mt-3 space-y-2">
              {brief.worthALook.map((j, i) => (
                <JobCard key={i} job={j} highlight={false} />
              ))}
            </div>
          </>
        )}
      </section>

      {/* Market signals */}
      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="text-sm font-medium uppercase tracking-wide text-neutral-400">
            Hiring this week
          </h3>
          <ul className="mt-3 space-y-2">
            {brief.trending.map((t) => (
              <li key={t.company} className="flex items-baseline justify-between text-sm">
                <span className="text-neutral-200">{t.company}</span>
                <span className="tabular-nums text-neutral-400">+{t.newJobs7d} roles</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="text-sm font-medium uppercase tracking-wide text-neutral-400">
            Learn next
          </h3>
          <ul className="mt-3 space-y-2">
            {brief.missingSkills.map((s) => (
              <li key={s.skill} className="flex items-baseline justify-between text-sm">
                <span className="text-neutral-200">Learn {s.skill}</span>
                <span className="tabular-nums text-neutral-400">unlocks {s.count} matches</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-neutral-500">
            The skills blocking the most of your current matches.
          </p>
        </div>
      </section>
    </Shell>
  );
}

function PipeStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'good' | 'mid';
}) {
  const color =
    tone === 'good' ? 'text-emerald-400' : tone === 'mid' ? 'text-amber-400' : 'text-neutral-100';
  return (
    <div className="rounded-lg bg-neutral-950/60 px-2 py-2 text-center">
      <div className={`text-xl font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
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
