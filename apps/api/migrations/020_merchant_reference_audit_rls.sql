-- VITPAY — 020 (11/11/2026) : référence de commande du commerçant (P5) ; cloisonnement du journal d'audit.

-- [P5] Référence de commande fournie par le commerçant : UNE demande par référence et par
-- organisation, quel que soit son statut (une commande ne peut jamais donner lieu à deux
-- demandes, donc à deux encaissements). Pour un nouvel essai, le commerçant utilise une autre référence.
ALTER TABLE payment_requests ADD COLUMN merchant_reference text
  CHECK (merchant_reference ~ '^[A-Za-z0-9._:/#-]{1,64}$');
CREATE UNIQUE INDEX payment_requests_merchant_ref_uq ON payment_requests (org_id, merchant_reference)
  WHERE merchant_reference IS NOT NULL;

-- [Audit] Le rôle applicatif lisait le journal d'audit de TOUTES les organisations (pas de RLS) :
-- une injection SQL aurait exposé l'activité des autres commerçants. Lecture désormais limitée à
-- l'organisation courante ; la chaîne d'empreintes reste globale grâce à une fonction qui ne
-- renvoie que la dernière empreinte.
CREATE OR REPLACE FUNCTION audit_last_hash() RETURNS bytea
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1 $$;
REVOKE ALL ON FUNCTION audit_last_hash() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit_last_hash() TO vitpay_app, vitpay_system;

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON audit_log FOR SELECT
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
CREATE POLICY tenant_insert ON audit_log FOR INSERT
  WITH CHECK (org_id IS NULL OR org_id = nullif(current_setting('app.org_id', true), '')::uuid);
