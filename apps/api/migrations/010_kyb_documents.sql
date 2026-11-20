-- VITPAY — 010 : justificatifs KYB chiffrés (AES-256-GCM, clé applicative) stockés en base.
-- Choix MVP : en base pour bénéficier des sauvegardes et de la RLS ; migration vers un stockage
-- objet chiffré possible si les volumes l'exigent (ADR à créer à ce moment).

CREATE TABLE kyb_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id),
  kind         text NOT NULL CHECK (kind IN ('rc_extract','ice_certificate','id_document','statutes','bank_details','other')),
  filename     text NOT NULL,
  mime_type    text NOT NULL CHECK (mime_type IN ('application/pdf','image/png','image/jpeg')),
  size_bytes   integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  sha256       text NOT NULL,
  content_enc  bytea NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  review_note  text,
  reviewed_by  uuid REFERENCES users(id),
  reviewed_at  timestamptz,
  uploaded_by  uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kyb_documents_org_idx ON kyb_documents (org_id, created_at DESC);

ALTER TABLE kyb_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kyb_documents
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);

GRANT SELECT, INSERT ON kyb_documents TO vitpay_app;           -- pas de modification par le commerçant
GRANT SELECT, UPDATE ON kyb_documents TO vitpay_system;         -- revue conformité
