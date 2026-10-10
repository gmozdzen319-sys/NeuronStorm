-- Durable once-per-account attempts. Never reset automatically after a crash.
CREATE TABLE passkey_auto_activations (
 account_id TEXT PRIMARY KEY REFERENCES passkey_clone_wallets(account_id),
 relayer TEXT NOT NULL,
 grant_id TEXT NOT NULL UNIQUE REFERENCES passkey_relayer_grants(id),
 phase TEXT NOT NULL CHECK(phase IN ('running','confirmed','stopped','ambiguous')),
 created_at BIGINT NOT NULL
);
-- Cross-process serialization, including across Render restarts/deploy overlap.
CREATE UNIQUE INDEX one_auto_activation_per_relayer ON passkey_auto_activations(relayer)
 WHERE phase IN ('running','ambiguous');
