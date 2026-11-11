-- VITPAY — 013 : vérification de l'adresse e-mail, rotation des secrets de signature des webhooks.

-- Vérification e-mail. Les comptes existants (administrateurs créés par CLI, membres invités
-- par lien reçu sur leur adresse) sont considérés comme vérifiés.
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
UPDATE users SET email_verified_at = created_at;
GRANT SELECT (email_verified_at) ON users TO vitpay_app;

CREATE TABLE email_verifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  token_hash  bytea NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_verifications_user_idx ON email_verifications (user_id, created_at);
GRANT SELECT, INSERT, UPDATE ON email_verifications TO vitpay_system;
GRANT INSERT ON email_verifications TO vitpay_app; -- lien envoyé dans la transaction d'inscription

-- Rotation des secrets webhook : l'ancien secret reste accepté pendant une période de
-- recouvrement (double signature v1=…,v1=…) pour un basculement sans interruption.
ALTER TABLE webhook_endpoints ADD COLUMN previous_secret_enc text;
ALTER TABLE webhook_endpoints ADD COLUMN previous_secret_expires_at timestamptz;
ALTER TABLE webhook_endpoints ADD COLUMN secret_rotated_at timestamptz;
