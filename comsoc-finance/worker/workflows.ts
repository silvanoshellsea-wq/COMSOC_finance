import type { User } from './auth.js'
import { cents, date, field, HttpError, json, readBody } from './http.js'

export async function workflowRoute(request: Request, env: Env, resource: string, user: User) {
  const db = env.DB
  if (request.method === 'GET') {
    if (resource === 'loans') {
      return json((await db.prepare(`SELECT l.*, CASE WHEN l.kind = 'transfer' THEN 'internal_loan' ELSE l.kind END AS direction,
        l.amount - l.repaid AS outstanding, t.source_account, t.destination_account
        FROM loan_balances l JOIN transactions t ON t.id = l.transaction_id ORDER BY l.occurred_on DESC`).all()).results)
    }
    if (resource === 'purchases') {
      return json((await db.prepare(`SELECT p.*, COALESCE(o.description, t.description) AS description,
        COALESCE(o.event_id, t.event_id) AS event_id, COALESCE(o.category, t.category) AS category,
        COALESCE(o.amount, t.amount) AS amount, COALESCE(o.outstanding, 0) AS outstanding,
        (SELECT GROUP_CONCAT(quantity || ' × ' || name, ', ') FROM purchase_items WHERE purchase_id = p.id) AS items
        FROM purchases p LEFT JOIN obligation_balances o ON o.id = p.obligation_id
        LEFT JOIN transactions t ON t.id = p.transaction_id ORDER BY purchased_on DESC`).all()).results)
    }
    if (resource === 'receipt-status') {
      return json((await db.prepare('SELECT * FROM receipt_status_history ORDER BY id DESC').all()).results)
    }
    return null
  }
  if (request.method !== 'POST' ||
      !['purchases', 'loans', 'loan-repayments', 'receipt-status', 'reversals', 'obligation-status', 'event-changes'].includes(resource)) return null
  if (user.role !== 'treasurer') throw new HttpError(403, 'Your role cannot perform this action.')

  const body = await readBody(request)
  const id = crypto.randomUUID()
  const text = (key: string, required = true) => field(body[key], key, 500, required)
  const entry = db.prepare(`INSERT INTO transactions
    (id, occurred_on, description, kind, amount, source_account, destination_account, event_id, category, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  let statements: D1PreparedStatement[]

  if (resource === 'event-changes') {
    const eventId = text('event_id')
    const name = text('name')
    const description = text('description', false)
    const academicYear = text('academic_year')
    const starts = date(body.starts_on)
    const ends = date(body.ends_on)
    if (ends < starts) throw new HttpError(400, 'End date must be on or after the start date.')
    if (!await db.prepare('SELECT 1 FROM events WHERE id = ?').bind(eventId).first()) {
      throw new HttpError(404, 'Event not found.')
    }
    statements = [
      db.prepare(`INSERT INTO event_history (event_id, previous_values, new_values, reason, created_by)
        SELECT id, json_object('name', name, 'description', description, 'academic_year', academic_year,
          'starts_on', starts_on, 'ends_on', ends_on), ?, ?, ? FROM events WHERE id = ?`)
        .bind(JSON.stringify({ name, description, academic_year: academicYear, starts_on: starts, ends_on: ends }),
          text('reason'), user.id, eventId),
      db.prepare('UPDATE events SET name = ?, description = ?, academic_year = ?, starts_on = ?, ends_on = ? WHERE id = ?')
        .bind(name, description, academicYear, starts, ends, eventId),
    ]
  } else if (resource === 'obligation-status') {
    const status = text('status')
    if (!['active', 'cancelled'].includes(status)) throw new HttpError(400, 'Choose an obligation status.')
    statements = [db.prepare(`INSERT INTO obligation_status_history (obligation_id, status, reason, created_by)
      VALUES (?, ?, ?, ?)`).bind(text('obligation_id'), status, text('reason'), user.id)]
  } else if (resource === 'reversals') {
    const originalId = text('transaction_id')
    const original = await db.prepare(`SELECT * FROM active_transactions
      WHERE id = ? AND kind IN ('income', 'expense', 'transfer', 'adjustment')
      AND NOT EXISTS (SELECT 1 FROM purchases WHERE transaction_id = ?)
      AND NOT EXISTS (SELECT 1 FROM loans WHERE transaction_id = ?)
      AND NOT EXISTS (SELECT 1 FROM loan_repayments WHERE transaction_id = ?)`)
      .bind(originalId, originalId, originalId, originalId).first<{
        occurred_on: string; kind: string; amount: number; source_account: string | null;
        destination_account: string | null; event_id: string | null; category: string
      }>()
    if (!original) throw new HttpError(400, 'Select an active direct transaction to reverse.')
    const day = date(body.occurred_on)
    if (day < original.occurred_on) throw new HttpError(400, 'Reversal date must be on or after the original date.')
    statements = [
      entry.bind(id, day, 'Reversal of ' + originalId, original.kind === 'transfer' ? 'transfer' : 'adjustment',
        original.amount, original.destination_account, original.source_account, original.event_id, original.category, text('notes'), user.id),
      db.prepare('INSERT INTO transaction_reversals VALUES (?, ?)').bind(originalId, id),
    ]
  } else if (resource === 'receipt-status') {
    statements = [db.prepare(`INSERT INTO receipt_status_history (transaction_id, status, notes, created_by)
      VALUES (?, ?, ?, ?)`).bind(text('transaction_id'), text('status'), text('notes', false), user.id)]
  } else if (resource === 'purchases') {
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 30) {
      throw new HttpError(400, 'Add between 1 and 30 items.')
    }
    const items = body.items.map((item: unknown) => {
      if (!item || typeof item !== 'object') throw new HttpError(400, 'Invalid purchase item.')
      const row = item as Record<string, unknown>
      const quantity = Number(row.quantity)
      if (typeof row.quantity !== 'string' || !/^\d{1,4}$/.test(row.quantity) || quantity <= 0) {
        throw new HttpError(400, 'Enter a whole quantity between 1 and 9999.')
      }
      return { name: field(row.name, 'item name'), quantity, price: cents(row.price) }
    })
    const total = items.reduce((sum, item) => sum + item.quantity * item.price, 0)
    if (!Number.isSafeInteger(total) || total > 999_999_999_999) throw new HttpError(400, 'Purchase total is too large.')
    const kind = text('kind')
    const day = date(body.purchased_on)
    const event = text('event_id', false) || null
    const category = text('category')
    const description = text('description')
    const linked = crypto.randomUUID()
    const vendor = text('vendor')
    const paid = kind === 'expense'
    if (!paid && !['payment', 'reimbursement'].includes(kind)) throw new HttpError(400, 'Choose a payment status.')
    const origin = paid
      ? entry.bind(linked, day, description, kind, total, text('source_account'), null, event, category, text('notes', false), user.id)
      : db.prepare(`INSERT INTO obligations (id, event_id, kind, description, category, counterparty, amount, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(linked, event, kind, description, category, text('counterparty'), total, user.id)
    const addItem = db.prepare('INSERT INTO purchase_items VALUES (?, ?, ?, ?, ?)')
    statements = [
      origin,
      db.prepare('INSERT INTO purchases VALUES (?, ?, ?, ?, ?)').bind(id, vendor, day, paid ? linked : null, paid ? null : linked),
      ...items.map((item, index) => addItem.bind(id, index + 1, item.name, item.quantity, item.price)),
    ]
  } else {
    const transaction = crypto.randomUUID()
    const amount = cents(body.amount)
    const day = date(body.occurred_on)
    const description = text('description')
    const notes = text('notes', false)
    if (resource === 'loans') {
      const kind = text('kind')
      if (!['loan_received', 'loan_issued', 'internal_loan'].includes(kind)) throw new HttpError(400, 'Choose a loan direction.')
      const account = text('account_id')
      const incoming = kind === 'loan_received'
      const internal = kind === 'internal_loan'
      const counterparty = internal ? 'COMSOC' : text('counterparty')
      const destination = internal ? text('destination_account') : incoming ? account : null
      statements = [
        entry.bind(transaction, day, description, internal ? 'transfer' : kind, amount, incoming ? null : account, destination, null, '', notes, user.id),
        db.prepare('INSERT INTO loans VALUES (?, ?, ?)').bind(id, transaction, counterparty),
      ]
    } else {
      const loanId = text('loan_id')
      const loan = await db.prepare(`SELECT l.kind, t.source_account, t.destination_account
        FROM loan_balances l JOIN transactions t ON t.id = l.transaction_id WHERE l.id = ?`).bind(loanId).first<{
        kind: string; source_account: string | null; destination_account: string | null
      }>()
      if (!loan) throw new HttpError(404, 'Loan not found.')
      const incoming = loan.kind === 'loan_issued'
      const internal = loan.kind === 'transfer'
      const account = internal ? null : text('account_id')
      const kind = internal ? 'transfer' : incoming ? 'loan_repayment_received' : 'loan_repayment_paid'
      statements = [
        entry.bind(transaction, day, description, kind, amount,
          internal ? loan.destination_account : incoming ? null : account,
          internal ? loan.source_account : incoming ? account : null, null, '', notes, user.id),
        db.prepare('INSERT INTO loan_repayments VALUES (?, ?)').bind(loanId, transaction),
      ]
    }
  }
  try {
    await db.batch(statements)
    return json({ id }, 201)
  } catch (error) {
    if (/constraint|Repayment exceeds|Cannot change the status/i.test(String(error))) {
      throw new HttpError(400, 'Check the selected records, status, and outstanding balance.')
    }
    throw error
  }
}
