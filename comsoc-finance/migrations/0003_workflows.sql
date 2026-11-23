CREATE TABLE purchases (
  id TEXT PRIMARY KEY NOT NULL,
  vendor TEXT NOT NULL,
  purchased_on TEXT NOT NULL,
  transaction_id TEXT UNIQUE REFERENCES transactions(id),
  obligation_id TEXT UNIQUE REFERENCES obligations(id),
  CHECK ((transaction_id IS NULL) <> (obligation_id IS NULL))
) STRICT;

CREATE TABLE purchase_items (
  purchase_id TEXT NOT NULL REFERENCES purchases(id),
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price > 0),
  PRIMARY KEY (purchase_id, position)
) STRICT;

CREATE TABLE loans (
  id TEXT PRIMARY KEY NOT NULL,
  transaction_id TEXT NOT NULL UNIQUE REFERENCES transactions(id),
  counterparty TEXT NOT NULL
) STRICT;

CREATE TABLE loan_repayments (
  loan_id TEXT NOT NULL REFERENCES loans(id),
  transaction_id TEXT PRIMARY KEY NOT NULL REFERENCES transactions(id)
) STRICT;
CREATE INDEX loan_repayments_loan ON loan_repayments(loan_id);

CREATE VIEW loan_balances AS
SELECT l.*, t.description, t.occurred_on, t.kind, t.amount,
  COALESCE((SELECT SUM(payment.amount) FROM loan_repayments r
    JOIN transactions payment ON payment.id = r.transaction_id WHERE r.loan_id = l.id), 0) AS repaid
FROM loans l JOIN transactions t ON t.id = l.transaction_id;

CREATE TRIGGER limit_loan_repayment BEFORE INSERT ON loan_repayments
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM loan_balances l JOIN transactions payment ON payment.id = NEW.transaction_id
    WHERE l.id = NEW.loan_id AND payment.amount <= l.amount - l.repaid
      AND ((l.kind = 'loan_received' AND payment.kind = 'loan_repayment_paid')
        OR (l.kind = 'loan_issued' AND payment.kind = 'loan_repayment_received'))
  ) THEN RAISE(ABORT, 'Repayment exceeds available loan balance') END;
END;

CREATE TABLE receipt_status_history (
  id INTEGER PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  status TEXT NOT NULL CHECK (status IN ('unavailable', 'pending', 'confirm')),
  notes TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX receipt_status_transaction ON receipt_status_history(transaction_id, id DESC);

CREATE TABLE auth_attempts (
  username TEXT PRIMARY KEY NOT NULL,
  started_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL
) STRICT;

CREATE TABLE transaction_reversals (
  original_id TEXT PRIMARY KEY NOT NULL REFERENCES transactions(id),
  reversal_id TEXT UNIQUE NOT NULL REFERENCES transactions(id)
) STRICT;

CREATE VIEW active_transactions AS
SELECT t.* FROM transactions t WHERE NOT EXISTS (
  SELECT 1 FROM transaction_reversals r WHERE r.original_id = t.id OR r.reversal_id = t.id
);

CREATE VIEW event_expenses AS
SELECT event_id, category, amount FROM active_transactions
WHERE kind IN ('expense', 'payment', 'reimbursement') AND event_id IS NOT NULL;

CREATE TABLE allocation_reductions (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL REFERENCES events(id),
  category TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE VIEW budget_movements AS
SELECT event_id, category, amount FROM allocations
UNION ALL SELECT event_id, category, -amount FROM allocation_reductions
UNION ALL SELECT source_event, category, -amount FROM allocation_transfers
UNION ALL SELECT destination_event, category, amount FROM allocation_transfers;

CREATE TRIGGER limit_allocation_transfer BEFORE INSERT ON allocation_transfers
BEGIN
  SELECT CASE WHEN NEW.amount > COALESCE((SELECT SUM(amount) FROM budget_movements
    WHERE event_id = NEW.source_event AND category = NEW.category), 0)
    THEN RAISE(ABORT, 'Insufficient approved allocation') END;
END;

CREATE TRIGGER limit_allocation_reduction BEFORE INSERT ON allocation_reductions
BEGIN
  SELECT CASE WHEN NEW.amount > COALESCE((SELECT SUM(amount) FROM budget_movements
    WHERE event_id = NEW.event_id AND category = NEW.category), 0)
    THEN RAISE(ABORT, 'Insufficient approved allocation') END;
END;

DROP VIEW event_finances;
CREATE VIEW event_finances AS
WITH movements AS (
  SELECT event_id, amount AS allocated, 0 AS paid, 0 AS outstanding FROM budget_movements
  UNION ALL SELECT event_id, 0, amount, 0 FROM event_expenses
  UNION ALL SELECT event_id, 0, 0, outstanding FROM obligation_balances WHERE event_id IS NOT NULL
), totals AS (
  SELECT event_id, SUM(allocated) AS allocated, SUM(paid) AS paid, SUM(outstanding) AS outstanding
  FROM movements GROUP BY event_id
)
SELECT e.*, COALESCE(t.allocated, 0) AS allocated, COALESCE(t.paid, 0) AS paid,
  COALESCE(t.outstanding, 0) AS outstanding, COALESCE(t.allocated - t.paid - t.outstanding, 0) AS available,
  COALESCE(t.allocated - t.paid, 0) AS variance,
  CASE WHEN t.allocated > 0 THEN ROUND(100.0 * t.paid / t.allocated, 1) END AS utilization
FROM events e LEFT JOIN totals t ON t.event_id = e.id;
