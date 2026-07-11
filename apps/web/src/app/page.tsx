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
  decisions: { applyNow: number; worthApplying: number; needsReview: number };
  funnel: {
    crawled: number;
    matched: number;
    recommended: number;
    notified: number;
    applied: number;
  };
  supply: {
    freshIndiaEngineering7d: number;
    actionable: number;
    actionableEvaluated: number;
    coveragePct: number;
    zombieHidden: number;
    totalIndiaEngineering: number;
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

/** A decision bucket in the hero: count + label, links to its list. */
function DecisionCard({
  count,
  label,
  href,
  tone,
}: {
  count: number;
  label: string;
  href: string;
  tone: 'apply' | 'consider' | 'review';
}) {
  const styles = {
    apply: 'border-emerald-800 bg-emerald-950/40 text-emerald-300',
    consider: 'border-amber-800 bg-amber-950/40 text-amber-300',
    review: 'border-sky-800 bg-sky-950/40 text-sky-300',
  }[tone];
  return (
    <a
      href={href}
      className={`rounded-xl border p-4 transition hover:brightness-125 ${styles} ${count === 0 ? 'opacity-50' : ''}`}
    >
      <div className="text-3xl font-semibold tabular-nums tracking-tight">{count}</div>
      <div className="mt-1 text-xs uppercase tracking-wide">{label}</div>
    </a>
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

  const { brief, decisions, supply, funnel } = data;
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
          <a href="/today" className="text-sm font-medium text-sky-300 hover:text-sky-200">
            Today
          </a>
          <a href="/resumes" className="text-sm text-neutral-400 hover:text-neutral-200">
            Resume
          </a>
          <a href="/applications" className="text-sm text-neutral-400 hover:text-neutral-200">
            Applications
          </a>
          <a href="/outreach" className="text-sm text-neutral-400 hover:text-neutral-200">
            Outreach
          </a>
          <a href="/insights" className="text-sm text-neutral-400 hover:text-neutral-200">
            Insights
          </a>
          <button onClick={logout} className="text-sm text-neutral-500 hover:text-neutral-300">
            Sign out
          </button>
        </nav>
      </header>

      {/* Slim market strip — context, one line. The tiles, pipeline and source
          yield live on /insights now: this page is about decisions, not the
          crawler. */}
      <p className="mt-4 text-xs text-neutral-500">
        <span className="text-neutral-300">{supply.freshIndiaEngineering7d}</span> fresh this week ·{' '}
        <span className="text-neutral-300">{supply.actionable}</span> actionable ·{' '}
        <span className="text-neutral-300">{supply.coveragePct}%</span> evaluated ·{' '}
        <span className="text-neutral-300">{funnel.applied}</span> applied ·{' '}
        <a href="/insights" className="underline underline-offset-2 hover:text-neutral-300">
          discovery health →
        </a>
      </p>

      {/* The decisions. Everything the system concluded, as three buckets. */}
      <section className="mt-4 grid grid-cols-3 gap-3">
        <DecisionCard count={decisions.applyNow} label="Apply now" href="#apply-now" tone="apply" />
        <DecisionCard
          count={decisions.worthApplying}
          label="Worth applying"
          href="#worth-applying"
          tone="consider"
        />
        <DecisionCard
          count={decisions.needsReview}
          label="Needs review"
          href="/needs-review"
          tone="review"
        />
      </section>
      <p className="mt-2 text-[11px] text-neutral-600">
        <a href="/excluded" className="underline underline-offset-2 hover:text-neutral-400">
          See everything CareerOS excluded, and why →
        </a>
      </p>

      <section id="apply-now" className="mt-8 scroll-mt-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          🟢 Apply now
          <span className="text-sm font-normal text-neutral-500">
            your role, your stack, fresh
          </span>
        </h2>
        <div className="mt-3 space-y-2">
          {brief.mustApply.length === 0 && (
            <p className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 text-sm text-neutral-400">
              Nothing clears the apply-now bar right now — it stays high on purpose. Check{' '}
              <a href="#worth-applying" className="underline underline-offset-2">
                Worth applying
              </a>
              .
            </p>
          )}
          {brief.mustApply.map((j, i) => (
            <JobCard key={i} job={j} highlight />
          ))}
        </div>
      </section>

      {brief.worthALook.length > 0 && (
        <section id="worth-applying" className="mt-8 scroll-mt-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            🟡 Worth applying
            <span className="text-sm font-normal text-neutral-500">
              a stretch, but genuinely yours
            </span>
          </h2>
          <div className="mt-3 space-y-2">
            {brief.worthALook.map((j, i) => (
              <JobCard key={i} job={j} highlight={false} />
            ))}
          </div>
        </section>
      )}

      {/* Market signals — the only telemetry that changes what you learn/target. */}
      <section className="mt-10 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="text-sm font-medium uppercase tracking-wide text-neutral-400">
            Fresh roles this week
          </h3>
          <ul className="mt-3 space-y-2">
            {brief.trending.map((t) => (
              <li key={t.company} className="flex items-baseline justify-between text-sm">
                <span className="text-neutral-200">{t.company}</span>
                <span className="tabular-nums text-neutral-400">+{t.newJobs7d} roles</span>
              </li>
            ))}
            {brief.trending.length === 0 && (
              <li className="text-sm text-neutral-600">No fresh India engineering roles this week.</li>
            )}
          </ul>
          <p className="mt-3 text-[11px] text-neutral-500">
            Companies with the most India engineering roles posted in the last 7 days.
          </p>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="text-sm font-medium uppercase tracking-wide text-neutral-400">
            Learn next
          </h3>
          <ul className="mt-3 space-y-2">
            {brief.missingSkills.map((s) => (
              <li key={s.skill} className="flex items-baseline justify-between text-sm">
                <span className="text-neutral-200">Learn {s.skill}</span>
                <span className="tabular-nums text-neutral-400">unlocks {s.count} roles</span>
              </li>
            ))}
            {brief.missingSkills.length === 0 && (
              <li className="text-sm text-neutral-600">
                Nothing blocking your reachable roles right now.
              </li>
            )}
          </ul>
          <p className="mt-3 text-[11px] text-neutral-500">
            Skills missing from your resume that block the India roles you could actually get
            (apply / consider only).
          </p>
        </div>
      </section>
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
