-- Non-security registration metadata; never used for authentication/authorization.
CREATE TABLE account_registration_methods (
 address TEXT PRIMARY KEY REFERENCES accounts(address),
 method TEXT NOT NULL CHECK(method IN ('pelagus','blippay')),
 recorded_at BIGINT NOT NULL
);
