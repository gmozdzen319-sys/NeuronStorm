-- Separate immutable assignment; never replaces or deletes a funded v2 wallet.
-- No provisioning, budget grant, preferred-wallet switch or paid action here.
CREATE TABLE passkey_fee_wallets (
 account_id TEXT PRIMARY KEY REFERENCES passkey_accounts(id),
 credential_id TEXT NOT NULL,
 address TEXT NOT NULL UNIQUE CHECK(address ~ '^0x00[0-7][0-9a-f]{37}$'),
 key_id TEXT NOT NULL UNIQUE,
 plan TEXT NOT NULL,
 created_at BIGINT NOT NULL,
 FOREIGN KEY(credential_id,account_id) REFERENCES passkey_credentials(id,account_id)
);
CREATE TRIGGER immutable_fee_wallet_assignment BEFORE UPDATE OR DELETE ON passkey_fee_wallets
 FOR EACH ROW EXECUTE FUNCTION protect_clone_assignment();
