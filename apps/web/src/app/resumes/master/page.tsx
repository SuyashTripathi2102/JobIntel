'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiDelete, apiGet, apiPut } from '@/lib/api';

interface Master {
  html: string;
  source: 'custom' | 'generated';
}

export default function MasterResumePage() {
  const [html, setHtml] = useState('');
  const [source, setSource] = useState<'custom' | 'generated'>('generated');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    apiGet<Master>('/resumes/master')
      .then((m) => {
        setHtml(m.html);
        setSource(m.source);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function save() {
    setStatus('Saving…');
    try {
      await apiPut('/resumes/master', { html });
      setSource('custom');
      setStatus('Saved — this is now your source of truth for every tailored resume.');
    } catch (e) {
      setStatus(null);
      setError(String(e));
    }
  }

  async function revert() {
    setStatus('Reverting…');
    try {
      await apiDelete('/resumes/master');
      setStatus('Reverted to the profile-generated master.');
      setLoading(true);
      load();
    } catch (e) {
      setStatus(null);
      setError(String(e));
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-8 text-neutral-100">
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Master resume</h1>
            <p className="text-sm text-neutral-400">
              The source of truth. Every tailored, company-specific resume is derived from this —
              never from re-parsing your PDF.
            </p>
          </div>
          <Link href="/resumes" className="text-sm text-neutral-500 hover:text-neutral-300">
            ← Resumes
          </Link>
        </div>

        <div
          className={`mt-4 rounded-xl border p-3 text-[13px] ${
            source === 'custom'
              ? 'border-emerald-900/50 bg-emerald-950/20 text-emerald-200'
              : 'border-amber-900/40 bg-amber-950/20 text-amber-200'
          }`}
        >
          {source === 'custom' ? (
            <>
              ✓ Using <strong>your own resume HTML</strong>. Tailoring preserves your exact
              formatting, grouped skills, sub-projects, links and achievements.
            </>
          ) : (
            <>
              Currently using an <strong>auto-generated</strong> master from your parsed profile —
              which loses grouping, project structure, links and achievements. Paste your real resume
              HTML below and save to fix that. (Open your <code>.html</code> resume, select all, copy,
              paste here.)
            </>
          )}
        </div>

        {error && <p className="mt-3 text-red-400">{error}</p>}
        {status && <p className="mt-3 text-sm text-neutral-300">{status}</p>}

        {loading ? (
          <p className="mt-6 text-neutral-400">Loading…</p>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs uppercase tracking-wide text-neutral-500">HTML</label>
                <div className="flex gap-2">
                  {source === 'custom' && (
                    <button
                      onClick={revert}
                      className="rounded-lg border border-neutral-700 px-3 py-1 text-[12px] text-neutral-300 hover:border-neutral-500"
                    >
                      Revert to generated
                    </button>
                  )}
                  <button
                    onClick={save}
                    className="rounded-lg bg-neutral-100 px-3 py-1 text-[12px] font-medium text-neutral-950 hover:bg-white"
                  >
                    Save as master
                  </button>
                </div>
              </div>
              <textarea
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                spellCheck={false}
                className="h-[70vh] w-full rounded-lg border border-neutral-700 bg-neutral-950 p-3 font-mono text-[12px] leading-relaxed text-neutral-200 focus:border-neutral-500 focus:outline-none"
              />
            </div>
            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Live preview</div>
              <iframe
                title="Resume preview"
                srcDoc={html}
                className="h-[70vh] w-full rounded-lg border border-neutral-700 bg-white"
              />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
