-- VITPAY — 023 : [R7-9] écriture du journal d'audit par une fonction dédiée.
-- Les rôles applicatif et système n'insèrent plus directement : l'empreinte chaînée est
-- calculée EN BASE, sous verrou, à partir de la dernière entrée. Une injection SQL ne peut donc
-- plus ajouter de ligne aux empreintes arbitraires (orpheline ou rompant la chaîne), et le rôle
-- applicatif ne peut écrire que pour son organisation courante (ou sans organisation).
CREATE OR REPLACE FUNCTION audit_append(
  p_occurred_at timestamptz, p_actor_type text, p_actor_user_id uuid, p_org_id uuid, p_action text,
  p_target_type text, p_target_id text, p_reason text, p_ip text, p_user_agent text,
  p_before jsonb, p_after jsonb, p_metadata jsonb, p_canonical text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE prev bytea;
BEGIN
  IF session_user = 'vitpay_app' AND p_org_id IS NOT NULL
     AND p_org_id IS DISTINCT FROM nullif(current_setting('app.org_id', true), '')::uuid THEN
    RAISE EXCEPTION 'audit_append: organization mismatch' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(727275); -- même clé que l'ancien chemin applicatif (sérialisation de la chaîne)
  SELECT hash INTO prev FROM audit_log ORDER BY id DESC LIMIT 1;
  INSERT INTO audit_log (occurred_at, actor_type, actor_user_id, org_id, action, target_type, target_id,
                         reason, ip, user_agent, before, after, metadata, prev_hash, hash)
  VALUES (p_occurred_at, p_actor_type, p_actor_user_id, p_org_id, p_action, p_target_type, p_target_id,
          p_reason, p_ip, p_user_agent, p_before, p_after, p_metadata, prev,
          sha256(coalesce(prev, ''::bytea) || convert_to(p_canonical, 'UTF8')));
END $$;
REVOKE ALL ON FUNCTION audit_append(timestamptz, text, uuid, uuid, text, text, text, text, text, text, jsonb, jsonb, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit_append(timestamptz, text, uuid, uuid, text, text, text, text, text, text, jsonb, jsonb, jsonb, text) TO vitpay_app, vitpay_system;

REVOKE INSERT ON audit_log FROM vitpay_app, vitpay_system;
DROP POLICY tenant_insert ON audit_log;
