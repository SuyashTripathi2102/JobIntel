/**
 * The resume-tailoring pipeline. Architecture (fixed 2026-07-11):
 *
 *   Master Resume (HTML)   ← the source of truth, editable, never the PDF
 *          │
 *          ▼  transform for one JD (add exact ATS keywords, reorder, emphasise)
 *   Company Resume (HTML)  → diff → 3-audience scores → PDF (browser print)
 *
 * The master is generated from the CONFIRMED profile, so it carries the user's
 * real bullets, projects and wording — not an AI reconstruction. It never
 * invents experience: tailoring only reorders, rephrases for keywords, and
 * exposes what is already there.
 */
import type { ResumeProfile } from './resumes.service';
import { atsKeywordAudit } from '../matching/ats-keywords';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Clean, single-column, standard-heading HTML — the ATS-safe master. */
export function buildMasterHtml(p: ResumeProfile): string {
  const contact = [p.email, p.phone].filter(Boolean).map(esc).join(' · ');
  const skills = p.skills.map(esc).join(', ');

  const experience = p.experience
    .map(
      (e) => `    <div class="entry">
      <div class="entry-head"><span class="role">${esc(e.title)} — ${esc(e.company)}</span>` +
        `<span class="dates">${esc([e.startDate, e.endDate].filter(Boolean).join(' – ') || '')}</span></div>
      <ul>${e.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
    </div>`,
    )
    .join('\n');

  const projects = p.projects
    .map(
      (pr) => `    <div class="entry">
      <div class="role">${esc(pr.name)}${pr.technologies.length ? ` — ${esc(pr.technologies.join(', '))}` : ''}</div>
      <p>${esc(pr.description)}</p>
    </div>`,
    )
    .join('\n');

  const education = p.education
    .map((ed) => `    <div>${esc(ed.degree ?? '')} — ${esc(ed.institution)} ${esc(ed.year ?? '')}</div>`)
    .join('\n');

  const section = (title: string, body: string) =>
    body.trim() ? `  <section>\n    <h2>${title}</h2>\n${body}\n  </section>` : '';

  return `<article class="resume">
  <header>
    <h1>${esc(p.fullName ?? '')}</h1>
    ${p.headline ? `<div class="headline">${esc(p.headline)}</div>` : ''}
    ${contact ? `<div class="contact">${contact}</div>` : ''}
  </header>
${section('SUMMARY', p.summaryForMatching ? `    <p>${esc(p.summaryForMatching)}</p>` : '')}
${section('SKILLS', skills ? `    <p>${skills}</p>` : '')}
${section('EXPERIENCE', experience)}
${section('PROJECTS', projects)}
${section('EDUCATION', education)}
</article>`;
}

export interface ResumeChange {
  type: 'ADD_KEYWORD';
  detail: string;
}

export interface TailorResult {
  companyHtml: string;
  changes: ResumeChange[];
}

/**
 * Transform the master for one job: append the JD's exact keyword spellings for
 * skills the user already has (the ATS "free wins"). Never adds a skill the
 * resume lacks — that stays a suggestion for the user, never an auto-edit.
 */
export function tailorForJob(
  masterHtml: string,
  addExact: string[],
): TailorResult {
  const changes: ResumeChange[] = [];
  let companyHtml = masterHtml;

  if (addExact.length) {
    // Insert the exact ATS phrasings into the SKILLS line so a literal filter
    // matches. They sit alongside the user's own wording, never replacing it.
    companyHtml = companyHtml.replace(
      /(<h2>SKILLS<\/h2>\s*<p>)([\s\S]*?)(<\/p>)/,
      (_m, open: string, body: string, close: string) =>
        `${open}${body}, ${addExact.map(esc).join(', ')}${close}`,
    );
    for (const k of addExact) changes.push({ type: 'ADD_KEYWORD', detail: `Added ATS keyword “${k}”` });
  }

  return { companyHtml, changes };
}

export interface AudienceScores {
  ats: number | null;
  recruiter: number;
  hiringManager: number;
}

/**
 * Three readers, three scores. ATS is the literal keyword match (real).
 * Recruiter and hiring-manager are honest heuristics over the profile —
 * quantified impact and stack visibility for the recruiter's 6-second scan,
 * project depth and ownership for the hiring manager.
 */
export function scoreResume(
  p: ResumeProfile,
  required: string[],
  preferred: string[],
  resumeText: string,
): AudienceScores {
  const ats = atsKeywordAudit(required, preferred, resumeText, p.skills).requiredMatchPct;

  // Recruiter: do bullets quantify impact, is the stack legible, are years clear?
  const bullets = p.experience.flatMap((e) => e.highlights);
  const quantified = bullets.filter((b) => /\d/.test(b)).length;
  const recruiter = clamp(
    40 +
      (p.skills.length >= 6 ? 20 : p.skills.length * 3) +
      (p.totalYearsExperience != null ? 15 : 0) +
      (bullets.length ? Math.round((quantified / bullets.length) * 25) : 0),
  );

  // Hiring manager: project depth, ownership signals, breadth of experience.
  const ownership = bullets.filter((b) =>
    /built|led|owned|designed|architect|shipped|scaled/i.test(b),
  ).length;
  const hiringManager = clamp(
    35 +
      (p.projects.length >= 2 ? 25 : p.projects.length * 12) +
      Math.min(25, ownership * 5) +
      (bullets.length >= 6 ? 15 : 0),
  );

  return { ats, recruiter, hiringManager };
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
