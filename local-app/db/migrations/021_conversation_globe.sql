-- Country sharing for named, persistent conversation markers is a new opt-in.
-- Never expand the old anonymous/live-only consent automatically.
CREATE TABLE globe_connection_preferences (
 address TEXT PRIMARY KEY REFERENCES accounts(address), enabled BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE globe_conversation_members (
 question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
 address TEXT NOT NULL REFERENCES accounts(address), country TEXT CHECK(country ~ '^[A-Z]{2}$'),
 first_seen BIGINT NOT NULL, PRIMARY KEY(question_id,address)
);
CREATE TABLE globe_conversation_presence (
 question_id TEXT NOT NULL, address TEXT NOT NULL, session_hash TEXT NOT NULL, seen BIGINT NOT NULL,
 PRIMARY KEY(question_id,address,session_hash),
 FOREIGN KEY(question_id,address) REFERENCES globe_conversation_members(question_id,address) ON DELETE CASCADE
);
CREATE INDEX globe_conversation_presence_expiry ON globe_conversation_presence(seen);
