-- VITPAY — 024 : corrections de la huitième revue (TPE, journal d'audit), 11/11/2026.
-- [R8-C1] audit_append vérifie que l'empreinte porte EXACTEMENT sur la ligne insérée (le texte
-- canonique doit correspondre aux colonnes) et refuse les dates d'événement antidatées.
-- [R8-P3] Exige READ COMMITTED (lecture fraîche de la dernière empreinte après le verrou).
-- [R8-P4] Contrôle d'organisation pour tout rôle sans BYPASSRLS (et non un nom de rôle figé).
CREATE OR REPLACE FUNCTION audit_append(
  p_occurred_at timestamptz, p_actor_type text, p_actor_user_id uuid, p_org_id uuid, p_action text,
  p_target_type text, p_target_id text, p_reason text, p_ip text, p_user_agent text,
  p_before jsonb, p_after jsonb, p_metadata jsonb, p_canonical text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  prev bytea;
  expected jsonb;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'audit_append: READ COMMITTED required' USING ERRCODE = '25001';
  END IF;
  IF NOT coalesce((SELECT rolbypassrls FROM pg_roles WHERE rolname = session_user), false)
     AND p_org_id IS NOT NULL
     AND p_org_id IS DISTINCT FROM nullif(current_setting('app.org_id', true), '')::uuid THEN
    RAISE EXCEPTION 'audit_append: organization mismatch' USING ERRCODE = '42501';
  END IF;
  IF abs(extract(epoch FROM (clock_timestamp() - p_occurred_at))) > 30 THEN
    RAISE EXCEPTION 'audit_append: occurred_at must be the current time' USING ERRCODE = '22007';
  END IF;
  expected := jsonb_build_object(
    'occurredAt', to_char(p_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'actorType', p_actor_type, 'actorUserId', p_actor_user_id, 'orgId', p_org_id, 'action', p_action,
    'targetType', p_target_type, 'targetId', p_target_id, 'reason', p_reason,
    'before', p_before, 'after', p_after, 'metadata', p_metadata);
  IF p_canonical::jsonb IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'audit_append: canonical content does not match the row' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(727275);
  SELECT hash INTO prev FROM audit_log ORDER BY id DESC LIMIT 1;
  INSERT INTO audit_log (occurred_at, actor_type, actor_user_id, org_id, action, target_type, target_id,
                         reason, ip, user_agent, before, after, metadata, prev_hash, hash)
  VALUES (p_occurred_at, p_actor_type, p_actor_user_id, p_org_id, p_action, p_target_type, p_target_id,
          p_reason, p_ip, p_user_agent, p_before, p_after, p_metadata, prev,
          sha256(coalesce(prev, ''::bytea) || convert_to(p_canonical, 'UTF8')));
END $$;
