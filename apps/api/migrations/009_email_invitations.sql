-- VITPAY — 009 : e-mails sortants, réinitialisation de mot de passe, invitations d'équipe.

-- File d'e-mails (envoi asynchrone avec reprise). Le corps est PURGÉ après envoi :
-- il peut contenir un lien à jeton (réinitialisation, invitation).
CREATE TABLE outbound_emails (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid,
  to_address  text NOT NULL,
  template    text NOT NULL,
  subject     text NOT NULL,
  text_body   text,
  html_body   text,
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  attempts    integer NOT NULL DEFAULT 0,
  last_error  text,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);
CREATE INDEX outbound_emails_queue_idx ON outbound_emails (available_at) WHERE status = 'queued';

CREATE TABLE password_resets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  token_hash  bytea NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE org_invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id),
  email        text NOT NULL,
  role         text NOT NULL CHECK (role IN ('admin','cashier','viewer')),
  token_hash   bytea NOT NULL UNIQUE,
  invited_by   uuid NOT NULL REFERENCES users(id),
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  accepted_by  uuid REFERENCES users(id),
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX org_invitations_pending_uq ON org_invitations (org_id, lower(email)) WHERE accepted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE org_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON org_invitations
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);

-- Rôle applicatif : invitations de son organisation uniquement ; e-mails en écriture seule.
GRANT SELECT, INSERT, UPDATE ON org_invitations TO vitpay_app;
GRANT INSERT ON outbound_emails TO vitpay_app;
-- Rôle système : tout (envoi, réinitialisation, acceptation d'invitation).
GRANT SELECT, INSERT, UPDATE, DELETE ON outbound_emails, password_resets, org_invitations TO vitpay_system;
