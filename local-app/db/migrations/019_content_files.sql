-- Durable binary storage: no dependency on Render's ephemeral filesystem.
CREATE TABLE content_files (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES accounts(address),
 name TEXT NOT NULL, mime TEXT NOT NULL, digest TEXT NOT NULL,
 bytes BYTEA NOT NULL CHECK(octet_length(bytes)<=5242880), created_at BIGINT NOT NULL
);
CREATE TABLE content_file_links (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 file_id TEXT NOT NULL REFERENCES content_files(id),
 question_id TEXT REFERENCES questions(id) ON DELETE CASCADE,
 reply_id BIGINT REFERENCES replies(id) ON DELETE CASCADE,
 action_id TEXT REFERENCES signed_actions(id) ON DELETE CASCADE,
 avatar_owner TEXT REFERENCES profiles(address) ON DELETE CASCADE,
 saved_owner TEXT, saved_reply BIGINT,
 archive_id BIGINT REFERENCES conversation_archive(id) ON DELETE CASCADE,
 accepted_id TEXT REFERENCES accepted_answers(question_id) ON DELETE CASCADE,
 FOREIGN KEY(saved_owner,saved_reply) REFERENCES saved_answers(owner,reply_id) ON DELETE CASCADE,
 CHECK((saved_owner IS NULL)=(saved_reply IS NULL)),
 CHECK(num_nonnulls(question_id,reply_id,action_id,avatar_owner,saved_owner,archive_id,accepted_id)=1)
);
CREATE INDEX content_file_refs ON content_file_links(file_id);
CREATE UNIQUE INDEX one_question_file ON content_file_links(question_id) WHERE question_id IS NOT NULL;
CREATE UNIQUE INDEX one_reply_file ON content_file_links(reply_id) WHERE reply_id IS NOT NULL;
CREATE UNIQUE INDEX one_action_file ON content_file_links(action_id) WHERE action_id IS NOT NULL;
CREATE UNIQUE INDEX one_avatar ON content_file_links(avatar_owner) WHERE avatar_owner IS NOT NULL;
CREATE UNIQUE INDEX one_archive_file ON content_file_links(archive_id) WHERE archive_id IS NOT NULL;
CREATE UNIQUE INDEX saved_file_copy ON content_file_links(saved_owner,saved_reply,file_id) WHERE saved_owner IS NOT NULL;
CREATE UNIQUE INDEX accepted_file_copy ON content_file_links(accepted_id,file_id) WHERE accepted_id IS NOT NULL;
CREATE FUNCTION delete_unreferenced_content_file() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 DELETE FROM content_files f WHERE f.id=OLD.file_id AND NOT EXISTS(SELECT 1 FROM content_file_links l WHERE l.file_id=f.id);
 RETURN OLD;
END $$;
CREATE TRIGGER content_file_gc AFTER DELETE ON content_file_links FOR EACH ROW EXECUTE FUNCTION delete_unreferenced_content_file();
-- Saved/accepted/archive copies keep exactly the same immutable file. No new TTL.
CREATE FUNCTION copy_content_file_reference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='saved_answers' THEN
  INSERT INTO content_file_links(file_id,saved_owner,saved_reply)
   SELECT file_id,NEW.owner,NEW.reply_id FROM content_file_links WHERE reply_id=NEW.reply_id OR question_id=NEW.question_id ON CONFLICT DO NOTHING;
 ELSIF TG_TABLE_NAME='accepted_answers' THEN
  INSERT INTO content_file_links(file_id,accepted_id)
   SELECT file_id,NEW.question_id FROM content_file_links WHERE reply_id=NEW.reply_id OR question_id=NEW.question_id ON CONFLICT DO NOTHING;
 ELSE
  INSERT INTO content_file_links(file_id,archive_id)
   SELECT file_id,NEW.id FROM content_file_links WHERE (NEW.reply_id IS NULL AND question_id=NEW.question_id) OR reply_id=NEW.reply_id ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER saved_file_snapshot AFTER INSERT OR UPDATE ON saved_answers FOR EACH ROW EXECUTE FUNCTION copy_content_file_reference();
CREATE TRIGGER accepted_file_snapshot AFTER INSERT ON accepted_answers FOR EACH ROW EXECUTE FUNCTION copy_content_file_reference();
CREATE TRIGGER archive_file_snapshot AFTER INSERT ON conversation_archive FOR EACH ROW EXECUTE FUNCTION copy_content_file_reference();
