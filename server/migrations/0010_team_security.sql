-- Team security: who signed in, from where, with what — and what the
-- organisation demands before letting them.
--
-- The niche this product is for is teams, and the market review of 12.09.2026
-- (docs/08 §4) found that the two leaders on team features sell exactly this:
-- 2FA on the workspace, an IP allowlist for sign-in, a notice on a new device,
-- remote termination of someone else's session. server/src had none of the
-- words. For an agency that hands profiles to freelancers, "who signed in
-- from Lagos at 03:00" is closer to the reason to buy than one more
-- fingerprint vector.

-- ---------------------------------------------------------------------------
-- Every sign-in attempt, successful or not.
--
-- Separate from audit_events on purpose: audit rows belong to an organisation
-- and are written by an authenticated caller. A failed password has neither —
-- the caller is nobody yet — and the question this table answers ("is
-- somebody guessing at alice's password") has to include the failures.
-- ---------------------------------------------------------------------------

CREATE TABLE login_events (
    id            BIGSERIAL   PRIMARY KEY,
    -- The organisation of the user the attempt named, when that user exists.
    -- NULL for an unknown address: there is no organisation to show it to.
    -- SET NULL, like audit_events since 0007: the journal outlives the
    -- organisation, and a row nobody can see beats a row that is gone.
    org_id        UUID        REFERENCES organizations(id) ON DELETE SET NULL,
    user_id       UUID        REFERENCES users(id) ON DELETE SET NULL,
    -- As typed. Kept even when no such user exists, so a burst of attempts
    -- against "admin@" is visible as a burst rather than as nothing.
    email         TEXT        NOT NULL,
    -- ok | bad_password | ip_refused | totp_required | totp_failed | disabled
    outcome       TEXT        NOT NULL,
    ip            INET,
    machine_name  TEXT        NOT NULL DEFAULT '',
    machine_id    TEXT,
    user_agent    TEXT,
    at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON login_events (org_id, at DESC);
CREATE INDEX ON login_events (email, at DESC);

ALTER TABLE login_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_events FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON login_events FOR SELECT
    USING (org_id IS NOT NULL AND user_in_org(org_id));
-- Appended by the login handler on the pool connection, which carries no
-- caller and therefore matches no SELECT policy. The INSERT policy is open:
-- a sign-in attempt has no organisation to prove membership of — the point
-- is that it may have failed to — and the row is unreadable until a member of
-- the organisation it names asks. The first version relied on SECURITY
-- DEFINER to get past the policy and the test against a real PostgreSQL said
-- no: FORCE puts the owner under the policy too, definer or not.
CREATE POLICY journal_append ON login_events FOR INSERT WITH CHECK (true);
CREATE OR REPLACE FUNCTION record_login(
    p_org UUID, p_user UUID, p_email TEXT, p_outcome TEXT, p_ip INET,
    p_machine TEXT, p_machine_id TEXT, p_ua TEXT
) RETURNS VOID
LANGUAGE sql SECURITY DEFINER AS $$
    INSERT INTO login_events (org_id, user_id, email, outcome, ip, machine_name, machine_id, user_agent)
    VALUES (p_org, p_user, p_email, p_outcome, p_ip, p_machine, p_machine_id, p_ua)
$$;
REVOKE UPDATE, DELETE ON login_events FROM CURRENT_USER;
-- The two SET NULLs above are UPDATEs the cascade performs as this role;
-- everything else about a row stays unwritable. Same shape as 0007.
GRANT UPDATE (org_id, user_id) ON login_events TO CURRENT_USER;

-- ---------------------------------------------------------------------------
-- Sessions learn which device they were opened from.
--
-- machine_name is a display string the shell sends and the user can rename.
-- machine_id is the uuid settings.rs mints once per installation; "a new
-- device" means no earlier successful session carried this id for this user.
-- ---------------------------------------------------------------------------

ALTER TABLE sessions ADD COLUMN machine_id TEXT;
ALTER TABLE sessions ADD COLUMN user_agent TEXT;
CREATE INDEX ON sessions (user_id, machine_id);

-- ---------------------------------------------------------------------------
-- A second factor per user. TOTP only — the shared-rs implementation already
-- exists for the credential store, every authenticator app speaks it, and it
-- needs no mail server and no SMS contract on a self-hosted box.
--
-- The secret is stored as it must be: readable by the server, which has to
-- compute the code to compare. docs/01 assumes the server may be compromised;
-- what that costs here is bounded — a stolen secret is the second factor,
-- not the first, and the password hash beside it is Argon2id.
-- ---------------------------------------------------------------------------

ALTER TABLE users ADD COLUMN totp_secret BYTEA;
-- Set when the user confirmed a code from the new secret; NULL with a secret
-- present means enrolment was started and not finished, and the factor is not
-- yet required of them.
ALTER TABLE users ADD COLUMN totp_enabled_at TIMESTAMPTZ;

-- A sign-in that passed the password and awaits the code. Short-lived; the
-- row is deleted when consumed and swept with expired sessions otherwise.
CREATE TABLE login_challenges (
    id            UUID        PRIMARY KEY,
    user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip            INET,
    machine_name  TEXT        NOT NULL DEFAULT '',
    machine_id    TEXT,
    user_agent    TEXT,
    attempts      INT         NOT NULL DEFAULT 0,
    expires_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX ON login_challenges (expires_at);

-- ---------------------------------------------------------------------------
-- What the organisation requires. One JSON column rather than five: these
-- settings change together, are read together, and a shape can be added
-- without a migration.
--
--   {
--     "second_factor": "off" | "new_device" | "always",
--     "ip_allowlist":  ["203.0.113.0/24", "198.51.100.7"],
--     "owner_exempt_from_allowlist": true
--   }
--
-- The allowlist applies to members and admins; owners are exempt by default,
-- because an owner who locks themselves out of their own server with a typo
-- has no one to call. AdsPower makes the same exception.
-- ---------------------------------------------------------------------------

ALTER TABLE organizations ADD COLUMN security JSONB NOT NULL DEFAULT '{}';
