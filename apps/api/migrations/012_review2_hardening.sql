-- VITPAY — 012 : corrections de la seconde revue indépendante (10/11/2026).

-- [R2-9] Rôle système : plus de DELETE sur les tables métier et financières (états uniquement).
REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM vitpay_system;
GRANT DELETE ON idempotency_keys TO vitpay_system;          -- libération des clés bloquées
GRANT DELETE ON ALL TABLES IN SCHEMA mock_psp TO vitpay_system; -- prestataire simulé (sandbox)

-- [H] Rôle applicatif : lecture des utilisateurs limitée aux colonnes non sensibles
-- (jamais les empreintes de mot de passe, secrets MFA, jetons d'enrôlement).
REVOKE SELECT ON users FROM vitpay_app;
GRANT SELECT (id, email, full_name, status, platform_role, locale, created_at) ON users TO vitpay_app;

-- [R2-4] Une notification par événement outbox et par organisation (idempotence garantie par la base).
CREATE UNIQUE INDEX notifications_outbox_uq ON notifications (org_id, (data->>'outboxId')) WHERE data ? 'outboxId';

-- [R2-5] Webhooks sortants : échecs consécutifs par endpoint (désactivation automatique).
ALTER TABLE webhook_endpoints ADD COLUMN consecutive_failures integer NOT NULL DEFAULT 0;
ALTER TABLE webhook_endpoints ADD COLUMN disabled_reason text;
