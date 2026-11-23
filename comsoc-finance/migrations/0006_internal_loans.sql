DROP TRIGGER limit_loan_repayment;
CREATE TRIGGER limit_loan_repayment BEFORE INSERT ON loan_repayments
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM loan_balances l JOIN transactions original ON original.id = l.transaction_id
    JOIN transactions payment ON payment.id = NEW.transaction_id
    WHERE l.id = NEW.loan_id AND payment.amount <= l.amount - l.repaid
      AND ((l.kind = 'loan_received' AND payment.kind = 'loan_repayment_paid')
        OR (l.kind = 'loan_issued' AND payment.kind = 'loan_repayment_received')
        OR (l.kind = 'transfer' AND payment.kind = 'transfer' AND original.source_account = payment.destination_account
          AND original.destination_account = payment.source_account))
  ) THEN RAISE(ABORT, 'Repayment exceeds available loan balance') END;
END;
