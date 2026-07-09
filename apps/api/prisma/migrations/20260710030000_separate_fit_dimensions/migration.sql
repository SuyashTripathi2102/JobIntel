-- Four questions, four answers.
--
-- roleRelevance blended "is this software?" with "is this my job?", so a
-- React Native role and an LLM engineering role both printed 100% relevance
-- against a Node.js/MERN profile. They are genuinely 100% software and
-- genuinely not the search.
--
--   developmentConfidence — is hands-on development core to this role?
--   targetRoleFit         — does it match the families I search for?
--   specializationFit     — is its required stack my stack?
--   overallScore          — does my resume satisfy this specific JD?
ALTER TABLE "job_matches" ADD COLUMN "developmentConfidence" INTEGER;
ALTER TABLE "job_matches" ADD COLUMN "targetRoleFit" INTEGER;
ALTER TABLE "job_matches" ADD COLUMN "specializationFit" INTEGER;

-- What the user should DO, as opposed to what the system concluded. A yellow
-- CONSIDER on the best job CareerOS has found reads as "skip"; a one-year
-- experience stretch on your exact role and stack is WORTH_APPLYING.
ALTER TABLE "job_matches" ADD COLUMN "actionRecommendation" TEXT;
