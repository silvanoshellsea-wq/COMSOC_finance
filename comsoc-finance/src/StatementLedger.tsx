import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { money } from './api'
import { downloadCsv } from './csv'
import StatementDialog from './StatementDialog'
import { accounts, amount, finance, kinds, ledger, linkedReceiptItems, movements, parseMoney, postEntry } from './statementModel'
import type { Account, Entry, Kind, Statement, Status } from './statementModel'

export type Change = (update: (statement: Statement) => Statement) => void
const blank = () => ({ id: crypto.randomUUID(), name: '', quantity: '1', price: '', planId: '', account: '' as Account | '' })
export const value = (data: FormData, key: string) => String(data.get(key) ?? '').trim()
export const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Singapore' }).format(new Date())
const columns = ['Transaction Date', 'Transaction ID', 'Event Name', 'Item / Material Name', 'Expense Category',
  'Quantity', 'Unit Price (PHP)', 'Total Amount (PHP)', 'Transaction Type', 'Payment Account', 'Payment Status', 'Person in Charge', 'Receipt', 'Notes']

export function Sheet({ title, columns, rows }: { title: string; columns: string[]; rows: { id: string; cells: ReactNode[] }[] }) {
  return <div className="demo-sheet" tabIndex={0} role="region" aria-label={title}>
    <table><caption className="sr-only">{title}</caption>
      <thead><tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
      <tbody>{rows.length ? rows.map(({ id, cells }) => <tr key={id}>{cells.map((cell, index) => <td key={columns[index]}>{cell}</td>)}</tr>)
        : <tr><td colSpan={columns.length}>No matching records.</td></tr>}</tbody>
    </table>
  </div>
}

export function ReceiptPreview({ file }: { file: File }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])
  return <div className="demo-receipt">
    <div>{file.name}</div>
    {url && (file.type === 'application/pdf'
      ? <iframe title={file.name} src={url} />
      : <img src={url} alt={'Receipt preview: ' + file.name} />)}
  </div>
}

export function ReceiptItems({ entry }: { entry: Entry }) {
  return <Sheet title="Items linked to receipt" columns={['Item', 'Quantity', 'Unit Price', 'Amount']}
    rows={linkedReceiptItems(entry).map((item, index) => ({
      id: String(index), cells: [item.name, item.quantity, money(item.price), money(item.quantity * item.price)],
    }))} />
}

const fileTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
const fileAccept = fileTypes.join(',')

function AttachReceipt({ entry, change }: { entry: Entry; change: Change }) {
  const [error, setError] = useState('')

  function attach(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const file = form.get('receipt')
    const indexes = form.getAll('item').map(Number)
    if (!(file instanceof File) || !file.size || file.size > 5 * 1024 * 1024 || !fileTypes.includes(file.type)) {
      setError('Choose a supported image or PDF under 5 MB.')
      return
    }
    if (!indexes.length) {
      setError('Select at least one item covered by the receipt.')
      return
    }
    change((current) => ({
      ...current,
      entries: current.entries.map((row) => row.id === entry.id && !row.receipt
        ? { ...row, receipt: file, receiptItemIndexes: indexes } : row),
    }))
  }

  return <form className="demo-item grid gap-3" onSubmit={attach}>
    <label>Receipt photo or PDF<input name="receipt" type="file" accept={fileAccept} required /></label>
    <fieldset className="demo-receipt-items">
      <legend>Items covered by this receipt</legend>
      {entry.items.map((item, index) => <label key={index}>
        <input type="checkbox" name="item" value={index} defaultChecked />{item.name}
      </label>)}
    </fieldset>
    {error && <p className="demo-error" role="alert">{error}</p>}
    <button className="demo-primary" type="submit">Attach receipt</button>
  </form>
}

function EntryForm({ statement, change, close, receiptUploads }: {
  statement: Statement; change: Change; close: () => void; receiptUploads: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal()
  }, [])

  function dismiss() {
    dialog.current?.close()
    close()
  }

  const [items, setItems] = useState([blank()])
  const [eventId, setEventId] = useState('')
  const [category, setCategory] = useState('')
  const [kind, setKind] = useState<Kind>('Expense')
  const [status, setStatus] = useState<Status>('Paid')
  const [receipt, setReceipt] = useState<File>()
  const [excludedItems, setExcludedItems] = useState<string[]>([])
  const [error, setError] = useState('')
  const splitAccounts = kind === 'Expense' && status === 'Paid'
  const event = statement.events.find((row) => row.id === eventId)
  const total = items.reduce((sum, row) => {
    try { return sum + parseMoney(row.price) * (Number(row.quantity) || 0) } catch { return sum }
  }, 0)

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    try {
      const entry: Entry = {
        id: crypto.randomUUID(), day: value(data, 'day'), eventId, category: event ? category : value(data, 'category'),
        items: items.map((row) => ({ name: row.name.trim(), quantity: Number(row.quantity), price: parseMoney(row.price),
          planId: row.planId || undefined, account: splitAccounts ? row.account || undefined : undefined })),
        kind, status, account: status === 'To Reimburse' ? 'Personal Funds' : value(data, 'account') as Account,
        person: value(data, 'person'), notes: value(data, 'notes'), receipt,
        receiptItemIndexes: receipt ? items.flatMap((item, index) => excludedItems.includes(item.id) ? [] : [index]) : undefined,
      }
      if (kind === 'Reimbursement') throw new Error('Open an outstanding expense and use Record payment to link the reimbursement.')
      const next = postEntry(statement, entry)
      change(() => next)
      dismiss()
    } catch (failure) { setError((failure as Error).message) }
  }

  return <dialog ref={dialog} className="demo-entry-dialog" aria-labelledby="demo-entry-title" onCancel={(event) => {
    event.preventDefault()
    dismiss()
  }}>
    <form className="demo-form" onSubmit={submit}>
    <div className="demo-span demo-entry-heading">
      <h2 id="demo-entry-title">Add transaction</h2>
      <button type="button" className="demo-icon" title="Close transaction form" aria-label="Close transaction form" onClick={dismiss}>×</button>
    </div>
    <label>Date<input name="day" type="date" defaultValue={today()} required /></label>
    <label>Type<select value={kind} onChange={(e) => { setKind(e.target.value as Kind); setStatus('Paid') }}>
      {kinds.map((option) => <option key={option}>{option}</option>)}
    </select></label>
    <label>Event<select value={eventId} onChange={(e) => {
      setEventId(e.target.value)
      setCategory('')
      setItems(items.map((item) => ({ ...item, planId: '' })))
    }}><option value="">No event</option>{statement.events.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
    <label>Expense category{event
      ? <select value={category} onChange={(e) => {
        setCategory(e.target.value)
        setItems(items.map((item) => ({ ...item, planId: '' })))
      }} required><option value="">Choose category</option>{event.categories.map((name) => <option key={name}>{name}</option>)}</select>
      : <input name="category" />}</label>
    <label>Payment status<select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
      <option>Paid</option>{kind === 'Expense' && <><option>To Pay</option><option>To Reimburse</option></>}
    </select></label>
    <label>{kind === 'Transfer' ? 'Transfer from account' : splitAccounts ? 'Default payment account' : 'Payment account'}<select key={status} name="account">
      {status === 'To Reimburse' ? <option>Personal Funds</option> : accounts.map((account) => <option key={account}>{account}</option>)}
    </select></label>
    <label>Person in charge<input name="person" maxLength={120} required /></label>
    <label>Notes<input name="notes" maxLength={500} /></label>
    <fieldset className="demo-span grid gap-3"><legend>Items</legend>
      {items.map((item, index) => {
        const edit = (patch: Partial<typeof item>) => setItems(items.map((row) => row.id === item.id ? { ...row, ...patch } : row))
        return <div className="demo-form demo-item" key={item.id}>
          <label>Item {index + 1}<input value={item.name} onChange={(e) => edit({ name: e.target.value })} required maxLength={150} /></label>
          <label>Quantity<input value={item.quantity} onChange={(e) => edit({ quantity: e.target.value })} type="number" min="1" max="999" required /></label>
          <label>Unit price (PHP)<input value={item.price} onChange={(e) => edit({ price: e.target.value })} inputMode="decimal" required /></label>
          {splitAccounts && <label>Payment account for item {index + 1}
            <select value={item.account} onChange={(e) => edit({ account: e.target.value as Account | '' })}>
              <option value="">Use default account</option>{accounts.map((account) => <option key={account}>{account}</option>)}
            </select>
          </label>}
          {event && <label>Link planned item<select value={item.planId} onChange={(e) => edit({ planId: e.target.value })}>
            <option value="">Actual only</option>{event.plans.filter((plan) => !plan.cancelled && plan.category === category)
              .map((plan) => <option value={plan.id} key={plan.id}>{plan.name}</option>)}
          </select></label>}
          {items.length > 1 && <button type="button" onClick={() => setItems(items.filter((row) => row.id !== item.id))}>Remove item {index + 1}</button>}
        </div>
      })}
      {items.length < 25 && <button type="button" onClick={() => setItems([...items, blank()])}>Add item</button>}
    </fieldset>
    {receiptUploads && <label className="demo-span">Receipt photo or PDF<input type="file" accept={fileAccept} onChange={(e) => {
      const file = e.target.files?.[0]
      if (file && (!fileTypes.includes(file.type) || file.size > 5 * 1024 * 1024)) {
        e.target.value = ''
        setReceipt(undefined)
        setError('Choose a supported image or PDF under 5 MB.')
      } else { setReceipt(file); setExcludedItems([]); setError('') }
    }} /></label>}
    {receipt && <div className="demo-span grid gap-3">
      <ReceiptPreview file={receipt} />
      <fieldset className="demo-receipt-items">
        <legend>Items covered by this receipt</legend>
        {items.map((item, index) => <label key={item.id}>
          <input type="checkbox" checked={!excludedItems.includes(item.id)} onChange={(e) => {
            const checked = e.target.checked
            setExcludedItems((current) => checked ? current.filter((id) => id !== item.id) : [...current, item.id])
          }} />
          {item.name.trim() || 'Item ' + (index + 1)}
        </label>)}
      </fieldset>
    </div>}
    <output className="demo-span">Transaction total <strong>{money(total)}</strong></output>
    {error && <p className="demo-error demo-span" role="alert">{error}</p>}
    <div className="demo-actions demo-span"><button className="demo-primary">Save transaction</button><button type="button" onClick={dismiss}>Cancel</button></div>
    </form>
  </dialog>
}

export default function StatementLedger({ statement, change, edit, auditor, receiptUploads, initial, eventFilter = '' }: {
  statement: Statement; change: Change; edit: boolean; auditor: boolean; receiptUploads: boolean; initial?: string; eventFilter?: string
}) {
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [eventId, setEventId] = useState(eventFilter)
  const [accountFilter, setAccountFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [newest, setNewest] = useState(false)
  const [full, setFull] = useState(false)
  const [adding, setAdding] = useState(false)
  const [selected, setSelected] = useState(initial ?? '')
  const [error, setError] = useState('')
  const totals = finance(statement)
  const details = statement.entries.find((entry) => entry.id === selected)
  const reversed = new Set(statement.entries.flatMap((row) => row.reverses ? [row.reverses] : []))
  const settled = new Set(statement.entries.flatMap((row) => row.settles && !reversed.has(row.id) ? [row.settles] : []))
  const canSettle = details && details.status !== 'Paid' && !settled.has(details.id) && !reversed.has(details.id)
  const displayStatus = (entry: Entry) => reversed.has(entry.id) ? 'Reversed' : settled.has(entry.id) ? 'Settled' : entry.status
  const paymentAccounts = (entry: Entry) => {
    if (entry.status !== 'Paid') return [entry.account]
    const delta = movements(entry)
    return accounts.filter((account) => delta[account] !== 0)
  }
  const visible = ledger(statement).filter(({ entry }) => {
    const event = statement.events.find((row) => row.id === entry.eventId)?.name
    return (!type || entry.kind === type) && (!eventId || entry.eventId === eventId) &&
      (!accountFilter || paymentAccounts(entry).some((account) => account === accountFilter)) &&
      (!statusFilter || displayStatus(entry) === statusFilter) && [entry.id, entry.person, entry.category, event, ...entry.items.map((item) => item.name)]
        .join(' ').toLowerCase().includes(search.trim().toLowerCase())
  })
  if (newest) visible.reverse()

  const eventName = (entry: Entry) => statement.events.find(({ id }) => id === entry.eventId)?.name
  const entryType = (entry: Entry) => entry.reverses ? 'Reversal' : entry.kind

  function exportLedger() {
    const filename = statement.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    downloadCsv((filename || 'statement') + '-ledger.csv', [
      [...columns, 'Running Cash (PHP)', 'Running GCash (PHP)'],
      ...visible.map(({ entry, balances }) => [
        entry.day, entry.id, eventName(entry) ?? '', entry.items.map(({ name }) => name).join(' / '), entry.category,
        entry.items.length === 1 ? entry.items[0].quantity : entry.items.map(({ quantity }) => quantity).join(' / '),
        entry.items.length === 1 ? entry.items[0].price / 100 : entry.items.map(({ price }) => (price / 100).toFixed(2)).join(' / '),
        amount(entry) / 100, entryType(entry), paymentAccounts(entry).join(' / '), displayStatus(entry), entry.person,
        entry.receipt?.name ?? '', entry.notes, balances.Cash / 100, balances.GCash / 100,
      ]),
    ])
  }

  useEffect(() => {
    if (!full || adding || details) return
    const exit = (event: KeyboardEvent) => { if (event.key === 'Escape') setFull(false) }
    window.addEventListener('keydown', exit)
    return () => window.removeEventListener('keydown', exit)
  }, [full, adding, details])

  function settle(e: FormEvent<HTMLFormElement>, original: Entry) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    try {
      const entry: Entry = {
        ...original, id: crypto.randomUUID(), day: value(form, 'day'), status: 'Paid',
        kind: original.status === 'To Reimburse' ? 'Reimbursement' : 'Payment',
        account: value(form, 'account') as Account, receipt: undefined, receiptItemIndexes: undefined, settles: original.id, review: undefined, history: undefined,
      }
      if (entry.day < original.day) throw new Error('Payment date must be on or after the expense date.')
      change(() => postEntry(statement, entry))
      setError('')
    } catch (failure) { setError((failure as Error).message) }
  }

  return <div className={full ? 'demo-fullscreen grid content-start gap-4' : 'grid gap-4'}>
    <dl className="demo-panel demo-ledger-summary">
      <div><dt>Cash</dt><dd>{money(totals.balances.Cash)}</dd></div>
      <div><dt>GCash</dt><dd>{money(totals.balances.GCash)}</dd></div>
      <div><dt>Received</dt><dd>{money(totals.received)}</dd></div>
      <div><dt>Paid expenses</dt><dd>{money(totals.spent)}</dd></div>
    </dl>
    <div className="demo-panel demo-ledger-controls">
      {adding && <EntryForm statement={statement} change={change} receiptUploads={receiptUploads} close={() => setAdding(false)} />}
      <div className="demo-ledger-filters" role="group" aria-label="Ledger filters">
        <input type="search" aria-label="Search ledger" placeholder="Search ledger" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="demo-ledger-select"><select aria-label="Transaction type" value={type} onChange={(e) => setType(e.target.value)}><option value="">Type</option>
          {[...kinds, 'Payment'].map((kind) => <option key={kind}>{kind}</option>)}</select></label>
        <label className="demo-ledger-select"><select aria-label="Events" value={eventId} onChange={(e) => setEventId(e.target.value)}><option value="">Events</option>
          {statement.events.map((event) => <option value={event.id} key={event.id}>{event.name}</option>)}</select></label>
        <label className="demo-ledger-select"><select aria-label="Account" value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)}><option value="">Account</option>
          {[...accounts, 'Personal Funds'].map((account) => <option key={account}>{account}</option>)}</select></label>
        <label className="demo-ledger-select"><select aria-label="Payment status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="">Status</option>
          {['Paid', 'To Pay', 'To Reimburse', 'Settled', 'Reversed'].map((status) => <option key={status}>{status}</option>)}</select></label>
        <label className="demo-ledger-select"><select aria-label="Sort by date" value={newest ? 'newest' : 'oldest'} onChange={(e) => setNewest(e.target.value === 'newest')}>
          <option value="oldest">Date ↑</option><option value="newest">Date ↓</option>
        </select></label>
      </div>
      <div className="demo-actions demo-ledger-tools" role="group" aria-label="Ledger actions">
        <button type="button" className="demo-csv-button" title="Download filtered Ledger as CSV" aria-label="Download Ledger CSV" onClick={exportLedger}>
          <span className="demo-download-icon" aria-hidden="true">↓</span> CSV
        </button>
        {edit && <button type="button" className="demo-primary demo-icon" title="Add transaction" aria-label="Add transaction" aria-expanded={adding}
          aria-haspopup="dialog" onClick={() => { setAdding(true); setSelected('') }}><span aria-hidden="true">+</span></button>}
        <button type="button" className="demo-icon" title={full ? 'Exit fullscreen' : 'Fullscreen spreadsheet'}
          aria-label={full ? 'Exit fullscreen' : 'Fullscreen spreadsheet'} onClick={() => setFull(!full)}>
          <span aria-hidden="true">{full ? '×' : '⛶'}</span>
        </button>
      </div>
    </div>
    {!full && <ul className="demo-mobile-ledger" aria-label="Ledger transactions">
      {visible.map(({ entry, balances }) => (
        <li key={entry.id}>
          <button type="button" className="demo-mobile-transaction" aria-haspopup="dialog"
            onClick={() => { setSelected(entry.id); setAdding(false); setError('') }}>
            <span className="demo-mobile-transaction-main">
              <strong>{entry.items.map(({ name }) => name).join(' / ')}</strong>
              <span>{entry.day} · {entryType(entry)}{eventName(entry) && <> · {eventName(entry)}</>}</span>
            </span>
            <span className="demo-mobile-transaction-amount">
              <strong>{money(amount(entry))}</strong><span>{displayStatus(entry)}</span>
            </span>
            <span className="demo-mobile-transaction-balances">
              {paymentAccounts(entry).join(' / ')} · Cash {money(balances.Cash)} · GCash {money(balances.GCash)}
            </span>
          </button>
        </li>
      ))}
      {!visible.length && <li className="demo-panel">No matching transactions.</li>}
    </ul>}
    <div className={full ? 'min-w-0' : 'demo-ledger-spreadsheet min-w-0'}>
    <Sheet title="General ledger" columns={[...columns, 'Running Balance']}
      rows={visible.map(({ entry, balances }) => ({ id: entry.id, cells: [
        entry.day, <button className="demo-link" aria-haspopup="dialog"
          onClick={() => { setSelected(entry.id); setAdding(false); setError('') }}>{entry.id.slice(0, 8)}</button>,
        eventName(entry) ?? '—', entry.items.map((item) => item.name).join(' / '), entry.category || '—',
        entry.items.map((item) => item.quantity).join(' / '), entry.items.map((item) => money(item.price)).join(' / '), money(amount(entry)),
        entryType(entry), paymentAccounts(entry).join(' / '),
        <span className="demo-status">{displayStatus(entry)}</span>,
        entry.person, entry.receipt?.name ?? '—', entry.notes || '—',
        <><div>Cash {money(balances.Cash)}</div><div>GCash {money(balances.GCash)}</div></>,
      ] }))} />
    </div>
    {details && <StatementDialog title="Transaction details" key={details.id} close={() => setSelected('')}>{() =>
      <div className="grid gap-4">
      <p>{details.id} · {details.day} · {details.review ?? 'Pending review'}</p>
      <ul>{details.items.map((item, index) => <li key={index}>{item.name} · {item.quantity} × {money(item.price)} = {money(item.quantity * item.price)}
        {details.kind === 'Expense' && details.status === 'Paid' && <> · {item.account ?? details.account}</>}</li>)}</ul>
      {details.receipt && <div className="grid gap-3">
        <ReceiptPreview file={details.receipt} />
        <h3 className="font-semibold">Items linked to receipt</h3>
        <ReceiptItems entry={details} />
      </div>}
      {receiptUploads && !details.receipt && (edit || auditor) && <AttachReceipt entry={details} change={change} />}
      {Boolean(details.history?.length) && <div><h3>Activity history</h3><ul>{details.history?.map((event) =>
        <li key={event.id}>{new Date(event.at).toLocaleString()} · {event.detail}</li>)}</ul></div>}
      {edit && <form className="demo-form" onSubmit={(e) => {
        e.preventDefault()
        const form = new FormData(e.currentTarget)
        const person = value(form, 'person')
        if (!person) { setError('Enter the person in charge.'); return }
        const notes = value(form, 'notes')
        const audit = { id: crypto.randomUUID(), at: new Date().toISOString(), detail: 'Treasurer updated transaction details.' }
        change((current) => ({ ...current, entries: current.entries.map((row) => row.id === details.id
          ? { ...row, person, notes, history: [...(row.history ?? []), audit] } : row) }))
        setError('')
      }}>
        <label>Person in charge<input name="person" defaultValue={details.person} required maxLength={120} /></label>
        <label>Notes<input name="notes" defaultValue={details.notes} maxLength={500} /></label>
        <button>Save details</button>
      </form>}
      {edit && canSettle && <form className="demo-form" onSubmit={(e) => settle(e, details)}>
        <label>Payment date<input name="day" type="date" defaultValue={today()} required /></label>
        <label>Pay from<select name="account">{accounts.map((account) => <option key={account}>{account}</option>)}</select></label>
        <button>Record payment of {money(amount(details))}</button>
      </form>}
      {edit && details.status === 'Paid' && !details.reverses && !reversed.has(details.id) && <form className="demo-form" onSubmit={(e) => {
        e.preventDefault()
        const reason = value(new FormData(e.currentTarget), 'reason')
        if (!reason) return
        const reversal: Entry = { ...details, id: crypto.randomUUID(), day: [today(), details.day].sort()[1],
          reverses: details.id, settles: undefined, notes: reason, receipt: undefined, receiptItemIndexes: undefined, review: undefined, history: undefined }
        change((current) => ({ ...current, entries: [...current.entries, reversal] }))
      }}><label>Reversal reason<input name="reason" required maxLength={500} /></label><button>Reverse transaction</button></form>}
      {auditor && <div className="demo-actions">{(['Verified', 'Flagged'] as const).map((review) =>
        <button key={review} onClick={() => {
          const audit = { id: crypto.randomUUID(), at: new Date().toISOString(), detail: 'Auditor: ' + review }
          change((current) => ({ ...current, entries: current.entries.map((row) =>
            row.id === details.id ? { ...row, review, history: [...(row.history ?? []), audit] } : row) }))
        }}>{review === 'Verified' ? 'Verify' : 'Flag'}</button>)}</div>}
      {error && <p className="demo-error" role="alert">{error}</p>}
      </div>
    }</StatementDialog>}
  </div>
}
