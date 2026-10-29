-- Additive reward accounting only. Existing score/event tables are unchanged.
CREATE TABLE weekly_reward_policy (
 singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),
 first_round BIGINT NOT NULL,
 created_at BIGINT NOT NULL
);
INSERT INTO weekly_reward_policy VALUES(TRUE,reputation_week((extract(epoch FROM clock_timestamp())*1000)::bigint),(extract(epoch FROM clock_timestamp())*1000)::bigint);
CREATE TABLE weekly_reward_snapshots (
 round_id BIGINT PRIMARY KEY REFERENCES weekly_rounds(round_id),
 captured_at BIGINT NOT NULL, payable_at BIGINT NOT NULL,
 rule_version TEXT NOT NULL DEFAULT 'top10-full-ties-v1'
);
CREATE TABLE weekly_rewards (
 id TEXT PRIMARY KEY, round_id BIGINT NOT NULL REFERENCES weekly_reward_snapshots(round_id),
 member TEXT NOT NULL, nickname TEXT NOT NULL, recipient TEXT,
 final_rank BIGINT NOT NULL CHECK(final_rank BETWEEN 1 AND 10), weekly_units BIGINT NOT NULL,
 units TEXT NOT NULL CHECK(units ~ '^[1-9][0-9]*$'),
 status TEXT NOT NULL DEFAULT 'unpaid' CHECK(status IN('unpaid','pending','paid')),
 tx_hash TEXT UNIQUE, paid_at BIGINT,
 UNIQUE(round_id,member), CHECK((status='paid')=(paid_at IS NOT NULL)),
 CHECK(status<>'paid' OR tx_hash IS NOT NULL)
);
CREATE TABLE weekly_reward_attempts (
 id TEXT PRIMARY KEY, reward_id TEXT NOT NULL REFERENCES weekly_rewards(id),
 admin TEXT NOT NULL, nonce TEXT NOT NULL UNIQUE, start_block TEXT NOT NULL,
 created_at BIGINT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('awaiting_wallet','submitted','failed','paid')),
 tx_hash TEXT UNIQUE, block_hash TEXT, block_number TEXT, checked_at BIGINT
);
-- One unresolved wallet request across the reward wallet, including missing hashes.
CREATE UNIQUE INDEX weekly_reward_wallet_busy ON weekly_reward_attempts((1)) WHERE status IN('awaiting_wallet','submitted');
CREATE FUNCTION protect_weekly_reward_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Reward history is immutable'; END IF;
 IF ROW(NEW.id,NEW.round_id,NEW.member,NEW.nickname,NEW.recipient,NEW.final_rank,NEW.weekly_units,NEW.units) IS DISTINCT FROM ROW(OLD.id,OLD.round_id,OLD.member,OLD.nickname,OLD.recipient,OLD.final_rank,OLD.weekly_units,OLD.units) THEN RAISE EXCEPTION 'Frozen reward terms are immutable'; END IF;
 IF OLD.status='paid' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Paid reward is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER weekly_reward_frozen BEFORE UPDATE OR DELETE ON weekly_rewards FOR EACH ROW EXECUTE FUNCTION protect_weekly_reward_snapshot();
