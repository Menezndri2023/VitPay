-- VITPAY — rôles PostgreSQL (développement local uniquement).
-- vitpay_owner : propriétaire du schéma, exécute les migrations.
-- vitpay_app   : rôle applicatif, SANS BYPASSRLS, sans UPDATE/DELETE sur les tables immuables.
CREATE ROLE vitpay_app LOGIN PASSWORD 'dev_app_password_change_me' NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE vitpay_test OWNER vitpay_owner;
