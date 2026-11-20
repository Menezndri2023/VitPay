-- VITPAY — 025 : intégration SaaS (lot 1 « checkout »).
-- URL de retour vers le site du commerçant après paiement, métadonnées libres renvoyées dans les
-- webhooks et e-mail du client. Les limites sont aussi contrôlées par l'API ; la base les garantit.
ALTER TABLE payment_requests
  ADD COLUMN success_url    text,
  ADD COLUMN cancel_url     text,
  ADD COLUMN customer_email text,
  ADD COLUMN metadata       jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE payment_requests
  ADD CONSTRAINT payment_requests_success_url_chk CHECK (success_url IS NULL OR (success_url ~ '^https?://' AND length(success_url) <= 2048)),
  ADD CONSTRAINT payment_requests_cancel_url_chk  CHECK (cancel_url  IS NULL OR (cancel_url  ~ '^https?://' AND length(cancel_url)  <= 2048)),
  ADD CONSTRAINT payment_requests_customer_email_chk CHECK (customer_email IS NULL OR length(customer_email) <= 254),
  ADD CONSTRAINT payment_requests_metadata_chk CHECK (jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) <= 16384);
