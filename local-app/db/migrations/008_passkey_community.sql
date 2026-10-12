-- Permanent community identity, independent of activation progress or future wallets.
CREATE TABLE passkey_community_accounts (
 account_id TEXT PRIMARY KEY REFERENCES passkey_accounts(id),
 address TEXT NOT NULL UNIQUE REFERENCES accounts(address)
);
