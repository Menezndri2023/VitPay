-- VITPAY — 021 : corrections de la septième revue (11/11/2026).
-- [R7-5] Référence de commande : unicité insensible à la casse (CMD-1 = cmd-1) et préfixe VITPAY
-- réservé (« VP- » : confusion avec les références des demandes).
DROP INDEX payment_requests_merchant_ref_uq;
CREATE UNIQUE INDEX payment_requests_merchant_ref_uq ON payment_requests (org_id, lower(merchant_reference))
  WHERE merchant_reference IS NOT NULL;
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_merchant_ref_not_vp
  CHECK (merchant_reference IS NULL OR merchant_reference !~* '^VP-');
