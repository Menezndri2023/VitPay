-- VITPAY — 006 : corrections issues de la revue indépendante finance/sécurité (10/11/2026)

-- [R6] Le contrôle ligne/compte s'exécutait sous RLS : un compte d'une autre organisation était
-- invisible, la comparaison donnait NULL et le contrôle était ignoré. SECURITY DEFINER + NOT FOUND.
CREATE OR REPLACE FUNCTION ledger_check_posting_account() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE acc record; ent record;
BEGIN
  SELECT currency, org_id INTO acc FROM ledger_accounts WHERE id = NEW.account_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEDGER_ACCOUNT_NOT_FOUND'; END IF;
  SELECT org_id INTO ent FROM journal_entries WHERE id = NEW.entry_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEDGER_ENTRY_NOT_FOUND'; END IF;
  IF acc.currency IS DISTINCT FROM NEW.currency THEN
    RAISE EXCEPTION 'LEDGER_CURRENCY_MISMATCH: posting % vs account %', NEW.currency, acc.currency;
  END IF;
  IF acc.org_id IS DISTINCT FROM NEW.org_id OR ent.org_id IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION 'LEDGER_ORG_MISMATCH';
  END IF;
  RETURN NEW;
END $$;

-- Le contrôle d'équilibre doit voir toutes les lignes de l'écriture, indépendamment de la RLS.
ALTER FUNCTION ledger_assert_entry_balanced(uuid) SECURITY DEFINER SET search_path = public, pg_temp;

-- [H] Unicités scopées : une référence prestataire n'est unique que par compte marchand,
-- une clé d'idempotence comptable par organisation (pas de collision ni de fuite inter-tenant).
ALTER TABLE payment_attempts DROP CONSTRAINT payment_attempts_provider_code_provider_ref_key;
CREATE UNIQUE INDEX payment_attempts_account_ref_uq ON payment_attempts (provider_account_id, provider_ref);
ALTER TABLE journal_entries DROP CONSTRAINT journal_entries_idempotency_key_key;
CREATE UNIQUE INDEX journal_entries_org_idem_uq ON journal_entries (org_id, idempotency_key);

-- [H] Synchronisation prestataire : horodatage dédié (limite les appels déclenchés par la page publique).
ALTER TABLE payment_attempts ADD COLUMN last_synced_at timestamptz;

-- [R3] MFA : anti-rejeu (dernier pas TOTP accepté) et compteur d'échecs par session.
ALTER TABLE users ADD COLUMN mfa_last_step bigint;
ALTER TABLE sessions ADD COLUMN mfa_failures integer NOT NULL DEFAULT 0;

-- [R4] Enrôlement MFA admin par jeton d'invitation à usage unique (hors bande).
ALTER TABLE users ADD COLUMN mfa_enroll_token_hash bytea;
ALTER TABLE users ADD COLUMN mfa_enroll_expires_at timestamptz;
