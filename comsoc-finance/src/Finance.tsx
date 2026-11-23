import { useState } from 'react'
import { money } from './api'
import type { Row, User } from './api'
import { RecordForm, RecordTable } from './Records'
import PurchaseForm from './PurchaseForm'
import type { Column, Field, Option } from './Records'

export const resources = [
  'accounts', 'events', 'transactions', 'obligations', 'allocations',
  'allocation-transfers', 'receipts', 'reconciliations', 'reviews',
  'purchases', 'loans', 'receipt-status', 'event-history',
] as const
export type FinanceData = Record<typeof resources[number], Row[]> & { summary: Record<string, number> }

const options = (values: Record<string, string>): Option[] =>
  Object.entries(values).map(([value, label]) => ({ value, label }))
const fromRows = (rows: Row[], label = 'name'): Option[] =>
  rows.map((row) => ({ value: String(row.id), label: String(row[label]) }))
const column = (key: string, label: string, extra: Omit<Column, 'key' | 'label'> = {}): Column =>
  ({ key, label, ...extra })
const field = (key: string, label: string, extra: Omit<Field, 'key' | 'label'> = {}): Field =>
  ({ key, label, ...extra })
const amount = field('amount', 'Amount (PHP)', { type: 'money' })
const category = field('category', 'Category')
const notes = field('notes', 'Notes', { optional: true })
const description = field('description', 'Description')
const entryDate = field('occurred_on', 'Transaction date', { type: 'date' })

const kinds = options({
  income: 'Income', expense: 'Expense', transfer: 'Account transfer', adjustment: 'Adjustment',
  loan_received: 'Loan received', loan_issued: 'Loan issued',
  loan_repayment_received: 'Loan repayment received', loan_repayment_paid: 'Loan repayment paid',
  payment: 'Obligation payment', reimbursement: 'Reimbursement',
})
const obligationKinds = options({ payment: 'Payment', reimbursement: 'Reimbursement' })
const loanKinds = options({ loan_received: 'Borrowed from outside COMSOC', loan_issued: 'Lent outside COMSOC', internal_loan: 'Loan between COMSOC accounts' })
const statuses = options({ pending: 'Pending review', verified: 'Verified', flagged: 'Flagged' })

export default function Finance({ section, data, user, refresh }: {
  section: string; data: FinanceData; user: User; refresh: () => void
}) {
  const [report, setReport] = useState('ledger')
  const [eventFilter, setEventFilter] = useState('')
  const [yearFilter, setYearFilter] = useState('')
  const [from, setFrom] = useState('')
  const [through, setThrough] = useState('')
  const [accountFilter, setAccountFilter] = useState('')
  const [receiptEvent, setReceiptEvent] = useState<string | null>(null)
  const [receiptId, setReceiptId] = useState('')
  const treasurer = user.role === 'treasurer'
  const accounts = fromRows(data.accounts)
  const events = fromRows(data.events)
  const transactions = data.transactions.map((entry) => ({
    value: String(entry.id), label: `${entry.occurred_on} · ${entry.description} · ${money(Number(entry.amount))}`,
  }))
  const outstanding = data.obligations.filter((row) => Number(row.outstanding) > 0)
  const obligationsById = fromRows(data.obligations, 'description')
  const event = field('event_id', 'Event', { options: events, optional: true })
  const columns = {
    transactions: [
      column('occurred_on', 'Date'), column('description', 'Description'), column('kind', 'Type', { options: kinds }),
      column('amount', 'Amount', { money: true }), column('source_account', 'From', { options: accounts }),
      column('destination_account', 'To', { options: accounts }), column('event_id', 'Event', { options: events }),
      column('category', 'Category'), column('review_status', 'Verification', { options: statuses }),
      column('record_status', 'Record status'),
      column('created_by', 'Recorded by'), column('notes', 'Notes'),
    ],
    events: [
      column('name', 'Event'), column('academic_year', 'Academic year'), column('starts_on', 'Starts'),
      column('ends_on', 'Ends'), column('allocated', 'Allocated', { money: true }),
      column('paid', 'Paid', { money: true }), column('outstanding', 'Outstanding', { money: true }),
      column('available', 'Available', { money: true }),
      column('variance', 'Variance', { money: true }), column('utilization', 'Utilization (%)'),
    ],
    accounts: [column('name', 'Account'), column('balance', 'Recorded balance', { money: true })],
    obligations: [
      column('description', 'Description'), column('counterparty', 'Payee'), column('kind', 'Type', { options: obligationKinds }),
      column('event_id', 'Event', { options: events }), column('amount', 'Total', { money: true }),
      column('paid', 'Paid', { money: true }), column('outstanding', 'Outstanding', { money: true }),
      column('payment_status', 'Status'),
    ],
    receipts: [
      column('filename', 'Filename'), column('transaction_id', 'Transaction', { options: transactions }),
      column('obligation_id', 'Obligation', { options: obligationsById }),
      column('created_by', 'Uploaded by'), column('created_at', 'Uploaded'),
    ],
    reconciliations: [
      column('counted_on', 'Date'), column('account_id', 'Account', { options: accounts }),
      column('expected', 'Expected', { money: true }), column('actual', 'Counted', { money: true }),
      column('discrepancy', 'Difference', { money: true }), column('notes', 'Notes'),
    ],
  }
  const table = (key: keyof typeof columns, title: string, rows = data[key], report = false) =>
    <RecordTable key={title} title={title} rows={rows} columns={columns[key]} report={report} receiptLinks={key === 'receipts'} />
  const form = (title: string, resource: string, fields: Field[], upload = false) =>
    <RecordForm title={title} resource={resource} fields={fields} onSaved={refresh} upload={upload} />
  const source = field('source_account', 'From account', { options: accounts })
  const destination = field('destination_account', 'To account', { options: accounts })

  switch (section) {
    case 'dashboard': {
      const s = data.summary
      const metrics = [
        ['Funds received', s.received], ['Expenses paid', s.paid],
        ['Outstanding payments', s.payments], ['Outstanding reimbursements', s.reimbursements],
        ['Allocated funds', s.allocated], ['Unallocated funds', s.received - s.allocated],
        ['Projected remaining funds', s.balance - s.payments - s.reimbursements - s.loan_liability], ['Cash discrepancies', s.discrepancy],
      ] as const
      return <>
        <dl className="metric-grid" aria-label="Financial summary">
          {metrics.map(([label, value]) => <div key={label} className="metric"><dt>{label}</dt><dd>{money(value)}</dd></div>)}
        </dl>
        <div className="dashboard-grid">
          {table('accounts', 'Recorded accounts')}
          <section className="panel">
            <div className="panel-heading"><h2>Event budget utilization</h2><a href="#budgets" className="action">View budgets</a></div>
            {data.events.length ? <ul className="grid gap-3">
              {data.events.slice(0, 6).map((row) => {
                const utilization = Number(row.utilization ?? 0)
                return <li key={String(row.id)}>
                  <div className="flex justify-between gap-3 text-sm"><span>{row.name}</span>
                    <span>{row.utilization === null ? 'No allocation' : utilization + '%'}</span></div>
                  <meter className="h-3 w-full" min={0} max={100} high={80} optimum={0} value={Math.max(0, Math.min(100, utilization))}
                    aria-label={String(row.name) + ' budget utilization'} />
                  {Number(row.available) < 0 && <span className="text-sm font-medium text-red-800">Over budget by {money(-Number(row.available))}</span>}
                </li>
              })}
            </ul> : <p>No events have been recorded yet.</p>}
          </section>
        </div>
        <div className="mt-4">{table('transactions', 'Recent transactions', data.transactions.slice(0, 8))}</div>
      </>
    }
    case 'ledger':
      return <>
        {table('transactions', 'General ledger', data.transactions, true)}
        {treasurer ? form('Record transaction', 'transactions', [
          entryDate, description, field('kind', 'Type', { options: kinds.filter(({ value }) => !value.startsWith('loan_') && !['payment', 'reimbursement'].includes(value)) }),
          amount, { ...source, optional: true }, { ...destination, optional: true },
          event, { ...category, optional: true }, notes,
        ]) : form('Review transaction', 'reviews', [
          field('transaction_id', 'Transaction', { options: transactions }),
          field('status', 'Decision', { options: statuses.filter(({ value }) => value !== 'pending') }),
          { ...notes, optional: false },
        ])}
        {treasurer && form('Reverse a direct transaction', 'reversals', [
          field('transaction_id', 'Transaction', { options: transactions.filter(({ value }) =>
            data.transactions.some((row) => row.id === value && row.record_status === 'active' && !row.linked_loan &&
              ['income', 'expense', 'transfer', 'adjustment'].includes(String(row.kind)) &&
              !data.purchases.some((purchase) => purchase.transaction_id === value))) }),
          entryDate, field('notes', 'Reason'),
        ])}
        {treasurer && <RecordForm resource="reviews" title="Request verification" onSaved={refresh}
          fields={[field('transaction_id', 'Transaction', { options: transactions }), field('notes', 'Reason')]}
          prepare={(values) => ({ ...Object.fromEntries(values.entries()), status: 'pending' })} />}
        <RecordTable title="Verification history" rows={data.reviews} columns={[
          column('transaction_id', 'Transaction', { options: transactions }), column('status', 'Decision', { options: statuses }),
          column('notes', 'Notes'), column('created_by', 'Reviewer'), column('created_at', 'Reviewed'),
        ]} />
      </>
    case 'accounts':
      return <>
        {table('accounts', 'Recorded accounts')}
        {treasurer && form('Add cash envelope', 'accounts', [field('name', 'Envelope name')])}
        {treasurer && form('Transfer funds', 'transactions', [entryDate, description, amount, source, destination])}
        <label className="field max-w-sm">Filter account history<select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}>
          <option value="">All accounts</option>
          {accounts.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        {table('transactions', 'Account history', data.transactions.filter((row) =>
          !accountFilter || row.source_account === accountFilter || row.destination_account === accountFilter))}
      </>
    case 'allocations':
    case 'budgets':
      return <>
        {table('events', section === 'allocations' ? 'Final Allocation' : 'Event budgets', data.events, true)}
        {treasurer && section === 'budgets' && form('Create event', 'events', [
          field('name', 'Event name'), { ...description, optional: true }, field('academic_year', 'Academic year'),
          field('starts_on', 'Start date', { type: 'date' }), field('ends_on', 'End date', { type: 'date' }),
        ])}
        {treasurer && section === 'budgets' && form('Update event details', 'event-changes', [
          { ...event, optional: false }, field('name', 'Event name'), { ...description, optional: true },
          field('academic_year', 'Academic year'), field('starts_on', 'Start date', { type: 'date' }),
          field('ends_on', 'End date', { type: 'date' }), field('reason', 'Reason for change'),
        ])}
        {treasurer && form('Adjust budget allocation', 'allocations', [
          { ...event, optional: false }, category, amount, field('reason', 'Reason'),
          field('direction', 'Adjustment', { options: options({ increase: 'Increase', reduce: 'Reduce' }) }),
        ])}
        {treasurer && form('Transfer budget between events', 'allocation-transfers', [
          field('source_event', 'From event', { options: events }), field('destination_event', 'To event', { options: events }),
          category, amount, field('reason', 'Reason'),
        ])}
        <RecordTable title="Allocation history" rows={data.allocations} columns={[
          column('event_id', 'Event', { options: events }), column('category', 'Category'), column('amount', 'Amount', { money: true }),
          column('reason', 'Reason'), column('created_at', 'Recorded'),
        ]} />
        <RecordTable title="Budget transfer history" rows={data['allocation-transfers']} columns={[
          column('source_event', 'From', { options: events }), column('destination_event', 'To', { options: events }),
          column('category', 'Category'), column('amount', 'Amount', { money: true }), column('reason', 'Reason'),
          column('created_at', 'Recorded'),
        ]} />
        {section === 'budgets' && <RecordTable title="Event change history" rows={data['event-history']} columns={[
          column('event_id', 'Event', { options: events }), column('reason', 'Reason'),
          column('previous_values', 'Previous values'), column('new_values', 'New values'),
          column('created_by', 'Recorded by'), column('created_at', 'Recorded'),
        ]} />}
      </>
    case 'receipts': {
      const groups = new Map<string, Row[]>()
      const transactionEvents = new Map(data.transactions.map((row) => [row.id, row.event_id]))
      const obligationEvents = new Map(data.obligations.map((row) => [row.id, row.event_id]))
      const eventIds = new Set(data.events.map((row) => row.id))
      for (const receipt of data.receipts) {
        const id = transactionEvents.get(receipt.transaction_id) ?? obligationEvents.get(receipt.obligation_id)
        const key = id && eventIds.has(id) ? String(id) : ''
        const rows = groups.get(key) ?? []
        rows.push(receipt)
        groups.set(key, rows)
      }
      const groupedReceipts = [...data.events.map(({ id, name }) => ({ id: String(id), name: String(name) })),
        { id: '', name: 'No event assigned' }]
      const selectedEvent = groupedReceipts.find(({ id }) => id === receiptEvent)
      const selectedReceipt = (groups.get(receiptEvent ?? '') ?? []).find(({ id }) => id === receiptId)
      const sourceTransaction = data.transactions.find(({ id }) => id === selectedReceipt?.transaction_id)
      const sourceObligation = data.obligations.find(({ id }) => id ===
        (selectedReceipt?.obligation_id ?? sourceTransaction?.obligation_id))
      const purchase = data.purchases.find((row) => (sourceTransaction && row.transaction_id === sourceTransaction.id) ||
        (sourceObligation && row.obligation_id === sourceObligation.id))
      return <>
        <section className="panel grid gap-3">
          {selectedReceipt ? <>
            <button className="action justify-self-start" onClick={() => setReceiptId('')}>Back to event receipts</button>
            <h2>{selectedReceipt.filename}</h2>
            <div><h3 className="font-semibold">Items on the linked record</h3>
              <p>{purchase?.items ?? sourceTransaction?.description ?? sourceObligation?.description ?? 'No item details recorded.'}</p></div>
            <a className="action justify-self-start" href={'/api/receipts/' + selectedReceipt.id} target="_blank" rel="noreferrer">Open file</a>
          </> : selectedEvent ? <>
            <button className="action justify-self-start" onClick={() => setReceiptEvent(null)}>Back to receipt events</button>
            <h2>{selectedEvent.name}</h2>
            <ul>{groups.get(selectedEvent.id)?.map((receipt) => <li key={String(receipt.id)}>
              <button className="action" onClick={() => setReceiptId(String(receipt.id))}>{receipt.filename}</button>
            </li>)}</ul>
            {!groups.has(selectedEvent.id) && <p>No receipts for this event.</p>}
          </> : <>
            <h2>Receipt events</h2>
            <ul>{groupedReceipts.filter(({ id }) => id || groups.has(id)).map(({ id, name }) => {
              const count = groups.get(id)?.length ?? 0
              return <li key={id}><button className="action" onClick={() => setReceiptEvent(id)}>
                {name} · {count} {count === 1 ? 'receipt' : 'receipts'}
              </button></li>
            })}</ul>
            {!data.events.length && !groups.size && <p>No events or receipts.</p>}
          </>}
        </section>
        {form('Upload receipt', 'receipts', [
          field('transaction_id', 'Transaction (choose one target)', { options: transactions, optional: true }),
          field('obligation_id', 'Obligation (choose one target)', { options: obligationsById, optional: true }),
          field('receipt', 'Receipt file', { type: 'file' }),
        ], true)}
        {table('transactions', 'Transactions with no receipt', data.transactions.filter((row) =>
          !data.receipts.some((receipt) => receipt.transaction_id === row.id)))}
        {treasurer && form('Record missing receipt status', 'receipt-status', [
          field('transaction_id', 'Transaction', { options: transactions }),
          field('status', 'Status', { options: options({ unavailable: 'No receipt available', pending: 'Receipt pending', confirm: 'Amount to confirm' }) }),
          notes,
        ])}
        <RecordTable title="Receipt status history" rows={data['receipt-status']} columns={[
          column('transaction_id', 'Transaction', { options: transactions }), column('status', 'Status'),
          column('notes', 'Notes'), column('created_by', 'Recorded by'), column('created_at', 'Date'),
        ]} />
      </>
    }
    case 'purchases':
      return <>
        <RecordTable title="Purchase history" rows={data.purchases} columns={[
          column('purchased_on', 'Date'), column('vendor', 'Vendor'), column('description', 'Description'),
          column('items', 'Items'), column('event_id', 'Event', { options: events }), column('category', 'Category'),
          column('amount', 'Total', { money: true }), column('outstanding', 'Outstanding', { money: true }),
        ]} />
        {treasurer && <PurchaseForm events={events} accounts={accounts}
          available={new Map(data.events.map((row) => [String(row.id), Number(row.available)]))} onSaved={refresh} />}
      </>
    case 'loans':
      return <>
        <RecordTable title="Loan balances" rows={data.loans} columns={[
          column('occurred_on', 'Date'), column('description', 'Description'), column('direction', 'Direction', { options: loanKinds }),
          column('source_account', 'From', { options: accounts }), column('destination_account', 'To', { options: accounts }),
          column('counterparty', 'Counterparty'), column('amount', 'Principal', { money: true }),
          column('repaid', 'Repaid', { money: true }), column('outstanding', 'Outstanding', { money: true }),
        ]} />
        {treasurer && form('Record loan', 'loans', [
          entryDate, description, field('kind', 'Direction', { options: loanKinds }),
          field('counterparty', 'External counterparty', { optional: true }),
          field('account_id', 'Account (source for internal loan)', { options: accounts }),
          { ...destination, label: 'Destination for internal loan', optional: true }, amount, notes,
        ])}
        {treasurer && form('Record loan repayment', 'loan-repayments', [
          field('loan_id', 'Loan', { options: fromRows(data.loans.filter((loan) => Number(loan.outstanding) > 0), 'description') }),
          entryDate, description, field('account_id', 'Account for external repayment', { options: accounts, optional: true }), amount, notes,
        ])}
      </>
    case 'reimbursements':
      return <>
        {table('obligations', 'Payment and reimbursement obligations')}
        {treasurer && form('Record obligation', 'obligations', [
          field('kind', 'Type', { options: obligationKinds }), description, event, category, field('counterparty', 'Payee'), amount,
          field('planned', 'Initially planned', { options: options({ yes: 'Yes', no: 'No, record as outstanding' }) }),
        ])}
        {treasurer && form('Activate or cancel an obligation', 'obligation-status', [
          field('obligation_id', 'Unpaid obligation', { options: fromRows(data.obligations.filter((row) => row.paid === 0 && row.status !== 'cancelled'), 'description') }),
          field('status', 'New status', { options: options({ active: 'Active', cancelled: 'Cancelled' }) }),
          field('reason', 'Reason'),
        ])}
        {treasurer && form('Record full or partial payment', 'transactions', [
          field('obligation_id', 'Obligation', { options: fromRows(outstanding, 'description') }),
          entryDate, description, amount, source, notes,
        ])}
      </>
    case 'reconciliation':
      return <>
        {table('reconciliations', 'Reconciliation history')}
        {treasurer && form('Record cash count', 'reconciliations', [
          field('account_id', 'Account', { options: accounts }), field('counted_on', 'Count date', { type: 'date' }),
          field('actual', 'Actual count (PHP)', { type: 'money' }), notes,
        ])}
      </>
    case 'reports': {
      function filter(rows: Row[], eventKey: string, dateKey: string) {
        return rows.filter((row) => {
          const eventId = row[eventKey]
          const day = String(row[dateKey]).slice(0, 10)
          return (!eventFilter || eventId === eventFilter) &&
            (!yearFilter || data.events.some((event) => event.id === eventId && event.academic_year === yearFilter)) &&
            (!from || day >= from) && (!through || day <= through)
        })
      }
      const entries = filter(data.transactions, 'event_id', 'occurred_on')
      const obligations = filter(outstanding, 'event_id', 'created_at')
      const reports = {
        ledger: () => table('transactions', 'General ledger', entries, true),
        allocation: () => table('events', 'Final Allocation', filter(data.events, 'id', 'starts_on'), true),
        expenses: () => table('transactions', 'Event expense report', entries.filter((row) => row.event_id && row.record_status === 'active' && ['expense', 'payment', 'reimbursement'].includes(String(row.kind))), true),
        income: () => table('transactions', 'Income summary', entries.filter((row) => row.kind === 'income' && row.record_status === 'active'), true),
        accounts: () => table('accounts', 'Cash and GCash balance report', data.accounts, true),
        payments: () => table('obligations', 'Outstanding payments', obligations.filter((row) => row.kind === 'payment'), true),
        reimbursements: () => table('obligations', 'Outstanding reimbursements', obligations.filter((row) => row.kind === 'reimbursement'), true),
        budgets: () => table('events', 'Budget variance report', filter(data.events, 'id', 'starts_on'), true),
        receipts: () => table('receipts', 'Receipt documentation report', data.receipts.filter((receipt) =>
          entries.some((entry) => entry.id === receipt.transaction_id) ||
          filter(data.obligations, 'event_id', 'created_at').some((obligation) => obligation.id === receipt.obligation_id)), true),
        reconciliation: () => table('reconciliations', 'Cash reconciliation report', data.reconciliations.filter((row) => {
          const day = String(row.counted_on)
          return (!from || day >= from) && (!through || day <= through)
        }), true),
      }
      const labels = options({
        ledger: 'General Ledger', allocation: 'Final Allocation', expenses: 'Event Expense Report',
        income: 'Income Summary', accounts: 'Cash and GCash Balance', payments: 'Outstanding Payments',
        reimbursements: 'Reimbursements', budgets: 'Budget Variance', receipts: 'Receipt Documentation',
        reconciliation: 'Cash Reconciliation',
      })
      return <>
        <section className="panel print:hidden">
          <h2>Report options</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="field">Report<select value={report} onChange={(e) => setReport(e.target.value)}>
              {labels.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            {!['accounts', 'reconciliation'].includes(report) && <>
              <label className="field">Event<select value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}>
                <option value="">All events</option>{events.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select></label>
              <label className="field">Academic year<select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
                <option value="">All years</option>{Array.from(new Set(data.events.map((row) => String(row.academic_year)))).sort().map((year) =>
                  <option key={year}>{year}</option>,
                )}
              </select></label>
            </>}
            {report !== 'accounts' && <>
              <label className="field">From date<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className="field">Through date<input type="date" value={through} onChange={(e) => setThrough(e.target.value)} /></label>
            </>}
          </div>
        </section>
        {reports[report as keyof typeof reports]()}
      </>
    }
    default:
      return null
  }
}
