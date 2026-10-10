-- Append-only operational evidence. Contains only public IDs, fixed stages and
-- error categories; no assertion, signed transaction or secret key material.
CREATE TABLE passkey_activation_events (
 id BIGSERIAL PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES passkey_clone_wallets(account_id),
 stage TEXT NOT NULL,
 code TEXT NOT NULL,
 details TEXT NOT NULL DEFAULT '{}',
 created_at BIGINT NOT NULL
);
