-- VITPAY — 016 : corrections de la quatrième revue indépendante (11/11/2026).

-- [R4-C1] Les relevés facturent désormais l'écart (dû − déjà facturé) par paiement : après
-- l'annulation d'un relevé, un paiement peut légitimement porter plusieurs lignes actives
-- (avoir antérieur + nouveau débit). La cohérence est assurée par un verrou consultatif par
-- organisation, devise et mode pendant l'émission ([R4-P1]) et par l'écart nul en réémission.
DROP INDEX commission_lines_attempt_active_uq;
