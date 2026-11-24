import type { User } from './auth.js'
import { cents, date, field, HttpError, json, readBody } from './http.js'

const accountSummary = `
  SELECT a.id, a.name, COALESCE(SUM(m.amount), 0) AS balance
  FROM accounts a LEFT JOIN account_movements m ON m.account_id = a.id
  GROUP BY a.id ORDER BY a.name
`

const queries: Record<string, string> = {
  accounts: accountSummary,
  events: 'SELECT * FROM event_finances ORDER BY starts_on DESC, name',
  allocations: `SELECT * FROM (
    SELECT * FROM allocations UNION ALL SELECT id, event_id, category, -amount, reason, created_by, created_at
    FROM allocation_reductions) ORDER BY created_at DESC`,
  'allocation-transfers': 'SELECT * FROM allocation_transfers ORDER BY created_at DESC',
  transactions: `SELECT t.*, COALESCE((SELECT r.status FROM transaction_reviews r
    WHERE r.transaction_id = t.id ORDER BY r.id DESC LIMIT 1), 'pending') AS review_status
    , CASE WHEN EXISTS (SELECT 1 FROM transaction_reversals r WHERE r.original_id = t.id) THEN 'reversed'
      WHEN EXISTS (SELECT 1 FROM transaction_reversals r WHERE r.reversal_id = t.id) THEN 'reversal'
      ELSE 'active' END AS record_status,
      (EXISTS (SELECT 1 FROM loans l WHERE l.transaction_id = t.id) OR
       EXISTS (SELECT 1 FROM loan_repayments p WHERE p.transaction_id = t.id)) AS linked_loan
    FROM transactions t ORDER BY t.occurred_on DESC, t.created_at DESC`,
  obligations: `SELECT *, CASE WHEN status <> 'active' THEN status
    WHEN outstanding = 0 THEN CASE WHEN kind = 'reimbursement' THEN 'reimbursed' ELSE 'paid' END
    WHEN paid > 0 THEN 'partial'
    WHEN kind = 'reimbursement' THEN 'to reimburse' ELSE 'to pay' END AS payment_status
    FROM obligation_balances ORDER BY created_at DESC`,
  reconciliations: 'SELECT *, actual - expected AS discrepancy FROM reconciliations ORDER BY counted_on DESC, created_at DESC',
  receipts: 'SELECT * FROM receipts ORDER BY created_at DESC',
  reviews: 'SELECT * FROM transaction_reviews ORDER BY id DESC',
  'event-history': 'SELECT * FROM event_history ORDER BY id DESC',
}

export async function financeRoute(request: Request, env: Pick<Env, 'DB'>, path: string, user: User) {
  const db = env.DB
  const resource = path.slice('/api/'.length)

  if (request.method === 'GET') {
    if (resource === 'summary') {
      const [transactions, outstanding, budgets, balances, discrepancies, loans] = await db.batch<Record<string, number>>([
        db.prepare(`SELECT COALESCE(SUM(CASE WHEN kind = 'income' THEN amount END), 0) AS received,
          COALESCE(SUM(CASE WHEN kind IN ('expense', 'payment', 'reimbursement') THEN amount END), 0) AS paid
          FROM active_transactions`),
        db.prepare(`SELECT COALESCE(SUM(CASE WHEN kind = 'payment' THEN outstanding END), 0) AS payments,
          COALESCE(SUM(CASE WHEN kind = 'reimbursement' THEN outstanding END), 0) AS reimbursements
          FROM obligation_balances`),
        db.prepare('SELECT COALESCE(SUM(allocated), 0) AS allocated FROM event_finances'),
        db.prepare('SELECT COALESCE(SUM(amount), 0) AS balance FROM account_movements'),
        db.prepare(`SELECT COALESCE(SUM(actual - expected), 0) AS discrepancy FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY counted_on DESC, created_at DESC, rowid DESC) AS position
          FROM reconciliations) WHERE position = 1`),
        db.prepare("SELECT COALESCE(SUM(amount - repaid), 0) AS loan_liability FROM loan_balances WHERE kind = 'loan_received'"),
      ])
      return json({
        ...transactions.results[0], ...outstanding.results[0], ...budgets.results[0],
        ...balances.results[0], ...discrepancies.results[0], ...loans.results[0],
      })
    }
    if (Object.hasOwn(queries, resource)) return json((await db.prepare(queries[resource]).all()).results)
    return null
  }

  if (request.method !== 'POST') return null
  const reviewer = resource === 'reviews' && user.role === 'auditor'
  if (!reviewer && user.role !== 'treasurer') {
    throw new HttpError(403, 'Your role cannot perform this action.')
  }
  if (!Object.hasOwn(queries, resource) || resource === 'receipts') return null

  const body = await readBody(request)
  const id = crypto.randomUUID()
  const text = (key: string, required = true) => field(body[key], key, 500, required)
  const reference = (key: string) => text(key, false) || null
  let statement: D1PreparedStatement

  switch (resource) {
    case 'accounts':
      statement = db.prepare('INSERT INTO accounts VALUES (?, ?)').bind(id, text('name'))
      break
    case 'events': {
      const starts = date(body.starts_on)
      const ends = date(body.ends_on)
      if (ends < starts) throw new HttpError(400, 'End date must be on or after the start date.')
      statement = db.prepare('INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, text('name'), text('description', false), text('academic_year'), starts, ends, user.id)
      break
    }
    case 'allocations': {
      const target = body.direction === 'reduce' ? 'allocation_reductions' : 'allocations'
      statement = db.prepare(`INSERT INTO ${target} (id, event_id, category, amount, reason, created_by)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(id, text('event_id'), text('category'), cents(body.amount), text('reason'), user.id)
      break
    }
    case 'allocation-transfers':
      statement = db.prepare(`INSERT INTO allocation_transfers
        (id, source_event, destination_event, category, amount, reason, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, text('source_event'), text('destination_event'), text('category'), cents(body.amount), text('reason'), user.id)
      break
    case 'obligations':
      statement = db.prepare(`INSERT INTO obligations
        (id, event_id, kind, description, category, counterparty, amount, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, reference('event_id'), text('kind'), text('description'), text('category'),
          text('counterparty'), cents(body.amount), user.id)
      if (body.planned === 'yes') {
        try {
          await db.batch([statement, db.prepare(`INSERT INTO obligation_status_history
            (obligation_id, status, reason, created_by) VALUES (?, 'planned', 'Recorded as planned', ?)`).bind(id, user.id)])
          return json({ id }, 201)
        } catch (error) {
          if (/constraint/i.test(String(error))) throw new HttpError(400, 'Check the event and obligation type.')
          throw error
        }
      }
      break
    case 'transactions': {
      const obligationId = reference('obligation_id')
      const obligation = obligationId ? await db.prepare('SELECT kind, event_id, category FROM obligations WHERE id = ?')
        .bind(obligationId).first<{ kind: string; event_id: string | null; category: string }>() : null
      if (obligationId && !obligation) throw new HttpError(404, 'Obligation not found.')
      const kind = obligation?.kind ?? (text('kind', false) || 'transfer')
      if (kind.startsWith('loan_')) throw new HttpError(400, 'Record loans and repayments in the Loans module.')
      statement = db.prepare(`INSERT INTO transactions (id, occurred_on, description, kind, amount, source_account,
        destination_account, event_id, obligation_id, category, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, date(body.occurred_on), text('description'), kind, cents(body.amount),
          reference('source_account'), reference('destination_account'), obligation ? obligation.event_id : reference('event_id'),
          obligationId, obligation?.category ?? text('category', false), text('notes', false), user.id)
      break
    }
    case 'reconciliations': {
      const accountId = text('account_id')
      const countedOn = date(body.counted_on)
      statement = db.prepare(`INSERT INTO reconciliations
        (id, account_id, counted_on, expected, actual, notes, created_by)
        VALUES (?, ?, ?, COALESCE((SELECT SUM(amount) FROM account_movements
          WHERE account_id = ? AND occurred_on <= ?), 0), ?, ?, ?)`)
        .bind(id, accountId, countedOn, accountId, countedOn, cents(body.actual, true), text('notes', false), user.id)
      break
    }
    case 'reviews':
      if (reviewer ? !['verified', 'flagged'].includes(text('status')) : text('status') !== 'pending') {
        throw new HttpError(403, 'Treasurers request verification. Auditors verify or flag records.')
      }
      statement = db.prepare(`INSERT INTO transaction_reviews (transaction_id, status, notes, created_by)
        VALUES (?, ?, ?, ?)`).bind(text('transaction_id'), text('status'), text('notes'), user.id)
      break
    default:
      return null
  }

  try {
    const result = await statement.run()
    return json({ id: resource === 'reviews' ? result.meta.last_row_id : id }, 201)
  } catch (error) {
    if (String(error).includes('Insufficient approved allocation')) throw new HttpError(400, 'The category does not have enough approved allocation.')
    if (/constraint|Invalid settlement|Obligation is not active/i.test(String(error))) {
      throw new HttpError(400, 'Check the selected records, transaction accounts, and outstanding amount.')
    }
    throw error
  }
}
