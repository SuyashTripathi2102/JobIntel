'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiGet } from '@/lib/api';

interface Change {
  type: string;
  detail: string;
}
interface Scores {
  ats: number | null;
  recruiter: number;
  hiringManager: number;
}
interface Tailored {
  jobTitle: string;
  company: string;
  masterHtml: string;
  masterSource: 'custom' | 'generated';
  companyHtml: string;
  changes: Change[];
  missingRequired: string[];
  scores: { before: Scores; after: Scores };
}

// Print-optimised, ATS-safe styling for the rendered resume. Single column,
// standard headings, real text — a browser "Save as PDF" embeds a text layer.
const RESUME_CSS = `
.resume { background:#fff; color:#111; font-family: Georgia, 'Times New Roman', serif; padding:32px 36px; line-height:1.4; }
.resume h1 { font-size:22px; margin:0; letter-spacing:.2px; }
.resume .headline { font-size:13px; color:#333; margin-top:2px; }
.resume .contact { font-size:12px; color:#444; margin-top:4px; }
.resume h2 { font-size:12px; letter-spacing:1px; border-bottom:1px solid #999; padding-bottom:2px; margin:16px 0 8px; }
.resume .entry { margin-bottom:10px; }
.resume .entry-head { display:flex; justify-content:space-between; gap:12px; }
.resume .role { font-weight:700; font-size:13px; }
.resume .dates { color:#555; font-size:12px; white-space:nowrap; }
.resume ul { margin:4px 0 0; padding-left:18px; }
.resume li, .resume p { font-size:12.5px; margin:2px 0; }
`;

function ScoreTile({ label, before, after }: { label: string; before: number | null; after: number | null }) {
  const up = before != null && after != null && after > before;
  const color = (v: number | null) =>
    v == null ? 'text-neutral-500' : v >= 80 ? 'text-emerald-300' : v >= 60 ? 'text-amber-300' : 'text-red-300';
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3 text-center">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${color(after)}`}>
        {after == null ? '—' : `${after}%`}
      </div>
      {up && <div className="text-[10px] text-emerald-500/80">↑ from {before}%</div>}
    </div>
  );
}

export default function TailorPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [data, setData] = useState<Tailored | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    apiGet<Tailored>(`/resumes/tailor/${jobId}`)
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [jobId]);

  // Custom master is a full HTML document (its own styling) — print it verbatim.
  // Generated master is a fragment that needs our ATS-safe stylesheet wrapped in.
  function previewDoc(d: Tailored): string {
    return d.masterSource === 'custom'
      ? d.companyHtml
      : `<!doctype html><html><head><meta charset="utf-8"><title>${d.company} — Resume</title><style>body{margin:0}${RESUME_CSS}</style></head><body>${d.companyHtml}</body></html>`;
  }

  function downloadPrint() {
    if (!data) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(previewDoc(data));
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
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
        <p className="text-neutral-400">Tailoring your resume…</p>
      </Shell>
    );

  const s = data.scores;

  return (
    <Shell>
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Resume for {data.company}</h1>
          <p className="text-sm text-neutral-400">{data.jobTitle}</p>
        </div>
        <Link href={`/jobs/${jobId}`} className="text-sm text-neutral-500 hover:text-neutral-300">
          ← Back to job
        </Link>
      </div>

      {/* Which master is this tailored from? */}
      <div
        className={`mt-3 rounded-lg border px-3 py-2 text-[12px] ${
          data.masterSource === 'custom'
            ? 'border-emerald-900/50 bg-emerald-950/20 text-emerald-200'
            : 'border-amber-900/40 bg-amber-950/20 text-amber-200'
        }`}
      >
        {data.masterSource === 'custom' ? (
          <>Tailored from <strong>your own resume HTML</strong> — your real formatting is preserved.</>
        ) : (
          <>
            Tailored from an <strong>auto-generated</strong> master (loses your grouping, links &
            achievements).{' '}
            <Link href="/resumes/master" className="underline hover:text-white">
              Use your own resume HTML →
            </Link>
          </>
        )}
      </div>

      {/* Three audiences, three scores. */}
      <section className="mt-5 grid grid-cols-3 gap-3">
        <ScoreTile label="ATS" before={s.before.ats} after={s.after.ats} />
        <ScoreTile label="Recruiter" before={s.before.recruiter} after={s.after.recruiter} />
        <ScoreTile label="Hiring manager" before={s.before.hiringManager} after={s.after.hiringManager} />
      </section>
      <p className="mt-2 text-[11px] text-neutral-500">
        ATS = literal keyword match. Recruiter = quantified impact + legible stack. Hiring manager =
        project depth + ownership. All from your real content — nothing invented.
      </p>

      {/* What changed vs the master. */}
      {data.changes.length > 0 && (
        <section className="mt-5 rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-emerald-400">
            Changes applied
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-neutral-200">
            {data.changes.map((c, i) => (
              <li key={i}>+ {c.detail}</li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-neutral-500">
            Only exact keyword spellings for skills you already have — never an invented skill.
          </p>
        </section>
      )}

      {data.missingRequired.length > 0 && (
        <p className="mt-3 text-[11px] text-neutral-500">
          Not added (you&apos;d need to genuinely have these): {data.missingRequired.join(', ')} — add
          a line only if you&apos;ve actually used them.
        </p>
      )}

      {/* The tailored resume, rendered. */}
      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-400">Preview</h2>
        <button
          onClick={downloadPrint}
          className="rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-white"
        >
          ⬇ Download PDF (print)
        </button>
      </div>
      <p className="mt-1 text-[11px] text-neutral-500">
        Opens a clean print view — choose <b>Save as PDF</b>. It embeds a real text layer, so it
        stays ATS-readable.
      </p>
      <iframe
        title="Tailored resume preview"
        srcDoc={previewDoc(data)}
        className="mt-3 h-[900px] w-full overflow-hidden rounded-xl border border-neutral-700 bg-white"
      />
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
