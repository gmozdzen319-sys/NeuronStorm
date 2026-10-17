-- NULL preserves uncertainty for historical intents. Never infer no broadcast
-- from an absent RPC receipt. Only explicit pre-broadcast evidence can release.
ALTER TABLE passkey_relayer_intents ADD COLUMN broadcast_started BOOLEAN;
ALTER TABLE passkey_relayer_intents_v2 ADD COLUMN broadcast_started BOOLEAN;
ALTER TABLE passkey_relayer_intents DROP CONSTRAINT passkey_relayer_intents_relayer_nonce_key;
ALTER TABLE passkey_relayer_intents_v2 DROP CONSTRAINT passkey_relayer_intents_v2_relayer_nonce_key;
CREATE UNIQUE INDEX reserved_send_nonce ON passkey_relayer_intents(relayer,nonce)
 WHERE broadcast_started IS DISTINCT FROM FALSE OR phase <> 'failed';
CREATE UNIQUE INDEX reserved_send_nonce_v2 ON passkey_relayer_intents_v2(relayer,nonce)
 WHERE broadcast_started IS DISTINCT FROM FALSE OR phase <> 'failed';
