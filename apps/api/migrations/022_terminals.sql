-- VITPAY — 022 : terminaux de paiement (TPE) — P6 suite.
-- Seule implémentation : le TPE SIMULÉ du prestataire simulé (sandbox). Aucun protocole de
-- terminal réel n'est implémenté ni supposé (docs/INTEGRATIONS.md).

-- ── Côté prestataire simulé (système EXTERNE simulé) ──
CREATE TABLE mock_psp.terminals (
  id           text PRIMARY KEY,
  merchant_id  text NOT NULL REFERENCES mock_psp.merchants(id),
  label        text NOT NULL,
  status       text NOT NULL DEFAULT 'online' CHECK (status IN ('online','offline')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mock_psp.payments ADD COLUMN terminal_id text REFERENCES mock_psp.terminals(id);
-- Un terminal n'affiche qu'un seul encaissement à la fois.
CREATE UNIQUE INDEX mock_terminal_one_active_uq ON mock_psp.payments (terminal_id)
  WHERE terminal_id IS NOT NULL AND status IN ('pending','requires_action','processing');
GRANT SELECT, INSERT, UPDATE, DELETE ON mock_psp.terminals TO vitpay_app, vitpay_system;

-- ── Côté VITPAY ──
CREATE TABLE terminals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES organizations(id),
  provider_account_id  uuid NOT NULL REFERENCES provider_accounts(id),
  provider_code        text NOT NULL,
  terminal_ref         text NOT NULL,           -- identifiant chez le fournisseur (jamais inventé)
  label                text NOT NULL CHECK (length(label) BETWEEN 2 AND 60),
  pos_id               uuid REFERENCES points_of_sale(id),
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_account_id, terminal_ref)
);
CREATE INDEX terminals_org_idx ON terminals (org_id);
ALTER TABLE terminals ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON terminals
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON terminals TO vitpay_app;
GRANT SELECT, INSERT, UPDATE ON terminals TO vitpay_system;

-- Encaissement carte présente : méthode dédiée, rattachée au terminal.
ALTER TABLE payment_attempts DROP CONSTRAINT payment_attempts_method_check;
ALTER TABLE payment_attempts ADD CONSTRAINT payment_attempts_method_check
  CHECK (method IN ('card','bank_transfer','mobile_money','card_present'));
ALTER TABLE payment_attempts ADD COLUMN terminal_id uuid REFERENCES terminals(id);
ALTER TABLE payment_attempts ADD CONSTRAINT payment_attempts_terminal_check
  CHECK ((method = 'card_present') = (terminal_id IS NOT NULL));
