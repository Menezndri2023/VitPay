-- VITPAY — 011 : API publique (clés par organisation) et webhooks sortants signés.

ALTER TABLE audit_log DROP CONSTRAINT audit_log_actor_type_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_actor_type_check
  CHECK (actor_type IN ('user','admin','system','provider','public','api_key'));

CREATE TABLE api_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id),
  name          text NOT NULL,
  prefix        text NOT NULL,              -- partie affichable (ex. vp_sk_ab12cd34)
  key_hash      bytea NOT NULL UNIQUE,      -- SHA-256 de la clé complète ; la clé n'est jamais stockée
  scopes        text[] NOT NULL,
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
CREATE INDEX api_keys_org_idx ON api_keys (org_id);

CREATE TABLE webhook_endpoints (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id),
  url         text NOT NULL,
  secret_enc  text NOT NULL,
  events      text[] NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhook_deliveries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL,
  endpoint_id      uuid NOT NULL REFERENCES webhook_endpoints(id),
  event_id         text NOT NULL,          -- identifiant stable de l'événement (outbox)
  event_type       text NOT NULL,
  payload          jsonb NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed')),
  attempts         integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_status_code integer,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  delivered_at     timestamptz,
  UNIQUE (endpoint_id, event_id)
);
CREATE INDEX webhook_deliveries_due_idx ON webhook_deliveries (next_attempt_at) WHERE status = 'pending';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['api_keys','webhook_endpoints','webhook_deliveries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
      WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON api_keys, webhook_endpoints TO vitpay_app;
GRANT SELECT, INSERT ON webhook_deliveries TO vitpay_app;
GRANT SELECT, INSERT, UPDATE ON api_keys, webhook_endpoints, webhook_deliveries TO vitpay_system;
