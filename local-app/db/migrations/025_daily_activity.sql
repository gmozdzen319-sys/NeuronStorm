-- Independent activity ledger: one point per authenticated account and UTC day.
CREATE TABLE daily_login_activity (
 address TEXT NOT NULL REFERENCES accounts(address),
 day_utc DATE NOT NULL,
 awarded_at BIGINT NOT NULL,
 PRIMARY KEY(address,day_utc)
);
