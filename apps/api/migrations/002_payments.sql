-- VITPAY — 002 : comptes prestataires (modèle A), demandes, tentatives, remboursements, litiges, règlements

-- Modèle A : chaque organisation connecte SON compte chez un prestataire agréé.
-- Les identifiants sont chiffrés (AES-256-GCM) par l'application ; jamais en clair en base.
CREATE TABLE provider_accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations(id),
  provider_code       text NOT NULL,
  mode                text NOT NULL CHECK (mode IN ('sandbox','live')),
  label               text NOT NULL,
  credentials_enc     text NOT NULL,
  webhook_secret_enc  text NOT NULL,
  priority            integer NOT NULL DEFAULT 100,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, provider_code, mode)
);

CREATE TABLE payment_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id),
  pos_id            uuid REFERENCES points_of_sale(id),
  created_by        uuid NOT NULL REFERENCES users(id),
  reference         text NOT NULL UNIQUE,
  public_token      text NOT NULL UNIQUE,
  amount_minor      bigint NOT NULL CHECK (amount_minor > 0),
  currency          char(3) NOT NULL REFERENCES currencies(code),
  description       text,
  customer_name     text,
  customer_contact  text,
  mode              text NOT NULL CHECK (mode IN ('sandbox','live')),
  status            text NOT NULL CHECK (status IN ('open','paid','expired','cancelled')),
  expires_at        timestamptz NOT NULL,
  paid_at           timestamptz,
  cancelled_at      timestamptz,
  version           integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_requests_org_idx ON payment_requests (org_id, created_at DESC);
CREATE INDEX payment_requests_open_exp_idx ON payment_requests (expires_at) WHERE status = 'open';

CREATE TABLE payment_attempts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES organizations(id),
  payment_request_id   uuid NOT NULL REFERENCES payment_requests(id),
  provider_account_id  uuid NOT NULL REFERENCES provider_accounts(id),
  provider_code        text NOT NULL,
  provider_ref         text,
  method               text NOT NULL CHECK (method IN ('card','bank_transfer','mobile_money')),
  status               text NOT NULL CHECK (status IN (
                          'created','pending','requires_action','processing',
                          'authorized','captured','succeeded','failed','cancelled','expired')),
  amount_minor         bigint NOT NULL CHECK (amount_minor > 0),
  currency             char(3) NOT NULL REFERENCES currencies(code),
  provider_fee_minor   bigint CHECK (provider_fee_minor >= 0),
  vitpay_fee_minor     bigint CHECK (vitpay_fee_minor >= 0),
  checkout_url         text,
  failure_code         text,
  failure_message      text,
  settlement_status    text NOT NULL DEFAULT 'unsettled' CHECK (settlement_status IN ('unsettled','settled')),
  settled_at           timestamptz,
  settlement_ref       text,
  version              integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  succeeded_at         timestamptz,
  UNIQUE (provider_code, provider_ref)
);
CREATE INDEX payment_attempts_req_idx ON payment_attempts (payment_request_id);
CREATE INDEX payment_attempts_org_idx ON payment_attempts (org_id, created_at DESC);
-- Une seule tentative active par demande (anti-double paiement).
CREATE UNIQUE INDEX payment_attempts_one_active_uq ON payment_attempts (payment_request_id)
  WHERE status IN ('created','pending','requires_action','processing','authorized','captured');

CREATE TABLE refunds (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations(id),
  payment_attempt_id uuid NOT NULL REFERENCES payment_attempts(id),
  amount_minor       bigint NOT NULL CHECK (amount_minor > 0),
  currency           char(3) NOT NULL REFERENCES currencies(code),
  reason             text NOT NULL,
  status             text NOT NULL CHECK (status IN ('requested','pending','succeeded','failed')),
  provider_ref       text,
  failure_message    text,
  requested_by       uuid NOT NULL REFERENCES users(id),
  version            integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refunds_attempt_idx ON refunds (payment_attempt_id);

CREATE TABLE disputes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations(id),
  payment_attempt_id uuid NOT NULL REFERENCES payment_attempts(id),
  provider_ref       text NOT NULL,
  amount_minor       bigint NOT NULL CHECK (amount_minor > 0),
  currency           char(3) NOT NULL REFERENCES currencies(code),
  reason             text,
  status             text NOT NULL CHECK (status IN ('opened','evidence_submitted','won','lost')),
  version            integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_attempt_id, provider_ref)
);

-- Reversements observés (modèle A : exécutés par le prestataire, VITPAY ne fait que les constater).
CREATE TABLE payouts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations(id),
  provider_account_id uuid NOT NULL REFERENCES provider_accounts(id),
  provider_ref        text NOT NULL,
  amount_minor        bigint NOT NULL CHECK (amount_minor >= 0),
  currency            char(3) NOT NULL REFERENCES currencies(code),
  status              text NOT NULL CHECK (status IN ('payout_pending','paid_out','payout_failed')),
  report_date         date NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_account_id, provider_ref)
);

CREATE TABLE receipts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations(id),
  payment_attempt_id uuid NOT NULL UNIQUE REFERENCES payment_attempts(id),
  number             text NOT NULL UNIQUE,
  issued_at          timestamptz NOT NULL DEFAULT now()
);
CREATE SEQUENCE receipt_number_seq;

-- Webhooks entrants : stockés bruts AVANT traitement (inbox).
CREATE TABLE webhook_inbox (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code       text NOT NULL,
  provider_account_id uuid REFERENCES provider_accounts(id),
  org_id              uuid,
  provider_event_id   text,
  event_type          text,
  object_ref          text,
  headers             jsonb NOT NULL,
  raw_body            text NOT NULL,
  signature_valid     boolean NOT NULL,
  status              text NOT NULL CHECK (status IN ('received','processed','failed','rejected')),
  attempts            integer NOT NULL DEFAULT 0,
  error               text,
  received_at         timestamptz NOT NULL DEFAULT now(),
  processed_at        timestamptz,
  UNIQUE (provider_account_id, provider_event_id)
);
CREATE INDEX webhook_inbox_status_idx ON webhook_inbox (status, received_at);

CREATE TABLE reconciliation_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations(id),
  provider_account_id uuid NOT NULL REFERENCES provider_accounts(id),
  report_date         date NOT NULL,
  status              text NOT NULL CHECK (status IN ('completed','completed_with_mismatches','failed')),
  stats               jsonb NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reconciliation_items (
  id            bigserial PRIMARY KEY,
  run_id        uuid NOT NULL REFERENCES reconciliation_runs(id),
  org_id        uuid NOT NULL,
  provider_ref  text,
  attempt_id    uuid,
  result        text NOT NULL CHECK (result IN ('matched','missing_in_ledger','missing_in_provider','amount_mismatch','fee_mismatch')),
  details       jsonb NOT NULL DEFAULT '{}'
);
