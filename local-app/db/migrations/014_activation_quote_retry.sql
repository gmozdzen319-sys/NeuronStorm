-- Only newly classified, proven pre-approval failures enter this state.
-- Existing stopped/ambiguous attempts are deliberately not changed.
ALTER TABLE passkey_fee_auto_activations DROP CONSTRAINT passkey_fee_auto_activations_phase_check;
ALTER TABLE passkey_fee_auto_activations ADD CHECK (phase IN ('running','confirmed','stopped','ambiguous','quote_retry_wait'));
CREATE TABLE passkey_fee_quote_retries (
 account_id TEXT PRIMARY KEY REFERENCES passkey_fee_auto_activations(account_id),
 failures INTEGER NOT NULL CHECK(failures BETWEEN 1 AND 3),
 first_failure_at BIGINT NOT NULL,
 next_attempt_at BIGINT NOT NULL
);
