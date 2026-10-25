-- No audio, transcripts, access tokens or provider secrets are stored here.
CREATE TABLE live_talk_rooms (
 question_id TEXT PRIMARY KEY REFERENCES questions(id),
 room_name TEXT NOT NULL UNIQUE,
 started_at BIGINT NOT NULL, ends_at BIGINT NOT NULL,
 budget_month TEXT NOT NULL, reserved_minutes INT NOT NULL DEFAULT 110,
 ended_at BIGINT,
 CHECK(ends_at=started_at+600000)
);
CREATE TABLE live_talk_members (
 question_id TEXT NOT NULL REFERENCES live_talk_rooms(question_id),
 address TEXT NOT NULL REFERENCES accounts(address),
 identity TEXT NOT NULL UNIQUE, seen_at BIGINT NOT NULL,
 joined_at BIGINT NOT NULL, left_at BIGINT,
 queued_at BIGINT, field_id BIGINT REFERENCES verification_fields(id),
 PRIMARY KEY(question_id,address)
);
CREATE TABLE live_talk_turns (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 question_id TEXT NOT NULL REFERENCES live_talk_rooms(question_id),
 address TEXT NOT NULL REFERENCES accounts(address),
 message_id BIGINT NOT NULL UNIQUE REFERENCES debate_messages(id),
 started_at BIGINT NOT NULL, ends_at BIGINT NOT NULL, ended_at BIGINT,
 CHECK(ends_at>started_at AND ends_at<=started_at+60000)
);
CREATE UNIQUE INDEX live_talk_one_speaker ON live_talk_turns(question_id) WHERE ended_at IS NULL;
CREATE TABLE live_talk_heard (
 turn_id BIGINT NOT NULL REFERENCES live_talk_turns(id),
 address TEXT NOT NULL REFERENCES accounts(address),
 heard_at BIGINT NOT NULL,
 PRIMARY KEY(turn_id,address)
);
CREATE INDEX live_talk_pending_rooms ON live_talk_rooms(ends_at) WHERE ended_at IS NULL;

-- Existing results stay unchanged. New vote changes become effective after their
-- persisted due time, including reversals/removals. Repeated requests don't redraw it.
ALTER TABLE verification_votes ADD COLUMN effective_value SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE verification_votes ADD COLUMN effective_counted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE verification_votes ADD COLUMN effective_at BIGINT NOT NULL DEFAULT 0;
UPDATE verification_votes SET effective_value=value,effective_counted=counted;
CREATE INDEX verification_pending_due ON verification_votes(effective_at) WHERE effective_at>0;
