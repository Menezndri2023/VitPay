-- VITPAY — 015 : décisions produit du 11/11/2026.
--  (1) libération des comptes non vérifiés après 7 jours ;
--  (3) aucune commission VITPAY sur la part remboursée ou perdue en litige (à revoir si des frais
--      de service sont introduits ultérieurement).

-- (3) Part de la commission annulée (remboursements confirmés + litiges perdus), au prorata.
ALTER TABLE payment_attempts ADD COLUMN vitpay_fee_waived_minor bigint NOT NULL DEFAULT 0
  CHECK (vitpay_fee_waived_minor >= 0 AND vitpay_fee_waived_minor <= coalesce(vitpay_fee_minor, 0));

-- Relevés : lignes de débit (commission due) et d'avoir (commission déjà facturée puis annulée).
ALTER TABLE commission_statement_lines ADD COLUMN kind text NOT NULL DEFAULT 'charge' CHECK (kind IN ('charge','credit'));
ALTER TABLE commission_statement_lines DROP CONSTRAINT commission_statement_lines_fee_minor_check;
ALTER TABLE commission_statement_lines ADD CONSTRAINT commission_statement_lines_fee_sign_check
  CHECK ((kind = 'charge' AND fee_minor > 0) OR (kind = 'credit' AND fee_minor < 0));
DROP INDEX commission_lines_attempt_active_uq;
CREATE UNIQUE INDEX commission_lines_attempt_active_uq ON commission_statement_lines (attempt_id) WHERE active AND kind = 'charge';
CREATE INDEX commission_lines_attempt_idx ON commission_statement_lines (attempt_id) WHERE active;

-- Un relevé peut être un avoir (total négatif) si les annulations dépassent les commissions de la période.
ALTER TABLE commission_statements DROP CONSTRAINT commission_statements_fees_minor_check;

-- (1) Comptes libérés : trace minimale, sans l'adresse en clair (empreinte seulement).
ALTER TABLE users ADD COLUMN released_at timestamptz;
