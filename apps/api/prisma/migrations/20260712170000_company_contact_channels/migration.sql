-- Cached public contact channels for the referral "Ways in" ladder
-- ({ emails, contactPageUrl, blogUrl, blogAuthors, probedAt }). Company-level and
-- refreshed ~14d, so the ladder stays rich across loads, not only on first find.
ALTER TABLE "companies" ADD COLUMN "contactChannels" JSONB;
