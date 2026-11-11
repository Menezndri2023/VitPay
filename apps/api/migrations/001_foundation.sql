-- VITPAY — 001 : fondations (identité, organisations, accès, audit, infrastructure transactionnelle)

CREATE TABLE currencies (
  code      char(3) PRIMARY KEY,
  exponent  smallint NOT NULL CHECK (exponent BETWEEN 0 AND 4),
  enabled   boolean NOT NULL DEFAULT false
);
-- Devises prévues par l'architecture. Seul MAD est activé (décision D7).
INSERT INTO currencies (code, exponent, enabled) VALUES
  ('MAD', 2, true), ('EUR', 2, false), ('USD', 2, false),
  ('GBP', 2, false), ('XOF', 0, false), ('XAF', 0, false);

CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text NOT NULL,
  password_hash      text NOT NULL,
  full_name          text NOT NULL,
  phone              text,
  locale             text NOT NULL DEFAULT 'fr' CHECK (locale IN ('fr','ar','en','es')),
  platform_role      text CHECK (platform_role IN ('super_admin','admin','finance','compliance','support','technical','auditor')),
  mfa_secret_enc     text,
  mfa_enabled        boolean NOT NULL DEFAULT false,
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until       timestamptz,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  token_hash    bytea NOT NULL UNIQUE,
  audience      text NOT NULL CHECK (audience IN ('business','admin')),
  mfa_verified  boolean NOT NULL DEFAULT false,
  ip            text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE organizations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type              text NOT NULL CHECK (type IN ('personal','business')),
  display_name      text NOT NULL,
  legal_name        text,
  ice               text,          -- Identifiant Commun de l'Entreprise (Maroc)
  rc                text,          -- Registre du commerce
  address           text,
  country           char(2) NOT NULL DEFAULT 'MA',
  default_currency  char(3) NOT NULL DEFAULT 'MAD' REFERENCES currencies(code),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  kyb_status        text NOT NULL DEFAULT 'not_started' CHECK (kyb_status IN ('not_started','submitted','verified','rejected')),
  kyb_submitted_at  timestamptz,
  kyb_decided_at    timestamptz,
  vitpay_fee_bps    integer NOT NULL DEFAULT 0 CHECK (vitpay_fee_bps BETWEEN 0 AND 1000),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  org_id      uuid NOT NULL REFERENCES organizations(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  role        text NOT NULL CHECK (role IN ('owner','admin','cashier','viewer')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE points_of_sale (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id),
  name        text NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pos_org_idx ON points_of_sale (org_id);

-- Journal d'audit : append-only, chaîné par hash (sha256(prev_hash || contenu)).
CREATE TABLE audit_log (
  id             bigserial PRIMARY KEY,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  actor_type     text NOT NULL CHECK (actor_type IN ('user','admin','system','provider','public')),
  actor_user_id  uuid,
  org_id         uuid,
  action         text NOT NULL,
  target_type    text,
  target_id      text,
  reason         text,
  ip             text,
  user_agent     text,
  before         jsonb,
  after          jsonb,
  metadata       jsonb,
  prev_hash      bytea,
  hash           bytea NOT NULL
);
CREATE INDEX audit_org_idx ON audit_log (org_id, id DESC);
CREATE INDEX audit_target_idx ON audit_log (target_type, target_id);

CREATE TABLE idempotency_keys (
  scope            text NOT NULL,
  key              text NOT NULL,
  request_hash     text NOT NULL,
  response_status  integer,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);

CREATE TABLE outbox_events (
  id              bigserial PRIMARY KEY,
  event_type      text NOT NULL,
  aggregate_type  text NOT NULL,
  aggregate_id    text NOT NULL,
  org_id          uuid,
  payload         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  available_at    timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text
);
CREATE INDEX outbox_pending_idx ON outbox_events (available_at) WHERE processed_at IS NULL;

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id),
  type        text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}',
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_org_idx ON notifications (org_id, created_at DESC);

CREATE TABLE approval_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action        text NOT NULL CHECK (action IN ('org.fee.update','org.reactivate')),
  target_type   text NOT NULL,
  target_id     text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}',
  reason        text NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by  uuid NOT NULL REFERENCES users(id),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid REFERENCES users(id),
  decided_at    timestamptz,
  decision_note text,
  CONSTRAINT four_eyes CHECK (decided_by IS NULL OR decided_by <> requested_by)
);

CREATE TABLE incidents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid,
  type            text NOT NULL,
  severity        text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  summary         text NOT NULL,
  details         jsonb NOT NULL DEFAULT '{}',
  dedupe_key      text UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES users(id),
  resolution_note text
);
CREATE INDEX incidents_status_idx ON incidents (status, created_at DESC);
