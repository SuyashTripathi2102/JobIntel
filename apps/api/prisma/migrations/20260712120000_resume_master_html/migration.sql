-- Master Resume: the user's canonical resume as editable HTML — the source of
-- truth for tailoring. When set, company resumes derive from THIS (preserving the
-- user's real formatting, grouped skills, sub-projects, links, achievements)
-- rather than a lossy regeneration from the PDF parse.
ALTER TABLE "resumes" ADD COLUMN "masterHtml" TEXT;
