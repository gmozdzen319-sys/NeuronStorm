-- Forward-only opt-in, inserted only by new registrations. No backfill.
-- Community addresses remain immutable identity keys, not payment destinations.
CREATE TABLE passkey_current_wallet_accounts (
 account_id TEXT PRIMARY KEY REFERENCES passkey_accounts(id),
 created_at BIGINT NOT NULL
);
CREATE TRIGGER immutable_current_wallet_account BEFORE UPDATE OR DELETE ON passkey_current_wallet_accounts
 FOR EACH ROW EXECUTE FUNCTION protect_clone_assignment();

-- For opted-in accounts, the stored content author identity can only resolve
-- to its original account. Existing community rows are neither scanned nor changed.
CREATE FUNCTION protect_current_community_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM passkey_current_wallet_accounts WHERE account_id=OLD.account_id)
 THEN RAISE EXCEPTION 'Current wallet community identity is immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_current_community_identity BEFORE UPDATE OR DELETE ON passkey_community_accounts
 FOR EACH ROW EXECUTE FUNCTION protect_current_community_identity();
