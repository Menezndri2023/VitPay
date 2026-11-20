-- VITPAY — 003 : grand livre à double entrée (ledger miroir, modèle A)
-- Invariants garantis PAR LA BASE (pas seulement par le code) :
--  1. Chaque écriture a au moins 2 lignes.
--  2. Σ débits = Σ crédits par devise, pour chaque écriture (contrôle différé en fin de transaction).
--  3. La devise d'une ligne = la devise du compte.
--  4. Aucune modification ni suppression (droits révoqués + triggers).

CREATE TABLE ledger_accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id),
  code        text NOT NULL,
  type        text NOT NULL CHECK (type IN ('asset','liability','revenue','expense')),
  currency    char(3) NOT NULL REFERENCES currencies(code),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code, currency)
);

CREATE TABLE journal_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id),
  entry_type        text NOT NULL,
  reference_type    text NOT NULL,
  reference_id      text NOT NULL,
  idempotency_key   text NOT NULL UNIQUE,
  description       text,
  reverses_entry_id uuid REFERENCES journal_entries(id),
  effective_at      timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX journal_entries_ref_idx ON journal_entries (reference_type, reference_id);

CREATE TABLE postings (
  id            bigserial PRIMARY KEY,
  entry_id      uuid NOT NULL REFERENCES journal_entries(id),
  org_id        uuid NOT NULL,
  account_id    uuid NOT NULL REFERENCES ledger_accounts(id),
  direction     text NOT NULL CHECK (direction IN ('debit','credit')),
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
  currency      char(3) NOT NULL REFERENCES currencies(code)
);
CREATE INDEX postings_account_idx ON postings (account_id);
CREATE INDEX postings_entry_idx ON postings (entry_id);

-- Cohérence ligne / compte (devise et organisation).
CREATE FUNCTION ledger_check_posting_account() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE acc record; ent record;
BEGIN
  SELECT currency, org_id INTO acc FROM ledger_accounts WHERE id = NEW.account_id;
  SELECT org_id INTO ent FROM journal_entries WHERE id = NEW.entry_id;
  IF acc.currency <> NEW.currency THEN
    RAISE EXCEPTION 'LEDGER_CURRENCY_MISMATCH: posting % vs account %', NEW.currency, acc.currency;
  END IF;
  IF acc.org_id <> NEW.org_id OR ent.org_id <> NEW.org_id THEN
    RAISE EXCEPTION 'LEDGER_ORG_MISMATCH';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER postings_account_check BEFORE INSERT ON postings
  FOR EACH ROW EXECUTE FUNCTION ledger_check_posting_account();

-- Équilibre : vérifié en fin de transaction (DEFERRABLE INITIALLY DEFERRED).
CREATE FUNCTION ledger_assert_entry_balanced(v_entry uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_count int; v_unbalanced int;
BEGIN
  SELECT count(*) INTO v_count FROM postings WHERE entry_id = v_entry;
  IF v_count < 2 THEN
    RAISE EXCEPTION 'LEDGER_ENTRY_TOO_FEW_POSTINGS: entry % has % postings', v_entry, v_count;
  END IF;
  SELECT count(*) INTO v_unbalanced FROM (
    SELECT currency
    FROM postings WHERE entry_id = v_entry
    GROUP BY currency
    HAVING sum(CASE WHEN direction = 'debit' THEN amount_minor ELSE -amount_minor END) <> 0
  ) u;
  IF v_unbalanced > 0 THEN
    RAISE EXCEPTION 'LEDGER_ENTRY_UNBALANCED: entry %', v_entry;
  END IF;
END $$;

CREATE FUNCTION ledger_check_posting_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ledger_assert_entry_balanced(NEW.entry_id);
  RETURN NULL;
END $$;

CREATE FUNCTION ledger_check_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ledger_assert_entry_balanced(NEW.id);
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER postings_balanced AFTER INSERT ON postings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_check_posting_balanced();
CREATE CONSTRAINT TRIGGER journal_entries_balanced AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_check_journal_balanced();

-- Immuabilité (en plus de la révocation des droits) : même le propriétaire ne peut modifier.
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_TABLE: % on % is forbidden', TG_OP, TG_TABLE_NAME;
END $$;
CREATE TRIGGER journal_entries_immutable BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER postings_immutable BEFORE UPDATE OR DELETE ON postings
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
