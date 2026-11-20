-- VITPAY — 008 : relevés de commissions (modèle A : la commission VITPAY est facturée HORS flux).
-- Document pro forma tant que le format de facture et la TVA ne sont pas validés (COMPLIANCE.md E2).

CREATE TABLE commission_statements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id),
  number        text NOT NULL UNIQUE,
  mode          text NOT NULL CHECK (mode IN ('sandbox','live')),
  period_start  date NOT NULL,
  period_end    date NOT NULL CHECK (period_end >= period_start),
  currency      char(3) NOT NULL REFERENCES currencies(code),
  fees_minor    bigint NOT NULL CHECK (fees_minor >= 0),
  line_count    integer NOT NULL CHECK (line_count >= 0),
  status        text NOT NULL CHECK (status IN ('issued','paid','void')),
  issued_by     uuid NOT NULL REFERENCES users(id),
  issued_at     timestamptz NOT NULL DEFAULT now(),
  paid_at       timestamptz,
  payment_reference text,
  voided_at     timestamptz,
  void_reason   text
);
CREATE INDEX commission_statements_org_idx ON commission_statements (org_id, issued_at DESC);
CREATE SEQUENCE commission_statement_seq;

CREATE TABLE commission_statement_lines (
  id            bigserial PRIMARY KEY,
  statement_id  uuid NOT NULL REFERENCES commission_statements(id),
  org_id        uuid NOT NULL,
  attempt_id    uuid NOT NULL REFERENCES payment_attempts(id),
  fee_minor     bigint NOT NULL CHECK (fee_minor >= 0),
  active        boolean NOT NULL DEFAULT true
);
-- Un paiement n'est facturé qu'une fois (tant que le relevé n'est pas annulé).
CREATE UNIQUE INDEX commission_lines_attempt_active_uq ON commission_statement_lines (attempt_id) WHERE active;

ALTER TABLE commission_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_statement_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON commission_statements
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
CREATE POLICY tenant_isolation ON commission_statement_lines
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);

-- Commerçant : lecture seule. Émission, encaissement, annulation : rôle système (VITPAY ADMIN).
GRANT SELECT ON commission_statements, commission_statement_lines TO vitpay_app;
GRANT SELECT, INSERT, UPDATE ON commission_statements, commission_statement_lines TO vitpay_system;
GRANT USAGE, SELECT ON SEQUENCE commission_statement_seq, commission_statement_lines_id_seq TO vitpay_system;
