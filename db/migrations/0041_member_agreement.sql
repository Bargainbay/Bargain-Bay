-- Which version of the Member Agreement an applicant accepted, and when. Written when they ask for member access
-- (components/MemberRequest.jsx -> lib/members.js requestMembership). Members approved before this existed have NULLs:
-- they are not asked to accept retroactively, and a NULL is not a refusal.
ALTER TABLE users ADD COLUMN IF NOT EXISTS member_terms_version     text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS member_terms_accepted_at timestamptz;
