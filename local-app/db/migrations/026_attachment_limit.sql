-- Raise attachment storage limit to 10 MiB; existing files and lifecycle stay unchanged.
ALTER TABLE content_files DROP CONSTRAINT content_files_bytes_check;
ALTER TABLE content_files ADD CONSTRAINT content_files_bytes_check CHECK (octet_length(bytes)<=10485760);
