CREATE TABLE accounts (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL
) STRICT;

INSERT INTO accounts (id, name) VALUES
  ('cash', 'Cash'),
  ('gcash', 'GCash');
