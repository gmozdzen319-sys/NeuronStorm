CREATE TABLE desktop_chat_messages(
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 author TEXT NOT NULL REFERENCES profiles(address) ON DELETE CASCADE,
 request_id UUID NOT NULL,
 body TEXT NOT NULL CHECK(char_length(body) BETWEEN 1 AND 1000),
 created_at BIGINT NOT NULL,
 UNIQUE(author,request_id)
);
