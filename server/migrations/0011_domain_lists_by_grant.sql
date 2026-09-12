-- Domain lists that belong to the organisation, applied to a member through
-- the grant that lets them into a project.
--
-- The agent has refused hosts by name since 07.08.2026 and, since 12.09, can
-- be told "only these" with an @allow-only line (agent/src/blocklist.rs). Both
-- were per profile and per machine: a list lived in the operator's own data
-- directory. A team needs the other shape — the owner decides that the
-- freelancer's profiles open the one platform they exist for and nothing
-- beside it, and the freelancer's machine does not get a vote. AdsPower sells
-- this as "site management" per member group (docs/12, audit of 12.09).
--
-- So the list is the organisation's, and the grant carries which lists apply.
-- The server folds the texts into the launch spec; the agent parses them with
-- the same code it uses for its own lists and applies them in the relay, where
-- DNS-over-HTTPS cannot route around them. Owners and admins have no grant
-- rows and are not restricted — the lists are for the people they let in.

CREATE TABLE org_domain_lists (
    id          UUID        PRIMARY KEY,
    org_id      UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    -- As written: a hosts file, an Adblock list, one domain per line, with
    -- @allow-only on the first line for a whitelist. Parsed by the agent.
    body        TEXT        NOT NULL,
    created_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, name)
);

ALTER TABLE org_domain_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_domain_lists FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON org_domain_lists USING (user_in_org(org_id));

-- Which of the organisation's lists apply to this person in this project.
-- Ids rather than names: a renamed list must stay attached.
ALTER TABLE project_grants ADD COLUMN domain_lists UUID[] NOT NULL DEFAULT '{}';
