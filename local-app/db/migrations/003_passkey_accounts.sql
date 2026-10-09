-- Additive identity boundary. Existing address-based accounts are untouched.
CREATE TABLE passkey_accounts (
 id TEXT PRIMARY KEY,
 user_handle TEXT UNIQUE NOT NULL,
 created_at BIGINT NOT NULL,
 legal_hash TEXT,
 rp_id TEXT NOT NULL,
 origin TEXT NOT NULL
);
CREATE TABLE passkey_credentials (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES passkey_accounts(id),
 public_key TEXT NOT NULL,
 counter BIGINT NOT NULL CHECK(counter >= 0),
 label TEXT NOT NULL,
 backed_up BOOLEAN NOT NULL,
 created_at BIGINT NOT NULL,
 last_used BIGINT,
 revoked_at BIGINT
);
CREATE INDEX passkey_credential_owner ON passkey_credentials(account_id);
CREATE TABLE passkey_sessions (
 token_hash TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES passkey_accounts(id),
 credential_id TEXT NOT NULL REFERENCES passkey_credentials(id),
 expires BIGINT NOT NULL
);
CREATE TABLE passkey_challenges (
 id TEXT PRIMARY KEY,
 browser_hash TEXT NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN ('register','login')),
 challenge TEXT NOT NULL,
 user_handle TEXT,
 legal_hash TEXT,
 expires BIGINT NOT NULL
);
CREATE INDEX passkey_challenge_expiry ON passkey_challenges(expires);
-- Exactly one provisioning record per identity; never substitute a fake address.
-- No production deployer or transition to a funded wallet is enabled by this release.
CREATE TABLE passkey_wallets (
 account_id TEXT PRIMARY KEY REFERENCES passkey_accounts(id),
 chain_id BIGINT NOT NULL DEFAULT 9 CHECK(chain_id=9),
 status TEXT NOT NULL DEFAULT 'awaiting_review' CHECK(status='awaiting_review')
);
CREATE TABLE passkey_tokens (
 account_id TEXT NOT NULL REFERENCES passkey_accounts(id),
 contract TEXT NOT NULL,
 name TEXT NOT NULL,
 symbol TEXT NOT NULL,
 decimals BIGINT NOT NULL CHECK(decimals BETWEEN 0 AND 36),
 PRIMARY KEY(account_id,contract)
);
