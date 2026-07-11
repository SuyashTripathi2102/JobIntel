'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiGet, apiPost } from '../../../lib/api';

interface JobDetail {
  id: string;
  title: string;
  description: string;
  url: string;
  location: string | null;
  workMode: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string | null;
  postedAt: string | null;
  firstSeenAt: string;
  company: { name: string; website: string | null; careerPageUrl: string | null; atsProvider: string };
  skills: { skill: { name: string } }[];
}

interface Transferable {
  skill: string;
  via: string;
  note: string;
}

interface KeywordItem {
  keyword: string;
  status: 'PRESENT' | 'ACCEPTED_VARIANT' | 'ADD_EXACT' | 'MISSING';
  yourTerm?: string;
}

interface Detail {
  userYears: number | null;
  whatIf: { skill: string; newFit: number | null; delta: number }[];
  atsKeywords: {
    required: KeywordItem[];
    preferred: KeywordItem[];
    addExact: string[];
    requiredMatchPct: number | null;
  } | null;
  company: {
    name: string;
    confidence: number;
    atsProvider: string;
    activeJobs: number | null;
    hiringTrend: string | null;
    hiresJuniors: boolean | null;
  } | null;
  verdict: {
    verdict: string | null;
    code: string | null;
    reason: string | null;
    action: string | null;
    opportunityScore: number | null;
    developmentConfidence: number | null;
    targetRoleFit: number | null;
    specializationFit: number | null;
    resumeFit: number | null;
    missingSkills: string[];
  } | null;
  classification: {
    roleFamily: string;
    primaryFunction: string;
    codingIntensity: string;
    seniority: string;
    minimumYears: number | null;
    maximumYears: number | null;
    requiredSkills: string[];
    responsibilities: string[];
    developmentEvidence: string[];
  } | null;
  specialization: { fit: number | null; strong: string[]; transferable: Transferable[]; missing: string[] } | null;
}

/** One plain-language line per verdict — what the numbers mean, so nobody has to interpret them. */
const VERDICT_HEADLINE: Record<string, string> = {
  APPLY: 'Apply now — your role, your stack, and it clears the bar.',
  CONSIDER: 'Worth applying — genuinely yours, with one thing to weigh.',
  NEEDS_REVIEW: 'Needs a look — CareerOS could not call this one confidently.',
  SKIP: 'Not a match for your search.',
};

const stars = (pct: number | null) => {
  if (pct == null) return '☆☆☆☆☆';
  const n = Math.max(0, Math.min(5, Math.round(pct / 20)));
  return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
};

const humanize = (s: string | null) => (s ? s.replace(/_/g, ' ').toLowerCase() : '');

const VERDICT_STYLE: Record<string, { ring: string; text: string; dot: string; label: string }> = {
  APPLY: { ring: 'border-emerald-700', text: 'text-emerald-300', dot: 'bg-emerald-400', label: 'Apply now' },
  CONSIDER: { ring: 'border-amber-700', text: 'text-amber-300', dot: 'bg-amber-400', label: 'Worth applying' },
  NEEDS_REVIEW: { ring: 'border-sky-700', text: 'text-sky-300', dot: 'bg-sky-400', label: 'Needs review' },
  SKIP: { ring: 'border-neutral-700', text: 'text-neutral-400', dot: 'bg-neutral-500', label: 'Not a match' },
};

function Dim({ label, value, suffix = '%' }: { label: string; value: number | null; suffix?: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-neutral-100">
        {value == null ? '—' : `${value}${suffix}`}
      </div>
      <div className="text-[11px] leading-none text-amber-500/70">{stars(value)}</div>
    </div>
  );
}

/** One line of the resume-vs-job diff: the JD skill, and where you stand on it. */
function DiffRow({ skill, state, note }: { skill: string; state: 'have' | 'transfer' | 'missing'; note?: string }) {
  const mark = { have: '✓', transfer: '~', missing: '✕' }[state];
  const markColor = {
    have: 'text-emerald-400',
    transfer: 'text-amber-400',
    missing: 'text-neutral-600',
  }[state];
  const youLabel = { have: 'on your resume', transfer: note ?? 'transferable', missing: 'not on your resume' }[state];
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="font-medium text-neutral-200">{skill}</span>
      <span className={`flex items-center gap-2 text-xs ${markColor}`}>
        {youLabel}
        <span className="text-base leading-none">{mark}</span>
      </span>
    </div>
  );
}

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tracked, setTracked] = useState(false);

  useEffect(() => {
    if (!id) return;
    apiGet<JobDetail>(`/jobs/${id}`).then(setJob).catch((e) => setError(String(e)));
    apiGet<Detail>(`/matches/detail/${id}`).then(setDetail).catch(() => setDetail(null));
  }, [id]);

  async function markApplied() {
    if (!id || tracked) return;
    try {
      await apiPost('/applications', { jobId: id });
      setTracked(true);
    } catch {
      /* retryable */
    }
  }

  if (error)
    return (
      <Shell>
        <p className="text-red-400">{error}</p>
      </Shell>
    );
  if (!job)
    return (
      <Shell>
        <p className="text-neutral-400">Loading…</p>
      </Shell>
    );

  const posted = job.postedAt ?? job.firstSeenAt;
  const ageDays = Math.floor((Date.now() - new Date(posted).getTime()) / 86_400_000);
  const salary =
    job.salaryMin == null && job.salaryMax == null
      ? 'Not listed'
      : `${job.currency ?? ''} ${[job.salaryMin, job.salaryMax]
          .filter((n) => n != null)
          .map((n) => Number(n).toLocaleString('en-IN'))
          .join('–')}`;

  const v = detail?.verdict;
  const c = detail?.classification;
  const spec = detail?.specialization;
  const co = detail?.company;
  const ats = detail?.atsKeywords;
  const vstyle = (v?.verdict && VERDICT_STYLE[v.verdict]) || VERDICT_STYLE.SKIP;
  const experience = c
    ? c.minimumYears == null
      ? 'No stated minimum'
      : c.maximumYears
        ? `${c.minimumYears}–${c.maximumYears} yrs`
        : `${c.minimumYears}+ yrs`
    : null;

  // Experience math, spelled out rather than buried.
  const userYears = detail?.userYears ?? null;
  const gap =
    c?.minimumYears != null && userYears != null ? c.minimumYears - userYears : null;
  const gapVerdict =
    gap == null
      ? null
      : gap <= 0
        ? 'You meet it'
        : gap === 1
          ? 'One-year stretch — apply anyway'
          : `${gap}-year gap — likely a reach`;

  // Good news first: what makes this a fit, then what might hurt.
  const strengths: string[] = [];
  const concerns: string[] = [];
  if (v) {
    if (v.targetRoleFit != null && v.targetRoleFit >= 80) strengths.push('Exactly the kind of role you search for');
    if (v.developmentConfidence != null && v.developmentConfidence >= 80)
      strengths.push('Hands-on software development is the core of the job');
    (spec?.strong ?? []).forEach((s) => strengths.push(`${s} — on your resume`));
    if (co?.hiringTrend === 'GROWING') strengths.push('Company is actively hiring');
    if (ageDays <= 2) strengths.push('Fresh posting');
    if (gap != null && gap <= 0) strengths.push('You meet the experience requirement');
    if (gap === 1) concerns.push('One year short of the stated experience');
    else if (gap != null && gap > 1) concerns.push(`${gap} years short of the stated experience`);
    (spec?.missing ?? []).forEach((s) => concerns.push(`${s} — not on your resume`));
    (spec?.transferable ?? []).forEach((t) => concerns.push(`${t.skill} — ${t.note}`));
  }
  const confidence =
    v?.opportunityScore == null
      ? null
      : v.opportunityScore >= 80
        ? 'High'
        : v.opportunityScore >= 65
          ? 'Good'
          : 'Moderate';

  // Qualitative expectation — never an invented percentage.
  const expectedOutcome =
    v?.verdict === 'APPLY'
      ? '🟢 Good chance of a recruiter review — worth 30 minutes.'
      : v?.verdict === 'CONSIDER'
        ? '🟡 A real shot if the gap does not scare the screener — worth a considered application.'
        : v?.verdict === 'NEEDS_REVIEW'
          ? '🔵 Judgement call — read the JD before spending time on it.'
          : null;

  // Why it is not green — for CONSIDER/NEEDS_REVIEW, name the blocker.
  const whyNotApply: string[] = [];
  if (v && v.verdict !== 'APPLY' && v.verdict !== 'SKIP') {
    if (gap === 1) whyNotApply.push('JD requests more experience — you are a one-year stretch');
    else if (gap != null && gap > 1) whyNotApply.push(`JD requests ${experience} — you have ${userYears}`);
    if (v.specializationFit != null && v.specializationFit < 70)
      whyNotApply.push('Some of the required stack is missing from your resume');
    if (v.code === 'AMBIGUOUS_NEEDS_REVIEW')
      whyNotApply.push('CareerOS could not confidently tell what this role is');
  }

  return (
    <Shell>
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-300">
        ← Mission Control
      </Link>

      <header className="mt-4">
        <h1 className="text-2xl font-semibold tracking-tight">{job.title}</h1>
        <p className="mt-1 text-neutral-400">
          {job.company.name}
          {job.location ? ` · 📍 ${job.location}` : ''}
          {job.workMode ? ` · ${job.workMode.toLowerCase()}` : ''}
        </p>
        <p className="mt-1 text-sm text-neutral-500">
          {ageDays <= 0 ? '🔥 Posted today' : `Posted ${ageDays}d ago`} · 💰 {salary}
          {experience ? ` · 🧭 ${experience}` : ''}
        </p>
      </header>

      {/* VERDICT HERO — plain language first, numbers as backup. */}
      {v && v.verdict && (
        <section className={`mt-5 rounded-2xl border ${vstyle.ring} bg-neutral-900 p-5`}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className={`flex items-center gap-2 text-lg font-semibold ${vstyle.text}`}>
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${vstyle.dot}`} />
                {vstyle.label}
              </div>
              <p className="mt-1 text-sm text-neutral-300">
                {VERDICT_HEADLINE[v.verdict] ?? ''}
              </p>
              {confidence && (
                <p className="mt-1 text-xs text-neutral-500">Confidence: {confidence}</p>
              )}
              {expectedOutcome && (
                <p className="mt-2 text-sm text-neutral-300">{expectedOutcome}</p>
              )}
            </div>
            {v.opportunityScore != null && (
              <div className="shrink-0 text-right">
                <div className="text-3xl font-semibold tabular-nums text-neutral-100">
                  {v.opportunityScore}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-neutral-500">/ 100</div>
              </div>
            )}
          </div>

          {/* Good news first. */}
          {(strengths.length > 0 || concerns.length > 0) && (
            <div className="mt-4 grid gap-3 border-t border-neutral-800 pt-4 sm:grid-cols-2">
              {strengths.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-emerald-500">Why this fits</div>
                  <ul className="mt-1.5 space-y-1 text-sm text-neutral-200">
                    {strengths.slice(0, 6).map((s, i) => (
                      <li key={i}>✔ {s}</li>
                    ))}
                  </ul>
                </div>
              )}
              {concerns.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-amber-500">What may hurt</div>
                  <ul className="mt-1.5 space-y-1 text-sm text-neutral-400">
                    {concerns.slice(0, 6).map((s, i) => (
                      <li key={i}>⚠ {s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Dim label="Development" value={v.developmentConfidence} />
            <Dim label="Role fit" value={v.targetRoleFit} />
            <Dim label="Specialization" value={v.specializationFit} />
            <Dim label="Resume fit" value={v.resumeFit} />
          </div>

          {v.reason && (
            <p className="mt-4 whitespace-pre-line border-t border-neutral-800 pt-3 text-xs text-neutral-500">
              <span className="text-neutral-400">CareerOS reasoning: </span>
              {v.reason}
            </p>
          )}
        </section>
      )}

      {/* EXPERIENCE — its own block, spelled out. */}
      {c && (c.minimumYears != null || userYears != null) && (
        <section className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-400">Experience</h2>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="text-neutral-500">Required</span>{' '}
              <span className="font-medium text-neutral-200">{experience}</span>
            </div>
            {userYears != null && (
              <div>
                <span className="text-neutral-500">You</span>{' '}
                <span className="font-medium text-neutral-200">{userYears} yrs</span>
              </div>
            )}
            {gapVerdict && (
              <div
                className={`rounded-full px-2.5 py-0.5 text-xs ${
                  gap != null && gap <= 0
                    ? 'bg-emerald-950 text-emerald-300'
                    : gap === 1
                      ? 'bg-amber-950 text-amber-300'
                      : 'bg-red-950 text-red-300'
                }`}
              >
                {gapVerdict}
              </div>
            )}
          </div>
        </section>
      )}

      {/* WHY NOT APPLY — name the blocker for non-green verdicts. */}
      {whyNotApply.length > 0 && (
        <section className="mt-4 rounded-xl border border-amber-900/60 bg-amber-950/20 p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-amber-400">
            Why not “Apply now”?
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-neutral-300">
            {whyNotApply.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
        </section>
      )}

      {/* RESUME vs JOB — the diff. Left: what the JD asks. Right: you. */}
      {spec && (spec.strong.length > 0 || spec.transferable.length > 0 || spec.missing.length > 0) && (
        <section className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-400">
              Your resume vs this job
            </h2>
            {spec.fit != null && (
              <span className="text-sm font-semibold tabular-nums text-neutral-200">{spec.fit}% stack fit</span>
            )}
          </div>
          <div className="mt-3 divide-y divide-neutral-800/70">
            {spec.strong.map((s) => (
              <DiffRow key={s} skill={s} state="have" />
            ))}
            {spec.transferable.map((t) => (
              <DiffRow key={t.skill} skill={t.skill} state="transfer" note={`via ${t.via}`} />
            ))}
            {spec.missing.map((s) => (
              <DiffRow key={s} skill={s} state="missing" />
            ))}
          </div>
        </section>
      )}

      {/* WHAT-IF — deterministic: what closing each gap does to the score. */}
      {detail && detail.whatIf.length > 0 && (
        <section className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-400">
            Close the gap
          </h2>
          <p className="mt-1 text-[11px] text-neutral-500">
            What each missing skill would do to your stack fit — computed, not estimated.
          </p>
          <ul className="mt-3 space-y-2">
            {detail.whatIf.map((w) => (
              <li key={w.skill} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-neutral-200">Learn {w.skill}</span>
                <span className="flex items-center gap-2 tabular-nums text-neutral-400">
                  {spec?.fit}% <span className="text-neutral-600">→</span>{' '}
                  <span className="font-medium text-emerald-300">{w.newFit}%</span>
                  <span className="text-emerald-500/70">+{w.delta}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ATS KEYWORD OPTIMIZER — beat the literal keyword filter. */}
      {ats && (ats.required.length > 0 || ats.preferred.length > 0) && (
        <section className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-400">
              ATS keyword check
            </h2>
            {ats.requiredMatchPct != null && (
              <span className="text-sm font-semibold tabular-nums text-neutral-200">
                {ats.requiredMatchPct}% exact-match
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-neutral-500">
            ATS filters often match the JD&apos;s exact wording. This checks your resume text
            literally — not just whether you have the skill.
          </p>

          {ats.addExact.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-900/60 bg-amber-950/20 p-3">
              <p className="text-xs text-amber-300">
                <strong className="font-medium">Add these exact phrases to your resume</strong> before
                you apply:
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {ats.addExact.map((k) => (
                  <span
                    key={k}
                    className="rounded-md border border-amber-800 bg-amber-950/60 px-2 py-0.5 font-mono text-xs text-amber-200"
                  >
                    {k}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 space-y-1.5 text-sm">
            {ats.required.map((k) => (
              <KeywordRow key={`r-${k.keyword}`} item={k} required />
            ))}
            {ats.preferred.map((k) => (
              <KeywordRow key={`p-${k.keyword}`} item={k} required={false} />
            ))}
          </div>
        </section>
      )}

      {/* COMPANY HEALTH — data we already have, surfaced. */}
      {co && (
        <section className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-400">
            {co.name}
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-neutral-500">Confidence</div>
              <div className="font-medium text-neutral-200">{co.confidence}/100</div>
            </div>
            {co.hiringTrend && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-neutral-500">Hiring</div>
                <div className="font-medium text-neutral-200">{humanize(co.hiringTrend)}</div>
              </div>
            )}
            {co.activeJobs != null && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-neutral-500">Open roles</div>
                <div className="font-medium text-neutral-200">{co.activeJobs}</div>
              </div>
            )}
            <div>
              <div className="text-[11px] uppercase tracking-wide text-neutral-500">Source</div>
              <div className="font-medium capitalize text-neutral-200">
                {co.atsProvider ? co.atsProvider.toLowerCase() : 'career page'}
              </div>
            </div>
          </div>
          {co.hiresJuniors && (
            <p className="mt-2 text-[11px] text-emerald-500/80">✓ Has hired at ≤2 years before</p>
          )}
        </section>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        <a
          href={job.url}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg bg-neutral-100 px-4 py-2 font-medium text-neutral-950 hover:bg-white"
        >
          🚀 Apply on company site
        </a>
        <button
          onClick={markApplied}
          disabled={tracked}
          className={`rounded-lg border px-4 py-2 font-medium ${
            tracked
              ? 'border-emerald-800 bg-emerald-950 text-emerald-300'
              : 'border-neutral-700 text-neutral-300 hover:border-neutral-500'
          }`}
        >
          {tracked ? '✓ Tracked' : 'I applied'}
        </button>
      </div>

      {/* CLASSIFICATION FACTS */}
      {c && (
        <section className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-sm">
            <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-400">What this role is</h2>
            <dl className="mt-3 space-y-1.5 text-neutral-300">
              <Row k="Family" val={humanize(c.roleFamily)} />
              <Row k="Function" val={humanize(c.primaryFunction)} />
              <Row k="Coding" val={humanize(c.codingIntensity)} />
              <Row k="Seniority" val={humanize(c.seniority)} />
              {experience && <Row k="Experience" val={experience} />}
            </dl>
          </div>
          {c.developmentEvidence.length > 0 && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-400">Evidence it builds software</h2>
              <ul className="mt-3 space-y-1.5 text-sm text-neutral-300">
                {c.developmentEvidence.slice(0, 4).map((e, i) => (
                  <li key={i} className="text-emerald-400/80">“{e}”</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* RESPONSIBILITIES */}
      {c && c.responsibilities.length > 0 && (
        <section className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-400">Responsibilities</h2>
          <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-neutral-300">
            {c.responsibilities.slice(0, 6).map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>
      )}

      {job.skills.length > 0 && (
        <section className="mt-4 flex flex-wrap gap-2">
          {job.skills.map((s) => (
            <span key={s.skill.name} className="rounded-full border border-neutral-700 bg-neutral-950 px-3 py-1 text-sm text-neutral-300">
              {s.skill.name}
            </span>
          ))}
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-400">Full description</h2>
        <div className="mt-3 whitespace-pre-line rounded-xl border border-neutral-800 bg-neutral-900 p-5 text-[15px] leading-relaxed text-neutral-200">
          {job.description}
        </div>
      </section>

      <section className="mt-6 text-sm text-neutral-500">
        {job.company.careerPageUrl && (
          <a href={job.company.careerPageUrl} target="_blank" rel="noreferrer" className="hover:text-neutral-300">
            🏢 All openings at {job.company.name} →
          </a>
        )}
      </section>
    </Shell>
  );
}

function KeywordRow({ item, required }: { item: KeywordItem; required: boolean }) {
  const style =
    item.status === 'PRESENT'
      ? { mark: '✓', color: 'text-emerald-400', note: 'exact match' }
      : item.status === 'ACCEPTED_VARIANT'
        ? {
            mark: '✓',
            color: 'text-emerald-400/80',
            note: item.yourTerm ? `you wrote “${item.yourTerm}” — ATS accepts it` : 'accepted variant',
          }
        : item.status === 'ADD_EXACT'
          ? {
              mark: '~',
              color: 'text-amber-400',
              note: item.yourTerm ? `you wrote “${item.yourTerm}” — add this exact phrase` : 'add this exact phrase',
            }
          : { mark: '✕', color: 'text-neutral-500', note: 'missing' };
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2">
        <span className={`text-base leading-none ${style.color}`}>{style.mark}</span>
        <span className="font-mono text-xs text-neutral-200">{item.keyword}</span>
        {required && (
          <span className="rounded bg-neutral-800 px-1 text-[9px] uppercase tracking-wide text-neutral-500">
            required
          </span>
        )}
      </span>
      <span className={`text-[11px] ${style.color}`}>{style.note}</span>
    </div>
  );
}

function Row({ k, val }: { k: string; val: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-neutral-500">{k}</dt>
      <dd className="text-right capitalize text-neutral-200">{val}</dd>
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
