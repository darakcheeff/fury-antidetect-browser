-- The account's own stage, beside the lock's state.
--
-- The Status column has always shown the LOCK: free, open here, held by
-- somebody. The stage the account itself is in -- new, warming, ready, banned,
-- paused -- had no column, so it lived in tags (a tag is membership, not
-- state: a profile is in one stage at a time) or in the operator's head.
-- Every competitor with a team offering has this, each with its own set
-- (docs/12 D, docs/16 5.5). Free text with a suggested vocabulary rather than
-- an enum: an agency's stages are its own, and an enum would be ours.
ALTER TABLE profiles ADD COLUMN status TEXT NOT NULL DEFAULT '';
CREATE INDEX ON profiles (org_id, status) WHERE status <> '';
