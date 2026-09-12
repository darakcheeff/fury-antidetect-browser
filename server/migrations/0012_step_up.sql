-- A second factor on the actions that cannot be undone.
--
-- 0010 put the code on the door. A session that got in stays in for a week,
-- and the actions this product is nervous about -- purging a profile, removing
-- a member and replacing the organisation key, changing the sign-in policy,
-- ending everyone's sessions -- are the ones a stolen laptop with an open
-- session would take. AdsPower asks for the code again on exactly these
-- (docs/12, audit of 12.09.2026). So does this, when the organisation says so:
-- a fresh code marks the session for ten minutes, and the sensitive handlers
-- refuse a session whose mark is older or absent.

ALTER TABLE sessions ADD COLUMN totp_verified_at TIMESTAMPTZ;
