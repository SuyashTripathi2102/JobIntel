-- Outreach Engine follow-up cadence: track how many nudges the user has logged
-- for a contact and when the last one went out, so CareerOS can surface "due for
-- a follow-up" — without ever sending anything itself.
ALTER TABLE "referral_contacts" ADD COLUMN "followUpCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "referral_contacts" ADD COLUMN "lastFollowUpAt" TIMESTAMP(3);
