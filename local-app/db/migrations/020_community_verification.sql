-- Independent community verification. No changes to reputation or rewards.
CREATE TABLE verification_fields (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 normalized_name TEXT NOT NULL UNIQUE, name TEXT NOT NULL
);
INSERT INTO verification_fields(normalized_name,name)
 SELECT normalized_name,min(name) FROM categories GROUP BY normalized_name;
CREATE TABLE verification_memberships (
 address TEXT NOT NULL REFERENCES accounts(address),
 field_id BIGINT NOT NULL REFERENCES verification_fields(id),
 first_seen BIGINT NOT NULL, date_source TEXT NOT NULL CHECK(date_source IN('registered','migration_observation')),
 achieved_at BIGINT, PRIMARY KEY(address,field_id)
);
-- Historical field-addition timestamps were never recorded. Do not invent them.
INSERT INTO verification_memberships(address,field_id,first_seen,date_source)
 SELECT DISTINCT pc.address,f.id,(extract(epoch FROM transaction_timestamp())*1000)::bigint,'migration_observation'
 FROM profile_categories pc JOIN categories c ON c.id=pc.category_id JOIN verification_fields f USING(normalized_name);
CREATE TABLE verification_contributions (
 message_id BIGINT PRIMARY KEY REFERENCES debate_messages(id),
 field_id BIGINT REFERENCES verification_fields(id),
 kind TEXT NOT NULL CHECK(kind IN('field','follow_up')),
 CHECK((kind='field' AND field_id IS NOT NULL) OR (kind='follow_up' AND field_id IS NULL))
);
CREATE TABLE verification_votes (
 message_id BIGINT NOT NULL REFERENCES debate_messages(id), voter TEXT NOT NULL REFERENCES accounts(address),
 recipient TEXT NOT NULL REFERENCES accounts(address), field_id BIGINT NOT NULL REFERENCES verification_fields(id),
 value SMALLINT NOT NULL CHECK(value IN(-1,0,1)), counted BOOLEAN NOT NULL,
 cast_at BIGINT NOT NULL, PRIMARY KEY(message_id,voter), CHECK(voter<>recipient)
);
CREATE INDEX verification_recipient ON verification_votes(recipient,field_id);
CREATE TABLE verification_events (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 message_id BIGINT NOT NULL, question_id TEXT NOT NULL, voter TEXT NOT NULL, recipient TEXT NOT NULL,
 field_id BIGINT NOT NULL REFERENCES verification_fields(id),
 previous_value SMALLINT NOT NULL, value SMALLINT NOT NULL,
 previous_counted BOOLEAN NOT NULL, counted BOOLEAN NOT NULL,
 reason TEXT NOT NULL CHECK(reason IN('eligible','waiting','recipient_inactive','removed')),
 occurred_at BIGINT NOT NULL
);
CREATE INDEX verification_history ON verification_events(recipient,field_id,id);
CREATE FUNCTION immutable_verification_history() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'Verification history is append-only'; END
$$;
CREATE TRIGGER protect_verification_events BEFORE UPDATE OR DELETE ON verification_events FOR EACH ROW EXECUTE FUNCTION immutable_verification_history();
