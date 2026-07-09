'use client';

import { useEffect, useRef, useState } from 'react';
import { apiGet, apiUpload } from '../../lib/api';

interface AtsCheck {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
}

interface AtsReport {
  score: number;
  verdict: 'SAFE' | 'RISKY' | 'UNREADABLE';
  letterRatio: number;
  checks: AtsCheck[];
  warning?: string;
}

interface ResumeVersion {
  id: string;
  createdAt: string;
  activatedAt: string | null;
  atsScore: number | null;
  atsVerdict: 'SAFE' | 'RISKY' | 'UNREADABLE' | null;
}

interface Resume {
  id: string;
  title: string;
  isPrimary: boolean;
  versions: ResumeVersion[];
}

const VERDICT = {
  SAFE: {
    tone: 'border-emerald-800 bg-emerald-950/60 text-emerald-300',
    line: 'Every applicant tracking system will read this correctly.',
  },
  RISKY: {
    tone: 'border-amber-800 bg-amber-950/60 text-amber-300',
    line: 'Readable, but some systems may miss parts of it.',
  },
  UNREADABLE: {
    tone: 'border-red-800 bg-red-950/60 text-red-300',
    line: 'An ATS will read almost nothing from this file.',
  },
} as const;

function AtsPanel({ report }: { report: AtsReport }) {
  const v = VERDICT[report.verdict];
  return (
    <div className={`mt-4 rounded-xl border p-4 ${v.tone}`}>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold uppercase tracking-wide">{report.verdict}</span>
        <span className="text-2xl font-semibold tabular-nums">{report.score}/100</span>
      </div>
      <p className="mt-1 text-sm opacity-90">{v.line}</p>

      <ul className="mt-4 space-y-1.5">
        {report.checks.map((c) => (
          <li key={c.id} className="flex gap-2 text-sm">
            <span className={c.pass ? 'text-emerald-400' : 'text-red-400'}>{c.pass ? '✓' : '✗'}</span>
            <span className="text-neutral-200">{c.label}</span>
            <span className="ml-auto text-right text-xs text-neutral-400">{c.detail}</span>
          </li>
        ))}
      </ul>

      {report.warning && (
        <p className="mt-4 rounded-lg bg-black/30 p-3 text-sm text-neutral-200">{report.warning}</p>
      )}
    </div>
  );
}

export default function Resumes() {
  const [resumes, setResumes] = useState<Resume[] | null>(null);
  const [report, setReport] = useState<AtsReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = () => apiGet<Resume[]>('/resumes').then(setResumes).catch((e) => setError(String(e)));
  useEffect(() => {
    void load();
  }, []);

  async function onFile(file: File) {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const primary = resumes?.find((r) => r.isPrimary);
      const res = await apiUpload<{ ats: AtsReport }>(
        '/resumes',
        file,
        primary ? { resumeId: primary.id } : {},
      );
      setReport(res.ats);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-8 text-neutral-100">
      <div className="mx-auto w-full max-w-3xl">
        <header className="flex items-baseline justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Resume</h1>
            <p className="text-sm text-neutral-400">
              Uploading re-scores every actionable job against the new resume.
            </p>
          </div>
          <a href="/" className="text-sm text-neutral-400 hover:text-neutral-200">
            Mission Control
          </a>
        </header>

        <label
          className={`mt-6 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed p-10 text-center ${
            busy ? 'border-neutral-700 opacity-60' : 'border-neutral-700 hover:border-neutral-500'
          }`}
        >
          <input
            ref={input}
            type="file"
            accept="application/pdf"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
          <span className="text-sm font-medium text-neutral-200">
            {busy ? 'Checking and parsing…' : 'Drop a PDF here, or click to choose'}
          </span>
          <span className="mt-1 text-xs text-neutral-500">
            Export with Chrome → Print → Save as PDF. Design tools often produce PDFs no ATS can read.
          </span>
        </label>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        {report && <AtsPanel report={report} />}

        <section className="mt-8">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-400">Versions</h2>
          {!resumes && <p className="mt-3 text-sm text-neutral-500">Loading…</p>}
          {resumes?.length === 0 && (
            <p className="mt-3 text-sm text-neutral-500">No resume uploaded yet.</p>
          )}
          <ul className="mt-3 space-y-2">
            {resumes?.flatMap((r) =>
              r.versions.map((v, i) => (
                <li
                  key={v.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate text-neutral-200">
                      {r.title}
                      <span className="ml-2 text-neutral-500">
                        v{r.versions.length - i} · {new Date(v.createdAt).toLocaleDateString('en-IN')}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px]">
                      {v.atsVerdict && (
                        <span
                          className={
                            v.atsVerdict === 'SAFE'
                              ? 'text-emerald-400'
                              : v.atsVerdict === 'RISKY'
                                ? 'text-amber-400'
                                : 'text-red-400'
                          }
                        >
                          ATS {v.atsScore}/100 {v.atsVerdict}
                        </span>
                      )}
                      <span className={v.activatedAt ? 'text-emerald-400' : 'text-amber-400'}>
                        {v.activatedAt ? 'active — matching jobs' : 'not reviewed — not matching yet'}
                      </span>
                    </div>
                  </div>
                  <a
                    href={`/resumes/${v.id}`}
                    className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium ${
                      v.activatedAt
                        ? 'border border-neutral-700 text-neutral-300 hover:border-neutral-500'
                        : 'bg-neutral-100 text-neutral-950 hover:bg-white'
                    }`}
                  >
                    {v.activatedAt ? 'Review' : 'Review & activate'}
                  </a>
                </li>
              )),
            )}
          </ul>
        </section>
      </div>
    </main>
  );
}
