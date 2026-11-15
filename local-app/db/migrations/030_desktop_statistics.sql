CREATE TABLE desktop_app_presence (
 instance TEXT PRIMARY KEY, account_id TEXT, mining BOOLEAN NOT NULL, seen_at BIGINT NOT NULL
);
CREATE INDEX desktop_app_presence_seen ON desktop_app_presence(seen_at);
CREATE TABLE desktop_download_count (id INTEGER PRIMARY KEY CHECK(id=1), total BIGINT NOT NULL DEFAULT 0);
INSERT INTO desktop_download_count(id) VALUES(1);
