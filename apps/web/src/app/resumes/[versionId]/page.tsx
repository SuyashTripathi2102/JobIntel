'use client';

import { use, useEffect, useState } from 'react';
import { apiGet, apiPost, apiPut } from '../../../lib/api';

interface Experience {
  company: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  highlights: string[];
}
interface Project {
  name: string;
  description: string;
  technologies: string[];
}
interface Education {
  institution: string;
  degree: string | null;
  year: string | null;
}

interface ResumeProfile {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  headline: string | null;
  totalYearsExperience: number | null;
  targetRoles: string[];
  skills: string[];
  experience: Experience[];
  projects: Project[];
  education: Education[];
  summaryForMatching: string;
  /** Named in the resume, absent from the profile. Never merged without a click. */
  suggestedSkills: string[];
}

interface SaveResult {
  warnings: string[];
  unsupportedSkills: string[];
  /** The profile changed but no score has moved yet. Activation does that. */
  rescoreRequired: boolean;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-neutral-600"
      />
      {!value && (
        <span className="mt-1 block text-[11px] text-amber-500">
          Not found in your resume — recruiters search the document.
        </span>
      )}
    </label>
  );
}

/** Chips the user can remove; anything added is checked against the resume text. */
function ChipList({
  items,
  onRemove,
  onAdd,
  unsupported,
}: {
  items: string[];
  onRemove: (i: number) => void;
  onAdd: (v: string) => void;
  unsupported?: string[];
}) {
  const [draft, setDraft] = useState('');
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((s, i) => {
          const flagged = unsupported?.includes(s);
          return (
            <span
              key={`${s}-${i}`}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                flagged
                  ? 'border-amber-800 bg-amber-950/60 text-amber-300'
                  : 'border-neutral-700 bg-neutral-900 text-neutral-200'
              }`}
              title={flagged ? 'Not present in the resume text' : undefined}
            >
              {s}
              <button onClick={() => onRemove(i)} className="text-neutral-500 hover:text-neutral-200">
                ×
              </button>
            </span>
          );
        })}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const v = draft.trim();
          if (v) onAdd(v);
          setDraft('');
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add and press Enter"
          className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
        />
      </form>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-400">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function ReviewProfile({ params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = use(params);
  const [p, setP] = useState<ResumeProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SaveResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [activated, setActivated] = useState(false);
  const [rescored, setRescored] = useState<number | null>(null);

  useEffect(() => {
    apiGet<ResumeProfile>(`/resumes/versions/${versionId}/profile`)
      .then(setP)
      .catch((e) => setError(String(e)));
  }, [versionId]);

  if (error) return <Shell><p className="text-red-400">{error}</p></Shell>;
  if (!p) return <Shell><p className="text-neutral-400">Loading the parsed profile…</p></Shell>;

  const set = <K extends keyof ResumeProfile>(k: K, v: ResumeProfile[K]) => setP({ ...p, [k]: v });

  /**
   * Move suggestions into the profile. ONE state update — two sequential
   * `set()` calls both spread the same stale `p`, so the second silently
   * discarded the first and the skill was never added.
   */
  function acceptSuggestions(accepted: string[]) {
    setP((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            skills: [...prev.skills, ...accepted.filter((s) => !prev.skills.includes(s))],
            suggestedSkills: prev.suggestedSkills.filter((s) => !accepted.includes(s)),
          },
    );
    setSaved(null); // the profile changed; the last save no longer describes it
  }

  async function save() {
    if (!p) return;
    setBusy(true);
    try {
      setSaved(await apiPut<SaveResult>(`/resumes/versions/${versionId}/profile`, p));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function activate() {
    setBusy(true);
    try {
      await apiPost(`/resumes/versions/${versionId}/activate`, {});
      setActivated(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Re-score existing matches in place against the just-saved profile. No
   * re-activation, no LLM — the resume scores are already stored. This is the
   * light path for "I corrected a skill"; full activation is only for a new
   * resume version.
   */
  async function reevaluate() {
    setBusy(true);
    try {
      const r = await apiPost<{ rescored: number; notified: number }>(`/matches/rescore`, {});
      setRescored(r.rescored);
      setSaved((s) => (s ? { ...s, rescoreRequired: false } : s));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Read the PDF again with the current parser. Skills it finds that the
   * confirmed profile lacks arrive as suggestions, never as edits — the parse
   * that dropped HTML5 and CSS3 also had full confidence in its output.
   */
  async function reparse() {
    setBusy(true);
    setSaved(null);
    try {
      await apiPost(`/resumes/versions/${versionId}/parse`, {});
      // The parse is a queued job; poll until the suggestions change.
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const fresh = await apiGet<ResumeProfile>(`/resumes/versions/${versionId}/profile`);
        if (fresh.suggestedSkills.length > 0) {
          setP(fresh);
          return;
        }
      }
      setError('Re-parse finished but found nothing new in your resume.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (activated) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold tracking-tight">Resume activated</h1>
        <p className="mt-2 text-sm text-neutral-400">
          Every actionable job is being re-scored against this resume. It takes a few minutes —
          around 300 jobs at a paced rate. Jobs you were already told about will not be re-sent
          unless a job moved up to APPLY.
        </p>
        <a
          href={`/resumes/${versionId}/changes`}
          className="mt-6 inline-block rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-950"
        >
          See what changed
        </a>
      </Shell>
    );
  }

  return (
    <Shell>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Is this you?</h1>
        <p className="mt-1 text-sm text-neutral-400">
          CareerOS extracted this from your PDF. Nothing is matched against jobs until you confirm
          it — an AI parse of a broken PDF is exactly how a wrong profile goes unnoticed.
        </p>
      </header>

      <Section title="Contact">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name" value={p.fullName ?? ''} onChange={(v) => set('fullName', v)} />
          <Field label="Email" value={p.email ?? ''} onChange={(v) => set('email', v)} />
          <Field label="Phone" value={p.phone ?? ''} onChange={(v) => set('phone', v)} />
          <Field
            label="Total years of experience"
            value={p.totalYearsExperience?.toString() ?? ''}
            onChange={(v) => set('totalYearsExperience', v === '' ? null : Number(v))}
          />
        </div>
      </Section>

      <Section title="Target roles">
        <ChipList
          items={p.targetRoles}
          onRemove={(i) => set('targetRoles', p.targetRoles.filter((_, j) => j !== i))}
          onAdd={(v) => set('targetRoles', [...p.targetRoles, v])}
        />
      </Section>

      <Section title={`Skills (${p.skills.length})`}>
        <ChipList
          items={p.skills}
          unsupported={saved?.unsupportedSkills}
          onRemove={(i) => set('skills', p.skills.filter((_, j) => j !== i))}
          onAdd={(v) => set('skills', [...p.skills, v])}
        />
        {p.suggestedSkills.length > 0 && (
          <div className="mt-4 rounded-lg border border-sky-900 bg-sky-950/40 p-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-xs text-sky-300">
                <strong className="font-medium">
                  {p.suggestedSkills.length} skill
                  {p.suggestedSkills.length === 1 ? '' : 's'} named in your resume
                </strong>{' '}
                but missing from this profile. An earlier parse dropped them — nothing is added
                until you say so.
              </p>
              <button
                onClick={() => acceptSuggestions(p.suggestedSkills)}
                className="shrink-0 rounded-md border border-sky-700 bg-sky-900/60 px-2.5 py-1 text-xs text-sky-100 hover:bg-sky-900"
              >
                Add all
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {p.suggestedSkills.map((s) => (
                <button
                  key={s}
                  onClick={() => acceptSuggestions([s])}
                  title="Found in your resume text — click to add"
                  className="rounded-full border border-sky-800 bg-sky-950 px-2.5 py-1 text-xs text-sky-200 hover:border-sky-600"
                >
                  + {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section title={`Employment (${p.experience.length})`}>
        <ul className="space-y-3">
          {p.experience.map((e, i) => (
            <li key={i} className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-neutral-100">
                  {e.title} — {e.company}
                </div>
                <div className="text-xs text-neutral-500">
                  {e.startDate ?? '?'} → {e.endDate ?? 'present'} · {e.highlights.length} bullets
                </div>
              </div>
              <button
                onClick={() => set('experience', p.experience.filter((_, j) => j !== i))}
                className="shrink-0 text-xs text-neutral-500 hover:text-red-400"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`Projects (${p.projects.length})`}>
        <ul className="space-y-3">
          {p.projects.map((pr, i) => (
            <li key={i} className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-neutral-100">{pr.name}</div>
                <div className="text-xs text-neutral-500">{pr.technologies.join(' · ')}</div>
              </div>
              <button
                onClick={() => set('projects', p.projects.filter((_, j) => j !== i))}
                className="shrink-0 text-xs text-neutral-500 hover:text-red-400"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`Education (${p.education.length})`}>
        <ul className="space-y-2">
          {p.education.map((ed, i) => (
            <li key={i} className="text-sm text-neutral-200">
              {ed.degree ?? 'Degree'} — {ed.institution}{' '}
              <span className="text-neutral-500">{ed.year ?? ''}</span>
            </li>
          ))}
        </ul>
      </Section>

      {saved?.warnings.map((w) => (
        <p key={w} className="mt-4 rounded-lg border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300">
          {w}
        </p>
      ))}

      {saved?.rescoreRequired && (
        <div className="mt-4 rounded-lg border border-sky-900 bg-sky-950/40 p-3">
          <p className="text-sm text-sky-300">
            Profile saved — <strong className="font-medium">but no score has changed yet.</strong>{' '}
            Your jobs are still ranked against the previous profile.
          </p>
          <button
            onClick={reevaluate}
            disabled={busy}
            className="mt-2 rounded-md border border-sky-700 bg-sky-900/60 px-3 py-1.5 text-xs text-sky-100 hover:bg-sky-900 disabled:opacity-50"
          >
            {busy ? 'Re-evaluating…' : 'Re-evaluate my jobs now'}
          </button>
        </div>
      )}

      {rescored !== null && (
        <p className="mt-4 rounded-lg border border-emerald-900 bg-emerald-950/40 p-3 text-sm text-emerald-300">
          Re-evaluated <strong className="font-medium">{rescored}</strong> jobs against your updated
          profile.{' '}
          <a href="/" className="underline underline-offset-2 hover:text-emerald-200">
            See your matches →
          </a>
        </p>
      )}

      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy}
          className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-200 hover:border-neutral-500 disabled:opacity-50"
        >
          {busy ? '…' : saved ? 'Saved ✓' : 'Save corrections'}
        </button>
        <button
          onClick={activate}
          disabled={busy || !saved}
          title={saved ? undefined : 'Save your corrections first'}
          className="rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-white disabled:opacity-40"
        >
          Confirm & activate
        </button>
        <button
          onClick={reparse}
          disabled={busy}
          title="Read the PDF again with the current parser. Suggests, never overwrites."
          className="ml-auto rounded-lg border border-neutral-800 px-3 py-2 text-xs text-neutral-400 hover:border-neutral-600 hover:text-neutral-200 disabled:opacity-50"
        >
          {busy ? 'Re-reading…' : 'Re-parse resume'}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-neutral-600">
        Activating re-scores every actionable job against this resume and keeps the old scores for
        comparison.
      </p>
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
