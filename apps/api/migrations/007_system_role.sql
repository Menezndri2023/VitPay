-- VITPAY — 007 : rôle système dédié et moindre privilège (suite de la revue indépendante).
--
-- Avant : le contournement de la RLS reposait sur une variable de session (`app.rls_bypass`) que le
-- rôle applicatif pouvait positionner lui-même — une injection SQL aurait suffi à lire toutes les
-- organisations. Désormais :
--   * vitpay_app    : requêtes d'une organisation, RLS stricte, AUCUN moyen de la contourner ;
--   * vitpay_system : chemins transverses justifiés (authentification, page publique, webhooks,
--                     admin, workers), BYPASSRLS, identifiants distincts.
-- Prérequis : le rôle `vitpay_system` existe (créé par l'infrastructure, cf. infra/postgres/init.sql).

-- 1) Politiques sans clause de contournement
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'memberships','points_of_sale','notifications',
    'provider_accounts','payment_requests','payment_attempts','refunds','disputes',
    'payouts','receipts','reconciliation_runs','reconciliation_items',
    'ledger_accounts','journal_entries','postings','incidents','outbox_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
        WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

DROP POLICY tenant_isolation ON organizations;
CREATE POLICY tenant_isolation ON organizations
  USING (id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.org_id', true), '')::uuid);

-- 2) Rôle applicatif : moindre privilège sur les tables de plateforme
REVOKE ALL ON sessions, idempotency_keys, webhook_inbox, approval_requests FROM vitpay_app;
REVOKE UPDATE, DELETE ON users FROM vitpay_app;            -- lecture + création (inscription) uniquement
REVOKE SELECT, UPDATE, DELETE ON outbox_events FROM vitpay_app;  -- publication uniquement
REVOKE UPDATE, DELETE ON incidents FROM vitpay_app;        -- ouverture uniquement
REVOKE ALL ON ALL TABLES IN SCHEMA mock_psp FROM vitpay_app;
REVOKE USAGE ON SCHEMA mock_psp FROM vitpay_app;

-- 3) Rôle système
GRANT USAGE ON SCHEMA public, mock_psp TO vitpay_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vitpay_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA mock_psp TO vitpay_system;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vitpay_system;
-- Les invariants d'immuabilité valent aussi pour le rôle système.
REVOKE UPDATE, DELETE, TRUNCATE ON journal_entries, postings, audit_log FROM vitpay_system;
REVOKE INSERT, UPDATE, DELETE ON currencies FROM vitpay_system;
REVOKE UPDATE, DELETE ON reconciliation_items FROM vitpay_system;
REVOKE ALL ON schema_migrations FROM vitpay_system, vitpay_app;
