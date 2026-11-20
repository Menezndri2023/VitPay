-- VITPAY — 026 : clés API de test et clés réelles (lot 2 de l'intégration SaaS).
-- Une clé de test ne crée et ne lit que des demandes en sandbox ; une clé réelle que des demandes
-- réelles. Les clés existantes (staging, données fictives) deviennent des clés de test.
ALTER TABLE api_keys ADD COLUMN mode text NOT NULL DEFAULT 'test' CHECK (mode IN ('test','live'));
ALTER TABLE api_keys ALTER COLUMN mode DROP DEFAULT;
