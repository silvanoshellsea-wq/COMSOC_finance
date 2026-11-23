CREATE TABLE event_history (
  id INTEGER PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  previous_values TEXT NOT NULL,
  new_values TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE review_decisions (
  id INTEGER PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'verified', 'flagged')),
  notes TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

INSERT INTO review_decisions SELECT * FROM transaction_reviews;
DROP TABLE transaction_reviews;
ALTER TABLE review_decisions RENAME TO transaction_reviews;
CREATE INDEX reviews_transaction ON transaction_reviews(transaction_id, id DESC);
