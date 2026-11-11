-- VITPAY — rôles PostgreSQL (développement local uniquement).
-- vitpay_owner : propriétaire du schéma, exécute les migrations.
-- vitpay_app    : rôle applicatif, SANS BYPASSRLS, sans UPDATE/DELETE sur les tables immuables.
-- vitpay_system : chemins transverses (auth, public, webhooks, admin, workers), BYPASSRLS.
CREATE ROLE vitpay_app LOGIN PASSWORD 'dev_app_password_change_me' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE vitpay_system LOGIN PASSWORD 'dev_system_password_change_me' NOSUPERUSER BYPASSRLS;
CREATE DATABASE vitpay_test OWNER vitpay_owner;
