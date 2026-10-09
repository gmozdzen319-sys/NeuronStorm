-- Additive only. Legacy accounts, sessions and wallet records are preserved.
CREATE UNIQUE INDEX passkey_credential_identity ON passkey_credentials(id,account_id);
CREATE TABLE passkey_clone_wallets (
 account_id TEXT PRIMARY KEY REFERENCES passkey_accounts(id),
 credential_id TEXT NOT NULL,
 address TEXT NOT NULL UNIQUE CHECK(address ~ '^0x00[0-7][0-9a-f]{37}$'),
 key_id TEXT NOT NULL UNIQUE,
 plan TEXT NOT NULL,
 created_at BIGINT NOT NULL,
 FOREIGN KEY(credential_id,account_id) REFERENCES passkey_credentials(id,account_id)
);
-- Assignment is permanent; activation is independently derived from chain state.
CREATE FUNCTION protect_clone_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Clone wallet assignments are immutable';
END;
$$;
CREATE TRIGGER immutable_clone_assignment BEFORE UPDATE OR DELETE ON passkey_clone_wallets
 FOR EACH ROW EXECUTE FUNCTION protect_clone_assignment();

CREATE TABLE passkey_native_operations (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES passkey_clone_wallets(account_id),
 credential_id TEXT NOT NULL,
 phase TEXT NOT NULL CHECK(phase IN ('awaiting_confirmation','verifying','authorized','submitting','confirmed','failed','stopped')),
 plan TEXT NOT NULL,
 challenge_digest TEXT GENERATED ALWAYS AS ((plan::jsonb->'operation'->>'digest')) STORED NOT NULL UNIQUE,
 assertion TEXT,
 tx_hash TEXT UNIQUE,
 receipt TEXT,
 created_at BIGINT NOT NULL,
 expires_at BIGINT NOT NULL,
 FOREIGN KEY(credential_id,account_id) REFERENCES passkey_credentials(id,account_id)
);
CREATE UNIQUE INDEX one_pending_native_operation ON passkey_native_operations(account_id)
 WHERE phase IN ('awaiting_confirmation','verifying','authorized','submitting');

-- No grants are inserted by migration or exposed through a public HTTP route.
-- An operator must separately approve a bounded sponsorship budget.
CREATE TABLE passkey_relayer_grants (
 id TEXT PRIMARY KEY, relayer TEXT NOT NULL, budget_wei NUMERIC(78,0) NOT NULL CHECK(budget_wei>0),
 reserved_wei NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK(reserved_wei>=0 AND reserved_wei<=budget_wei),
 expires_at BIGINT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE passkey_relayer_intents (
 operation_id TEXT PRIMARY KEY REFERENCES passkey_native_operations(id),
 relayer TEXT NOT NULL, nonce TEXT NOT NULL, tx_hash TEXT NOT NULL UNIQUE,
 transaction_plan TEXT NOT NULL, grant_id TEXT NOT NULL REFERENCES passkey_relayer_grants(id),
 maximum_fee_wei TEXT NOT NULL, phase TEXT NOT NULL CHECK(phase IN ('submitting','confirmed','failed')),
 UNIQUE(relayer,nonce)
);
CREATE UNIQUE INDEX one_unresolved_relayer_intent ON passkey_relayer_intents(relayer) WHERE phase='submitting';

CREATE TABLE passkey_clone_approvals (
 account_id TEXT PRIMARY KEY REFERENCES passkey_clone_wallets(account_id),
 quote TEXT NOT NULL,
 commitment TEXT NOT NULL,
 approved BOOLEAN NOT NULL DEFAULT FALSE,
 expires_at BIGINT NOT NULL,
 phase TEXT NOT NULL DEFAULT 'quoted' CHECK(phase IN ('quoted','preparing','submitting','confirmed','failed','stopped')),
 tx_hash TEXT UNIQUE, receipt TEXT
);
-- Shared lane spans both sends and provisioning. Crashes do not release it.
CREATE TABLE passkey_relayer_lanes (
 relayer TEXT PRIMARY KEY,
 reference TEXT NOT NULL UNIQUE,
 purpose TEXT NOT NULL CHECK(purpose IN ('send','provision'))
);
CREATE TABLE passkey_clone_approval_history (
 id BIGSERIAL PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES passkey_clone_wallets(account_id),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 evidence TEXT NOT NULL
);
CREATE FUNCTION record_clone_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO passkey_clone_approval_history(account_id,evidence) VALUES(NEW.account_id,row_to_json(NEW)::text);
 RETURN NEW;
END;
$$;
CREATE TRIGGER clone_approval_history AFTER INSERT OR UPDATE ON passkey_clone_approvals
 FOR EACH ROW EXECUTE FUNCTION record_clone_approval();
