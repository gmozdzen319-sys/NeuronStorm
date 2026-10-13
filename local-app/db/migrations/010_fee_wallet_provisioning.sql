-- Independent v3 approvals; a successful or unresolved v2 approval never
-- authorizes a new wallet. No grants, assignments or paid work are inserted.
CREATE TABLE passkey_fee_approvals (
 account_id TEXT PRIMARY KEY REFERENCES passkey_fee_wallets(account_id),
 quote TEXT NOT NULL,
 commitment TEXT NOT NULL,
 approved BOOLEAN NOT NULL DEFAULT FALSE,
 expires_at BIGINT NOT NULL,
 phase TEXT NOT NULL DEFAULT 'quoted' CHECK(phase IN ('quoted','preparing','submitting','confirmed','failed','stopped')),
 tx_hash TEXT UNIQUE, receipt TEXT
);
CREATE TABLE passkey_fee_approval_history (
 id BIGSERIAL PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES passkey_fee_wallets(account_id),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 evidence TEXT NOT NULL
);
CREATE FUNCTION record_fee_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO passkey_fee_approval_history(account_id,evidence) VALUES(NEW.account_id,row_to_json(NEW)::text);
 RETURN NEW;
END;
$$;
CREATE TRIGGER fee_approval_history AFTER INSERT OR UPDATE ON passkey_fee_approvals
 FOR EACH ROW EXECUTE FUNCTION record_fee_approval();
