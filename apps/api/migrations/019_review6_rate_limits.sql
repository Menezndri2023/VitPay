-- VITPAY — 019 : corrections de la sixième revue indépendante (limitation de débit, 11/11/2026).

-- [R6-6] Plus d'accès direct à la table pour le rôle applicatif (lecture des compteurs = IP des
-- clients, écriture = remise à zéro ou blocage arbitraire). Une seule fonction, à l'usage borné.
REVOKE ALL ON rate_limits FROM vitpay_app;

-- [R6-5] Fenêtre fixe ; à la fin d'un blocage, le compteur repart de zéro (comme le stockage par défaut).
CREATE OR REPLACE FUNCTION rate_limit_hit(p_key text, p_ttl_ms integer, p_limit integer, p_block_ms integer)
RETURNS TABLE (hits integer, expires_ms bigint, blocked_ms bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r rate_limits%ROWTYPE;
BEGIN
  IF length(p_key) > 128 OR p_ttl_ms <= 0 OR p_ttl_ms > 86400000 OR p_limit <= 0 OR p_block_ms < 0 OR p_block_ms > 86400000 THEN
    RAISE EXCEPTION 'rate_limit_hit: invalid arguments';
  END IF;
  INSERT INTO rate_limits AS t (key, hits, expires_at, blocked_until)
  VALUES (p_key, 1, now() + make_interval(secs => p_ttl_ms / 1000.0),
          CASE WHEN 1 > p_limit AND p_block_ms > 0 THEN now() + make_interval(secs => p_block_ms / 1000.0) END)
  ON CONFLICT (key) DO UPDATE SET
    hits = CASE WHEN t.expires_at <= now() OR t.blocked_until <= now() THEN 1 ELSE t.hits + 1 END,
    expires_at = CASE WHEN t.expires_at <= now() OR t.blocked_until <= now() THEN now() + make_interval(secs => p_ttl_ms / 1000.0) ELSE t.expires_at END,
    blocked_until = CASE
      WHEN t.blocked_until > now() THEN t.blocked_until
      WHEN p_block_ms > 0 AND (CASE WHEN t.expires_at <= now() OR t.blocked_until <= now() THEN 1 ELSE t.hits + 1 END) > p_limit
        THEN now() + make_interval(secs => p_block_ms / 1000.0)
      ELSE NULL END
  RETURNING t.* INTO r;
  hits := r.hits;
  expires_ms := GREATEST(0, (EXTRACT(EPOCH FROM (r.expires_at - now())) * 1000)::bigint);
  blocked_ms := CASE WHEN r.blocked_until > now() THEN (EXTRACT(EPOCH FROM (r.blocked_until - now())) * 1000)::bigint END;
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION rate_limit_hit(text, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_limit_hit(text, integer, integer, integer) TO vitpay_app;
