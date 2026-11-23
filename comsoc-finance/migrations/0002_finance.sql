CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('treasurer', 'auditor')),
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL
) STRICT;

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX sessions_expiration ON sessions(expires_at);

CREATE TABLE events (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  academic_year TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL CHECK (ends_on >= starts_on),
  created_by TEXT NOT NULL REFERENCES users(id)
) STRICT;

CREATE TABLE allocations (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id),
  category TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX allocations_event ON allocations(event_id, category);

CREATE TABLE obligations (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT REFERENCES events(id),
  kind TEXT NOT NULL CHECK (kind IN ('payment', 'reimbursement')),
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  counterparty TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE transactions (
  id TEXT PRIMARY KEY NOT NULL,
  occurred_on TEXT NOT NULL,
  description TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'transfer', 'payment', 'reimbursement', 'loan_received', 'loan_issued', 'loan_repayment_received', 'loan_repayment_paid', 'adjustment')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  source_account TEXT REFERENCES accounts(id),
  destination_account TEXT REFERENCES accounts(id),
  event_id TEXT REFERENCES events(id),
  obligation_id TEXT REFERENCES obligations(id),
  category TEXT NOT NULL,
  notes TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (source_account IS NOT NULL OR destination_account IS NOT NULL),
  CHECK (source_account IS NULL OR destination_account IS NULL OR source_account <> destination_account),
  CHECK (
    (kind = 'transfer' AND source_account IS NOT NULL AND destination_account IS NOT NULL)
    OR (kind IN ('income', 'loan_received', 'loan_repayment_received') AND source_account IS NULL AND destination_account IS NOT NULL)
    OR (kind IN ('expense', 'payment', 'reimbursement', 'loan_issued', 'loan_repayment_paid') AND source_account IS NOT NULL AND destination_account IS NULL)
    OR (kind = 'adjustment' AND (source_account IS NULL OR destination_account IS NULL))
  ),
  CHECK ((kind IN ('payment', 'reimbursement')) = (obligation_id IS NOT NULL)),
  CHECK (kind <> 'adjustment' OR length(trim(notes)) > 0)
) STRICT;
CREATE INDEX transactions_date ON transactions(occurred_on);
CREATE INDEX transactions_event ON transactions(event_id, category);
CREATE INDEX transactions_obligation ON transactions(obligation_id);

CREATE TRIGGER limit_obligation_payment
BEFORE INSERT ON transactions
WHEN NEW.obligation_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM obligations o WHERE o.id = NEW.obligation_id
      AND o.kind = NEW.kind AND o.event_id IS NEW.event_id AND o.category = NEW.category
      AND NEW.amount <= o.amount - COALESCE(
        (SELECT SUM(t.amount) FROM transactions t WHERE t.obligation_id = o.id), 0
      )
  ) THEN RAISE(ABORT, 'Invalid settlement or amount exceeds outstanding obligation') END;
END;

CREATE VIEW account_movements AS
SELECT id AS transaction_id, occurred_on, source_account AS account_id, -amount AS amount
FROM transactions WHERE source_account IS NOT NULL
UNION ALL
SELECT id, occurred_on, destination_account, amount
FROM transactions WHERE destination_account IS NOT NULL;

CREATE VIEW obligation_balances AS
SELECT o.*, COALESCE(s.paid, 0) AS paid, o.amount - COALESCE(s.paid, 0) AS outstanding
FROM obligations o LEFT JOIN (
  SELECT obligation_id, SUM(amount) AS paid FROM transactions
  WHERE obligation_id IS NOT NULL GROUP BY obligation_id
) s ON s.obligation_id = o.id;

CREATE TABLE transaction_reviews (
  id INTEGER PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  status TEXT NOT NULL CHECK (status IN ('verified', 'flagged')),
  notes TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX reviews_transaction ON transaction_reviews(transaction_id, id DESC);

CREATE TABLE reconciliations (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  counted_on TEXT NOT NULL,
  expected INTEGER NOT NULL,
  actual INTEGER NOT NULL CHECK (actual >= 0),
  notes TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE receipts (
  id TEXT PRIMARY KEY NOT NULL,
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX receipts_transaction ON receipts(transaction_id);

CREATE TABLE allocation_transfers (
  id TEXT PRIMARY KEY NOT NULL,
  source_event TEXT NOT NULL REFERENCES events(id),
  destination_event TEXT NOT NULL REFERENCES events(id),
  category TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (source_event <> destination_event)
) STRICT;

CREATE VIEW event_finances AS
WITH movements AS (
  SELECT event_id, amount AS allocated, 0 AS paid, 0 AS outstanding FROM allocations
  UNION ALL SELECT source_event, -amount, 0, 0 FROM allocation_transfers
  UNION ALL SELECT destination_event, amount, 0, 0 FROM allocation_transfers
  UNION ALL SELECT event_id, 0, amount, 0 FROM transactions
    WHERE kind IN ('expense', 'payment', 'reimbursement') AND event_id IS NOT NULL
  UNION ALL SELECT event_id, 0, 0, outstanding FROM obligation_balances WHERE event_id IS NOT NULL
), totals AS (
  SELECT event_id, SUM(allocated) AS allocated, SUM(paid) AS paid, SUM(outstanding) AS outstanding
  FROM movements GROUP BY event_id
)
SELECT e.*, COALESCE(t.allocated, 0) AS allocated, COALESCE(t.paid, 0) AS paid,
  COALESCE(t.outstanding, 0) AS outstanding,
  COALESCE(t.allocated - t.paid - t.outstanding, 0) AS available
FROM events e LEFT JOIN totals t ON t.event_id = e.id;
