-- VITPAY — 027 : liens de paiement réutilisables.
-- Un lien (ou son QR code) se partage une fois et sert à plusieurs clients : chaque ouverture
-- crée une demande de paiement ordinaire, rattachée au lien. Le mode (test / réel) est FIXÉ à la
-- création : un lien de test imprimé ne peut jamais encaisser de l'argent réel plus tard.

CREATE TABLE payment_links (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id),
  created_by     uuid NOT NULL REFERENCES users(id),
  public_token   text NOT NULL UNIQUE CHECK (public_token ~ '^[A-Za-z0-9_-]{16,64}$'),
  title          text NOT NULL CHECK (length(title) BETWEEN 2 AND 80),
  description    text CHECK (description IS NULL OR length(description) <= 200),
  -- NULL : montant libre, saisi par le client.
  amount_minor   bigint CHECK (amount_minor IS NULL OR amount_minor > 0),
  currency       text NOT NULL DEFAULT 'MAD' CHECK (currency ~ '^[A-Z]{3}$'),
  mode           text NOT NULL CHECK (mode IN ('sandbox','live')),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  disabled_at    timestamptz
);
CREATE INDEX payment_links_org_idx ON payment_links (org_id, created_at DESC);
ALTER TABLE payment_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment_links
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON payment_links TO vitpay_app;
GRANT SELECT, INSERT, UPDATE ON payment_links TO vitpay_system;

ALTER TABLE payment_requests ADD COLUMN payment_link_id uuid REFERENCES payment_links(id);
CREATE INDEX payment_requests_link_idx ON payment_requests (payment_link_id) WHERE payment_link_id IS NOT NULL;
