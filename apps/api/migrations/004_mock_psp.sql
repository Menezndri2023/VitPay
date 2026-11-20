-- VITPAY — 004 : prestataire SIMULÉ (sandbox uniquement).
-- Schéma séparé : il représente un système EXTERNE. Le code VITPAY ne lit jamais ces tables
-- directement ; il passe par l'adaptateur MockProvider, comme pour un vrai prestataire.
CREATE SCHEMA mock_psp;

CREATE TABLE mock_psp.merchants (
  id              text PRIMARY KEY,
  api_key_hash    text NOT NULL,
  webhook_secret  text NOT NULL,
  webhook_url     text NOT NULL,
  fee_bps         integer NOT NULL DEFAULT 150,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mock_psp.payments (
  id            text PRIMARY KEY,
  merchant_id   text NOT NULL REFERENCES mock_psp.merchants(id),
  external_ref  text NOT NULL,
  amount_minor  bigint NOT NULL,
  currency      char(3) NOT NULL,
  description   text,
  return_url    text NOT NULL,
  status        text NOT NULL,
  fee_minor     bigint NOT NULL DEFAULT 0,
  failure_code  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  succeeded_at  timestamptz,
  UNIQUE (merchant_id, external_ref)
);

CREATE TABLE mock_psp.refunds (
  id            text PRIMARY KEY,
  payment_id    text NOT NULL REFERENCES mock_psp.payments(id),
  external_ref  text NOT NULL,
  amount_minor  bigint NOT NULL,
  status        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, external_ref)
);

CREATE TABLE mock_psp.disputes (
  id            text PRIMARY KEY,
  payment_id    text NOT NULL REFERENCES mock_psp.payments(id),
  amount_minor  bigint NOT NULL,
  status        text NOT NULL,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
