-- Additive v2 storage. Does not switch generations, delete v1, or move credentials.
CREATE VIEW passkey_v1_assignments AS SELECT account_id,credential_id,address,key_id,plan,created_at FROM passkey_clone_wallets;
-- Additive only. Legacy accounts, sessions and wallet records are preserved.

CREATE TABLE passkey_clone_wallets_v2 (
 account_id TEXT PRIMARY KEY REFERENCES passkey_accounts(id),
 credential_id TEXT NOT NULL,
 address TEXT NOT NULL UNIQUE CHECK(address ~ '^0x00[0-7][0-9a-f]{37}$'),
 key_id TEXT NOT NULL UNIQUE,
 plan TEXT NOT NULL,
 created_at BIGINT NOT NULL,
 FOREIGN KEY(credential_id,account_id) REFERENCES passkey_credentials(id,account_id)
);
-- Assignment is permanent; activation is independently derived from chain state.
CREATE FUNCTION protect_clone_assignment_v2() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Clone wallet assignments are immutable';
END;
$$;
CREATE TRIGGER immutable_clone_assignment BEFORE UPDATE OR DELETE ON passkey_clone_wallets_v2
 FOR EACH ROW EXECUTE FUNCTION protect_clone_assignment_v2();

CREATE TABLE passkey_native_operations_v2 (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES passkey_clone_wallets_v2(account_id),
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
CREATE UNIQUE INDEX one_pending_native_operation_v2 ON passkey_native_operations_v2(account_id)
 WHERE phase IN ('awaiting_confirmation','verifying','authorized','submitting');

-- No grants are inserted by migration or exposed through a public HTTP route.
-- An operator must separately approve a bounded sponsorship budget.

CREATE TABLE passkey_relayer_intents_v2 (
 operation_id TEXT PRIMARY KEY REFERENCES passkey_native_operations_v2(id),
 relayer TEXT NOT NULL, nonce TEXT NOT NULL, tx_hash TEXT NOT NULL UNIQUE,
 transaction_plan TEXT NOT NULL, grant_id TEXT NOT NULL REFERENCES passkey_relayer_grants(id),
 maximum_fee_wei TEXT NOT NULL, phase TEXT NOT NULL CHECK(phase IN ('submitting','confirmed','failed')),
 UNIQUE(relayer,nonce)
);
CREATE UNIQUE INDEX one_unresolved_relayer_intent_v2 ON passkey_relayer_intents_v2(relayer) WHERE phase='submitting';

CREATE TABLE passkey_clone_approvals_v2 (
 account_id TEXT PRIMARY KEY REFERENCES passkey_clone_wallets_v2(account_id),
 quote TEXT NOT NULL,
 commitment TEXT NOT NULL,
 approved BOOLEAN NOT NULL DEFAULT FALSE,
 expires_at BIGINT NOT NULL,
 phase TEXT NOT NULL DEFAULT 'quoted' CHECK(phase IN ('quoted','preparing','submitting','confirmed','failed','stopped')),
 tx_hash TEXT UNIQUE, receipt TEXT
);
-- Shared lane spans both sends and provisioning. Crashes do not release it.

CREATE TABLE passkey_clone_approval_history_v2 (
 id BIGSERIAL PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES passkey_clone_wallets_v2(account_id),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 evidence TEXT NOT NULL
);
CREATE FUNCTION record_clone_approval_v2() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO passkey_clone_approval_history_v2(account_id,evidence) VALUES(NEW.account_id,row_to_json(NEW)::text);
 RETURN NEW;
END;
$$;
CREATE TRIGGER clone_approval_history AFTER INSERT OR UPDATE ON passkey_clone_approvals_v2
 FOR EACH ROW EXECUTE FUNCTION record_clone_approval_v2();

-- Durable once-per-account attempts. Never reset automatically after a crash.
CREATE TABLE passkey_auto_activations_v2 (
 account_id TEXT PRIMARY KEY REFERENCES passkey_clone_wallets_v2(account_id),
 relayer TEXT NOT NULL,
 grant_id TEXT NOT NULL UNIQUE REFERENCES passkey_relayer_grants(id),
 phase TEXT NOT NULL CHECK(phase IN ('running','confirmed','stopped','ambiguous')),
 created_at BIGINT NOT NULL
);
-- Cross-process serialization, including across Render restarts/deploy overlap.
CREATE UNIQUE INDEX one_auto_activation_per_relayer_v2 ON passkey_auto_activations_v2(relayer)
 WHERE phase IN ('running','ambiguous');

-- Append-only operational evidence. Contains only public IDs, fixed stages and
-- error categories; no assertion, signed transaction or secret key material.
CREATE TABLE passkey_activation_events_v2 (
 id BIGSERIAL PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES passkey_clone_wallets_v2(account_id),
 stage TEXT NOT NULL,
 code TEXT NOT NULL,
 details TEXT NOT NULL DEFAULT '{}',
 created_at BIGINT NOT NULL
);
