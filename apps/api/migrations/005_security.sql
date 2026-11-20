-- VITPAY — 005 : isolation multi-tenant (RLS) et droits du rôle applicatif.
--
-- Le rôle applicatif `vitpay_app` n'est pas propriétaire des tables et n'a pas BYPASSRLS.
-- Chaque transaction applicative positionne `app.org_id` (SET LOCAL). Les lectures
-- transverses (connexion, page publique, administration) positionnent `app.rls_bypass = on`
-- dans une transaction dédiée et journalisée par le code.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'memberships','points_of_sale','notifications',
    'provider_accounts','payment_requests','payment_attempts','refunds','disputes',
    'payouts','receipts','reconciliation_runs','reconciliation_items',
    'ledger_accounts','journal_entries','postings'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (
          org_id = nullif(current_setting('app.org_id', true), '')::uuid
          OR current_setting('app.rls_bypass', true) = 'on'
        )
        WITH CHECK (
          org_id = nullif(current_setting('app.org_id', true), '')::uuid
          OR current_setting('app.rls_bypass', true) = 'on'
        )$p$, t);
  END LOOP;
END $$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organizations
  USING (
    id = nullif(current_setting('app.org_id', true), '')::uuid
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    id = nullif(current_setting('app.org_id', true), '')::uuid
    OR current_setting('app.rls_bypass', true) = 'on'
  );

-- Droits du rôle applicatif
GRANT USAGE ON SCHEMA public, mock_psp TO vitpay_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vitpay_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA mock_psp TO vitpay_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vitpay_app;

-- Tables immuables : pas de modification ni suppression, même en cas de bug applicatif.
REVOKE UPDATE, DELETE, TRUNCATE ON journal_entries, postings, audit_log FROM vitpay_app;
-- Le référentiel des devises n'est modifiable que par migration.
REVOKE INSERT, UPDATE, DELETE ON currencies FROM vitpay_app;
-- Les écritures et lignes de rapprochement sont append-only.
REVOKE UPDATE, DELETE ON reconciliation_items FROM vitpay_app;
