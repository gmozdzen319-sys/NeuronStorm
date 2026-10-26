ALTER TABLE live_talk_rooms ADD COLUMN used_ms BIGINT NOT NULL DEFAULT 0 CHECK(used_ms BETWEEN 0 AND 600000);
ALTER TABLE live_talk_rooms ADD COLUMN meter_at BIGINT;
ALTER TABLE live_talk_rooms ADD COLUMN meter_until BIGINT;
ALTER TABLE live_talk_rooms ADD COLUMN meter_active BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE live_talk_rooms ADD COLUMN idle_since BIGINT;
ALTER TABLE live_talk_rooms ADD COLUMN paused BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE live_talk_rooms ADD COLUMN session_ends_at BIGINT;
-- Preserve already elapsed legacy allowance; never reopen completed conversations.
UPDATE live_talk_rooms SET used_ms=LEAST(600000,GREATEST(0,(extract(epoch from clock_timestamp())*1000)::bigint-started_at)),
 meter_at=(extract(epoch from clock_timestamp())*1000)::bigint,idle_since=(extract(epoch from clock_timestamp())*1000)::bigint,session_ends_at=ends_at;
CREATE TABLE live_talk_sessions (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 question_id TEXT NOT NULL REFERENCES live_talk_rooms(question_id),
 budget_month TEXT NOT NULL, started_at BIGINT NOT NULL, ended_at BIGINT,
 reserved_minutes INT NOT NULL DEFAULT 110 CHECK(reserved_minutes>=0)
);
CREATE UNIQUE INDEX live_talk_open_session ON live_talk_sessions(question_id) WHERE ended_at IS NULL;
INSERT INTO live_talk_sessions(question_id,budget_month,started_at,ended_at,reserved_minutes)
 SELECT question_id,budget_month,started_at,ended_at,reserved_minutes FROM live_talk_rooms;
