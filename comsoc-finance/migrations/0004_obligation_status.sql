CREATE TABLE obligation_status_history (
  id INTEGER PRIMARY KEY,
  obligation_id TEXT NOT NULL REFERENCES obligations(id),
  status TEXT NOT NULL CHECK (status IN ('planned', 'active', 'cancelled')),
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX obligation_status_latest ON obligation_status_history(obligation_id, id DESC);

CREATE TRIGGER limit_obligation_status_change BEFORE INSERT ON obligation_status_history
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM transactions t WHERE t.obligation_id = NEW.obligation_id
  ) OR COALESCE((SELECT status FROM obligation_status_history WHERE obligation_id = NEW.obligation_id
    ORDER BY id DESC LIMIT 1), 'active') = 'cancelled'
    OR (NEW.status = 'planned' AND EXISTS (
      SELECT 1 FROM obligation_status_history WHERE obligation_id = NEW.obligation_id
    ))
    THEN RAISE(ABORT, 'Cannot change the status of this obligation') END;
END;

CREATE TRIGGER require_active_obligation BEFORE INSERT ON transactions
WHEN NEW.obligation_id IS NOT NULL
BEGIN
  SELECT CASE WHEN COALESCE((SELECT status FROM obligation_status_history
    WHERE obligation_id = NEW.obligation_id ORDER BY id DESC LIMIT 1), 'active') <> 'active'
    THEN RAISE(ABORT, 'Obligation is not active') END;
END;

DROP VIEW obligation_balances;
CREATE VIEW obligation_balances AS
WITH states AS (
  SELECT o.*, COALESCE((SELECT h.status FROM obligation_status_history h WHERE h.obligation_id = o.id
    ORDER BY h.id DESC LIMIT 1), 'active') AS status
  FROM obligations o
)
SELECT o.*, COALESCE(s.paid, 0) AS paid,
  CASE WHEN o.status = 'active' THEN o.amount - COALESCE(s.paid, 0) ELSE 0 END AS outstanding
FROM states o LEFT JOIN (
  SELECT obligation_id, SUM(amount) AS paid FROM transactions
  WHERE obligation_id IS NOT NULL GROUP BY obligation_id
) s ON s.obligation_id = o.id;

CREATE TABLE receipt_documents (
  id TEXT PRIMARY KEY NOT NULL,
  transaction_id TEXT REFERENCES transactions(id),
  obligation_id TEXT REFERENCES obligations(id),
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((transaction_id IS NULL) <> (obligation_id IS NULL))
) STRICT;

INSERT INTO receipt_documents (id, transaction_id, filename, media_type, created_by, created_at)
SELECT id, transaction_id, filename, media_type, created_by, created_at FROM receipts;
DROP TABLE receipts;
ALTER TABLE receipt_documents RENAME TO receipts;
CREATE INDEX receipts_transaction ON receipts(transaction_id);
CREATE INDEX receipts_obligation ON receipts(obligation_id);
