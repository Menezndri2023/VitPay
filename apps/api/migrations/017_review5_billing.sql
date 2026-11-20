-- VITPAY — 017 : corrections de la cinquième revue indépendante (11/11/2026).

-- [R5-7] Relevés négatifs émis avant le report des avoirs (environnements de test uniquement) :
-- annulés pour que leur avoir redevienne en attente et s'impute sur le prochain relevé positif.
UPDATE commission_statement_lines SET active = false
 WHERE statement_id IN (SELECT id FROM commission_statements WHERE status = 'issued' AND fees_minor < 0);
UPDATE commission_statements SET status = 'void', voided_at = now(),
       void_reason = 'Avoir reporté sur le prochain relevé (migration 017)'
 WHERE status = 'issued' AND fees_minor < 0;
