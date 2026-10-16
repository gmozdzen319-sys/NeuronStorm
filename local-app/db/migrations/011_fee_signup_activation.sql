-- Empty at rollout: only future successful registrations explicitly enroll.
-- No backfill, old-wallet migration or grants are performed by this migration.
CREATE TABLE passkey_fee_signup_queue (
 account_id TEXT PRIMARY KEY REFERENCES passkey_fee_wallets(account_id),
 created_at BIGINT NOT NULL
);
CREATE TABLE passkey_fee_auto_activations (
 account_id TEXT PRIMARY KEY REFERENCES passkey_fee_wallets(account_id),
 relayer TEXT NOT NULL,
 grant_id TEXT NOT NULL UNIQUE REFERENCES passkey_relayer_grants(id),
 phase TEXT NOT NULL CHECK(phase IN ('running','confirmed','stopped','ambiguous')),
 created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX one_fee_auto_activation_per_relayer ON passkey_fee_auto_activations(relayer)
 WHERE phase IN ('running','ambiguous');
CREATE TABLE passkey_fee_activation_events (
 id BIGSERIAL PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES passkey_fee_wallets(account_id),
 stage TEXT NOT NULL,
 code TEXT NOT NULL,
 details TEXT NOT NULL DEFAULT '{}',
 created_at BIGINT NOT NULL
);
