#!/bin/sh
# VITPAY STAGING — rôles PostgreSQL (exécuté une seule fois, à la création du volume).
# Mots de passe fournis par l'environnement (générés sur le serveur), jamais versionnés.
#   vitpay_owner  : propriétaire de la base, exécute les migrations (pas superutilisateur) ;
#   vitpay_app    : rôle applicatif, RLS stricte, sans BYPASSRLS ;
#   vitpay_system : chemins transverses, BYPASSRLS (nécessite ce superutilisateur d'initialisation).
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v owner_pw="$PG_OWNER_PASSWORD" -v app_pw="$PG_APP_PASSWORD" -v system_pw="$PG_SYSTEM_PASSWORD" <<'SQL'
CREATE ROLE vitpay_owner LOGIN PASSWORD :'owner_pw' NOSUPERUSER NOCREATEROLE NOBYPASSRLS;
CREATE ROLE vitpay_app LOGIN PASSWORD :'app_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE vitpay_system LOGIN PASSWORD :'system_pw' NOSUPERUSER BYPASSRLS;
ALTER DATABASE vitpay OWNER TO vitpay_owner;
ALTER SCHEMA public OWNER TO vitpay_owner;
REVOKE ALL ON DATABASE vitpay FROM PUBLIC;
GRANT CONNECT ON DATABASE vitpay TO vitpay_owner, vitpay_app, vitpay_system;
SQL
