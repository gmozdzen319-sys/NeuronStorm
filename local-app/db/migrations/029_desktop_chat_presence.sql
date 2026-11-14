CREATE TABLE desktop_chat_presence (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 session_hash TEXT UNIQUE NOT NULL REFERENCES passkey_sessions(token_hash) ON DELETE CASCADE,
 member TEXT NOT NULL REFERENCES profiles(address) ON DELETE CASCADE,
 seen_at BIGINT NOT NULL
);
CREATE INDEX desktop_chat_recent_presence ON desktop_chat_presence(seen_at);
