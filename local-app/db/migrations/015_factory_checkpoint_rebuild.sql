-- Rebuild progress is separate from the active checkpoint and its evidence.
CREATE TABLE passkey_factory_rebuilds (
 identity TEXT PRIMARY KEY,
 source_checkpoint TEXT NOT NULL,
 checkpoint TEXT NOT NULL
);
CREATE TABLE passkey_factory_checkpoint_history (
 id BIGSERIAL PRIMARY KEY,
 identity TEXT NOT NULL,
 checkpoint TEXT NOT NULL,
 replacement_hash TEXT NOT NULL,
 created_at BIGINT NOT NULL
);
