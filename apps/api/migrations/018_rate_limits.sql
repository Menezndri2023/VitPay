-- VITPAY — 018 : limitation de débit partagée entre instances (ADR-007 : PostgreSQL, pas de Redis au MVP).
-- Table non journalisée (UNLOGGED) : compteurs éphémères, perdus sans conséquence en cas de crash.
CREATE UNLOGGED TABLE rate_limits (
  key            text PRIMARY KEY,
  hits           integer NOT NULL,
  expires_at     timestamptz NOT NULL,
  blocked_until  timestamptz
);
CREATE INDEX rate_limits_expiry_idx ON rate_limits (expires_at);
-- Aucune donnée d'organisation (clés hachées par le garde) : pas de RLS ; écriture par le rôle applicatif.
GRANT SELECT, INSERT, UPDATE ON rate_limits TO vitpay_app;
GRANT SELECT, DELETE ON rate_limits TO vitpay_system; -- purge des compteurs expirés
