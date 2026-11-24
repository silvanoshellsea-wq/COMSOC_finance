import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { money } from './api'
import { downloadCsv } from './csv'
import type { User } from './api'
import StatementAllocation from './StatementAllocation'
import StatementDialog from './StatementDialog'
import StatementLedger, { ReceiptItems, ReceiptPreview, Sheet, today, value } from './StatementLedger'
import type { Change } from './StatementLedger'
import { accounts, amount, finance, ledger, movements, parseMoney } from './statementModel'
import { useStatements } from './useStatements'
import ThemePicker from './ThemePicker'
import type { Account, Statement } from './statementModel'
import './statementDemo.css'

const pages = ['Dashboard', 'General Ledger', 'Final Allocation', 'Cash & GCash', 'Receipts', 'Reconciliation', 'Reports'] as const
type Page = typeof pages[number] | 'Financial Workspaces'

export default function StatementDemo({ demo, user, onLogout, receiptUploads }: {
  demo: boolean; user: User; onLogout: () => Promise<void>; receiptUploads: boolean
}) {
  const { statements, change: updateStatement, loading, pending, error: storageError, reload } = useStatements(demo)
  const [selected, select] = useState('')
  const [page, go] = useState<Page>('Dashboard')
  const [logoutError, setLogoutError] = useState('')
  const [eventId, setEventId] = useState('')
  const [entryId, setEntryId] = useState('')
  const [ledgerEvent, setLedgerEvent] = useState('')
  const [menu, setMenu] = useState(false)
  const menuToggle = useRef<HTMLButtonElement>(null)
  const menuClose = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (menu) menuClose.current?.focus()
  }, [menu])
  function closeMenu() {
    setMenu(false)
    menuToggle.current?.focus()
  }
  const statement = statements.find(({ id }) => id === selected)
  const treasurer = user.role === 'treasurer'
  const ready = !loading && !storageError
  const editable = treasurer && ready && !statement?.archived
  const change: Change = (update) => updateStatement(selected, (current) => current && update(current))
  useEffect(() => {
    if (!pending && !storageError) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [pending, storageError])
  const selectStatement = (id: string) => {
    select(id)
    setEventId('')
    setEntryId('')
    setLedgerEvent('')
  }
  const navigate = (next: Page) => {
    go(next)
    if (next === 'Financial Workspaces') select('')
    setMenu(false)
    setEventId('')
    setEntryId('')
    setLedgerEvent('')
    window.scrollTo(0, 0)
  }

  const logout = <><button disabled={Boolean(pending || storageError)} onClick={() => {
    setLogoutError('')
    void onLogout().catch((error: unknown) => setLogoutError(error instanceof Error ? error.message : 'Could not sign out.'))
  }}>Sign out</button>{logoutError && <p className="demo-error" role="alert">{logoutError}</p>}</>
  const status = <>{pending > 0 && <p role="status" className="demo-notice">Saving changes…</p>}
    {storageError && <div className="demo-panel mb-4">
      <p className="demo-error" role="alert">{storageError} {statements.length > 0 ? 'Unsaved changes may appear on this screen.' : ''}</p>
      <button className="demo-link" disabled={Boolean(pending)} onClick={() => void reload()}>Reload saved statements</button>
    </div>}</>

  if (!statement) return <div className="statement-demo demo-chooser">
    <header className="demo-chooser-bar">
      <span className="demo-brand"><span className="demo-brand-mark" aria-hidden="true">C</span>COMSOC Finance</span>
      <div className="demo-actions"><ThemePicker /><span className="demo-user">{user.display_name} · {user.role}</span>{logout}</div>
    </header>
    <main className="demo-chooser-content">
      {status}
      {loading && <p role="status">Loading saved statements…</p>}
      <Workspaces statements={statements} demo={demo}
        change={(id, update) => updateStatement(id, (current) => current && update(current))}
        edit={treasurer && ready} open={(id) => { selectStatement(id); navigate('Dashboard') }}
        create={(row) => updateStatement(row.id, () => row)}
        remove={(id) => updateStatement(id, () => undefined)} />
      {!pending && !storageError && <a className="mt-4 inline-block underline" href={demo ? '/' : '/workspace-demo'}>
        {demo ? 'Return to saved workspaces' : 'Open practice workspaces'}
      </a>}
      <div className="demo-folder-row demo-local-records">
        <a className="demo-folder-open" href="/local-records">
          <span className="demo-folder-icon" aria-hidden="true" />
          <span className="demo-folder-name"><strong>Existing local records</strong><span>Stored in your local database</span></span>
        </a>
      </div>
    </main>
  </div>

  return <div className="statement-demo">
    <aside className="demo-navigation" onKeyDown={(event) => {
      if (menu && event.key === 'Escape') closeMenu()
    }}>
      <div className="demo-sidebar-header">
        <button className="demo-brand" title="Return to Financial Workspaces" onClick={() => navigate('Financial Workspaces')}>
          <span className="demo-brand-mark" aria-hidden="true">C</span><span>COMSOC Finance</span>
        </button>
        <span className="demo-mobile-brand"><span className="demo-brand-mark" aria-hidden="true">C</span>COMSOC Finance</span>
        <button className="demo-mobile-menu" ref={menuToggle} aria-expanded={menu} aria-controls="statement-menu" onClick={() => setMenu(!menu)}>
          <span className={menu ? 'demo-menu-icon is-open' : 'demo-menu-icon'} aria-hidden="true" />
          <span>{menu ? 'Close menu' : 'Menu'}</span>
        </button>
      </div>
      {menu && <button className="demo-menu-backdrop" tabIndex={-1} aria-label="Dismiss menu" onClick={closeMenu} />}
      <div id="statement-menu" className={menu ? 'demo-menu is-open' : 'demo-menu'}>
        <div className="demo-drawer-heading">
          <strong>COMSOC Finance</strong>
          <button type="button" className="demo-icon" ref={menuClose} aria-label="Close menu" onClick={closeMenu}>×</button>
        </div>
        <nav aria-label="Statement pages">
          {pages.map((name) => <button key={name} aria-current={page === name ? 'page' : undefined}
            onClick={() => navigate(name)}>{name}</button>)}
        </nav>
        <button type="button" className="demo-sidebar-return demo-mobile-return" onClick={() => navigate('Financial Workspaces')}>
          <span aria-hidden="true">←</span> Back to Financial Workspaces
        </button>
        <div className="demo-sidebar-account">
          <span className="demo-sidebar-avatar" aria-hidden="true">{user.display_name.trim().slice(0, 1).toUpperCase() || '?'}</span>
          <div className="demo-sidebar-identity"><strong>{user.display_name}</strong><span>{user.role}</span></div>
          <ThemePicker />
          {logout}
        </div>
      </div>
    </aside>
    <main className="demo-content">
      <header className="demo-top demo-top-with-back">
        <button type="button" className="demo-icon demo-workspace-back" aria-label="Back to Financial Workspaces"
          title="Back to Financial Workspaces" onClick={() => navigate('Financial Workspaces')}>←</button>
        <div><div className="demo-tag">{statement.name}{demo && ' · Demo'}</div><h1>{page}</h1></div>
      </header>
      {status}
      {statement.archived && <p className="demo-notice">This statement is archived. Reopen it in Financial Workspaces to make changes.</p>}
      {page === 'General Ledger' && <StatementLedger key={[selected, user.role, ledgerEvent, entryId].join(':')} statement={statement} change={change}
        edit={editable} auditor={ready && !treasurer && !statement.archived} receiptUploads={receiptUploads}
        initial={entryId} eventFilter={ledgerEvent} />}
      {page === 'Final Allocation' && <StatementAllocation key={selected} statement={statement} change={change}
        edit={editable} eventId={eventId} openEvent={(id) => { setEventId(id); window.scrollTo(0, 0) }}
        openLedger={(event, entry) => { navigate('General Ledger'); setLedgerEvent(event); setEntryId(entry ?? '') }} />}
      {page === 'Dashboard' && <Dashboard statement={statement} openLedger={() => navigate('General Ledger')}
        openAllocation={() => navigate('Final Allocation')} />}
      {page === 'Cash & GCash' && <Cash statement={statement} openEntry={(id) => { navigate('General Ledger'); setEntryId(id) }} />}
      {page === 'Receipts' && (receiptUploads
        ? <EventReceipts statement={statement} openEntry={(id) => { navigate('General Ledger'); setEntryId(id) }} />
        : <p className="demo-panel">Receipt uploads are disabled on this hosted installation.</p>)}
      {page === 'Reconciliation' && <Reconciliation key={selected} statement={statement} change={change} edit={editable} />}
      {page === 'Reports' && <div className="grid gap-4">
        <section className="demo-panel demo-actions justify-between">
          <div><h2>Consolidated Financial Statement</h2><p className="demo-notice !mb-0">{statement.name}</p></div>
          <button className="demo-primary" onClick={() => exportStatement(statement, demo)}>↓ Download CSV</button>
        </section>
        <Summary statement={statement} />
        <StatementAllocation statement={statement} change={change} edit={false} eventId=""
          openEvent={(id) => { navigate('Final Allocation'); setEventId(id) }}
          openLedger={() => navigate('General Ledger')} />
      </div>}
    </main>
  </div>
}

function exportStatement(statement: Statement, demo: boolean) {
  const totals = finance(statement)
  const php = (centavos: number) => centavos / 100
  const events = new Map(statement.events.map(({ id, name }) => [id, name]))
  const entries = ledger(statement)
  const name = statement.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'statement'
  downloadCsv(name + '-consolidated.csv', [
    ['Consolidated Financial Statement', statement.name],
    ['Academic year', statement.year],
    ['Data source', demo ? 'Demo workspace' : 'Saved workspace'],
    [],
    ['Financial Summary', 'PHP'],
    ['Opening Cash', php(statement.opening.Cash)], ['Opening GCash', php(statement.opening.GCash)],
    ['Recorded Cash', php(totals.balances.Cash)], ['Recorded GCash', php(totals.balances.GCash)],
    ['Funds received', php(totals.received)], ['Expenses paid', php(totals.spent)],
    ['Outstanding payments', php(totals.payments)], ['Reimbursements owed', php(totals.reimbursements)],
    ['Total allocated', php(totals.allocated)], ['Unallocated budget', php(totals.unallocated)],
    ['Available event budget', php(totals.available)], ['Projected remaining', php(totals.projected)],
    [],
    ['Final Allocation'],
    ['Event', 'Allocated (PHP)', 'Spent (PHP)', 'To Pay (PHP)', 'Available (PHP)'],
    ...statement.events.map((event) => {
      const total = finance(statement, event.id)
      return [event.name, php(total.allocated), php(total.spent), php(total.payments + total.reimbursements), php(total.available)]
    }),
    [],
    ['General Ledger'],
    ['Date', 'Transaction ID', 'Event', 'Category', 'Items', 'Type', 'Payment status', 'Person in charge', 'Amount (PHP)',
      'Cash change (PHP)', 'GCash change (PHP)', 'Cash after (PHP)', 'GCash after (PHP)', 'Receipt filename', 'Notes'],
    ...entries.map(({ entry, balances }) => {
      const delta = movements(entry)
      return [
        entry.day, entry.id, events.get(entry.eventId) ?? '', entry.category, entry.items.map(({ name, quantity }) => quantity + ' × ' + name).join(' / '),
        entry.reverses ? 'Reversal of ' + entry.reverses : entry.kind, entry.status, entry.person, php(amount(entry)),
        php(delta.Cash), php(delta.GCash), php(balances.Cash), php(balances.GCash), entry.receipt?.name ?? '', entry.notes,
      ]
    }),
    [],
    ['Cash Reconciliation'],
    ['Date', 'Account', 'Recorded (PHP)', 'Counted (PHP)', 'Difference (PHP)', 'Notes'],
    ...(statement.counts ?? []).map((count) => [count.day, count.account, php(count.expected), php(count.actual), php(count.actual - count.expected), count.notes]),
  ])
}

function EventReceipts({ statement, openEntry }: { statement: Statement; openEntry: (id: string) => void }) {
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [selectedReceipt, setSelectedReceipt] = useState('')
  const receipts = statement.entries.flatMap((entry) => entry.receipt ? [{ entry, file: entry.receipt }] : [])
  const groups = statement.events.map(({ id, name }) => ({
    id, name, receipts: receipts.filter(({ entry }) => entry.eventId === id),
    missing: statement.entries.filter((entry) => entry.eventId === id && !entry.receipt && !entry.reverses),
  }))
  const unassigned = receipts.filter(({ entry }) => !statement.events.some(({ id }) => id === entry.eventId))
  const unassignedMissing = statement.entries.filter((entry) => !entry.receipt && !entry.reverses &&
    !statement.events.some(({ id }) => id === entry.eventId))
  if (unassigned.length || unassignedMissing.length) groups.push({
    id: '', name: 'No event assigned',
    receipts: unassigned, missing: unassignedMissing,
  })
  const group = groups.find(({ id }) => id === selectedGroup)
  const receipt = group?.receipts.find(({ entry }) => entry.id === selectedReceipt)

  if (receipt) return <section className="demo-panel grid gap-3">
    <div className="demo-actions">
      <button className="demo-icon" title="Back to event receipts" aria-label="Back to event receipts" onClick={() => setSelectedReceipt('')}>←</button>
      <h2>{group?.name}</h2>
    </div>
    <ReceiptPreview key={receipt.entry.id} file={receipt.file} />
    <h3 className="font-semibold">Items linked to receipt</h3>
    <ReceiptItems entry={receipt.entry} />
    <button className="demo-link" onClick={() => openEntry(receipt.entry.id)}>Open Ledger transaction</button>
  </section>

  if (group) return <section className="grid gap-3">
    <div className="demo-actions">
      <button className="demo-icon" title="Back to receipt events" aria-label="Back to receipt events" onClick={() => setSelectedGroup(null)}>←</button>
      <h2 className="font-semibold">{group.name}</h2>
    </div>
    <Sheet title={group.name + ' receipts'} columns={['Receipt', 'Transaction date', 'Person in charge']}
      rows={group.receipts.map(({ entry, file }) => ({ id: entry.id, cells: [
        <button className="demo-link" onClick={() => setSelectedReceipt(entry.id)}>{file.name}</button>, entry.day, entry.person,
      ] }))} />
    {!statement.archived && group.missing.length > 0 && <>
      <h3 className="font-semibold">Transactions without receipts</h3>
      <Sheet title="Transactions without receipts" columns={['Date', 'Items', 'Receipt']}
        rows={group.missing.map((entry) => ({ id: entry.id, cells: [entry.day, entry.items.map((item) => item.name).join(' / '),
          <button className="demo-link" onClick={() => openEntry(entry.id)}>Add receipt</button>,
        ] }))} />
    </>}
  </section>

  return groups.length ? <ul className="demo-folder-list">
    {groups.map((group) => <li className="demo-folder-row" key={group.id}>
      <button className="demo-folder-open" onClick={() => setSelectedGroup(group.id)}>
        <span className="demo-folder-icon" aria-hidden="true" />
        <span className="demo-folder-name"><strong>{group.name}</strong></span>
        <span className="demo-status">{group.receipts.length} {group.receipts.length === 1 ? 'receipt' : 'receipts'}</span>
      </button>
    </li>)}
  </ul> : <p className="demo-panel">No events or receipts in this statement.</p>
}

type WorkspaceAction = { kind: 'create' } | { kind: 'edit' | 'rename' | 'delete'; id: string }

function Workspaces({ statements, demo, edit, open, create, change, remove }: {
  statements: Statement[]; demo: boolean; edit: boolean; open: (id: string) => void;
  create: (statement: Statement) => void; change: (id: string, update: (statement: Statement) => Statement) => void;
  remove: (id: string) => void
}) {
  const [action, setAction] = useState<WorkspaceAction>()
  const [error, setError] = useState('')
  const target = action && 'id' in action ? statements.find(({ id }) => id === action.id) : undefined
  const title = action ? { create: 'New financial statement', edit: 'Edit statement', rename: 'Rename statement', delete: 'Delete statement' }[action.kind] : ''

  function start(next: WorkspaceAction) {
    setError('')
    setAction(next)
  }

  function save(e: FormEvent<HTMLFormElement>, dismiss: () => void) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    try {
      if (action?.kind === 'rename' && target) {
        const name = value(data, 'name')
        if (!name) throw new Error('Enter a statement name.')
        change(target.id, (current) => ({ ...current, name }))
      } else {
        const year = value(data, 'year')
        const description = value(data, 'description')
        if (!year) throw new Error('Enter an academic year.')
        if (action?.kind === 'create') {
          const name = value(data, 'name')
          if (!name) throw new Error('Enter a statement name.')
          create({ id: crypto.randomUUID(), name, year, description, archived: false, events: [], entries: [],
            opening: { Cash: parseMoney(value(data, 'cash') || '0'), GCash: parseMoney(value(data, 'gcash') || '0') } })
        } else if (target) {
          change(target.id, (current) => ({ ...current, year, description, archived: value(data, 'status') === 'Archived' }))
        }
      }
      dismiss()
    } catch (failure) { setError((failure as Error).message) }
  }

  return <>
    <header className="demo-chooser-heading demo-workspace-heading">
      <div><h1>{demo ? 'Practice Workspaces' : 'Financial Workspaces'}</h1></div>
      {edit && <button type="button" className="demo-primary demo-icon" title="Create financial statement" aria-label="Create financial statement"
        aria-haspopup="dialog" onClick={() => start({ kind: 'create' })}><span aria-hidden="true">+</span></button>}
    </header>
    <ul className="demo-folder-list">
      {statements.map((row) => {
        const totals = finance(row)
        return <li className="demo-folder-row" key={row.id}>
          <button type="button" className="demo-folder-open" aria-label={'Open ' + row.name} onClick={() => open(row.id)}>
            <span className="demo-folder-icon" aria-hidden="true" />
            <span className="demo-folder-name"><strong>{row.name}</strong><span>{row.year}{row.description && ' · ' + row.description}</span></span>
            <span className="demo-folder-balances">Cash {money(totals.balances.Cash)} <span>GCash {money(totals.balances.GCash)}</span></span>
            <span className="demo-status">{row.archived ? 'Archived' : 'Active'}</span>
          </button>
          {edit && <details className="demo-folder-options" name="statement-options" onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false
          }} onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.currentTarget.open = false
              event.currentTarget.querySelector('summary')?.focus()
            }
          }}>
            <summary title="Statement options" aria-label={'Options for ' + row.name}>⋯</summary>
            <div className="demo-folder-menu">{(['edit', 'rename', 'delete'] as const).map((kind) =>
              <button type="button" key={kind} className={kind === 'delete' ? 'demo-delete-option' : undefined} onClick={(event) => {
                const details = event.currentTarget.closest('details')
                if (details) {
                  details.open = false
                  details.querySelector('summary')?.focus()
                }
                start({ kind, id: row.id })
              }}>{kind === 'edit' ? 'Edit' : kind === 'rename' ? 'Rename' : 'Delete'}</button>
            )}</div>
          </details>}
        </li>
      })}
      {!statements.length && <li className="demo-panel">No {demo ? 'sample ' : 'saved '}statements.</li>}
    </ul>
    {edit && action && <StatementDialog title={title} close={() => setAction(undefined)}>{(dismiss) =>
      action.kind === 'delete' && target ? <div className="grid gap-4">
        <p>Remove <strong>{target.name}</strong> from {demo ? 'this demo session' : 'saved workspaces'}?</p>
        <div className="demo-actions">
          <button type="button" className="demo-danger" onClick={() => { remove(target.id); dismiss() }}>Delete statement</button>
          <button type="button" onClick={dismiss}>Cancel</button>
        </div>
      </div> : <form className="demo-form" onSubmit={(e) => save(e, dismiss)}>
        {action.kind !== 'edit' && <label>Statement name<input name="name" defaultValue={target?.name} maxLength={150} required /></label>}
        {action.kind !== 'rename' && <>
          <label>Academic year<input name="year" defaultValue={target?.year} maxLength={40} required /></label>
          <label>Description<input name="description" defaultValue={target?.description} maxLength={250} /></label>
        </>}
        {action.kind === 'create' && <>
          <label>Opening Cash (PHP)<input name="cash" inputMode="decimal" placeholder="0.00" /></label>
          <label>Opening GCash (PHP)<input name="gcash" inputMode="decimal" placeholder="0.00" /></label>
        </>}
        {action.kind === 'edit' && <label>Status<select name="status" defaultValue={target?.archived ? 'Archived' : 'Active'}>
          <option>Active</option><option>Archived</option>
        </select></label>}
        {error && <p className="demo-error demo-span" role="alert">{error}</p>}
        <div className="demo-actions demo-span">
          <button className="demo-primary">{action.kind === 'create' ? 'Create statement' : action.kind === 'rename' ? 'Rename' : 'Save changes'}</button>
          <button type="button" onClick={dismiss}>Cancel</button>
        </div>
      </form>
    }</StatementDialog>}
  </>
}

function Summary({ statement }: { statement: Statement }) {
  const totals = finance(statement)
  const metrics = [
    ['Funds received', totals.received], ['Expenses paid', totals.spent], ['Cash balance', totals.balances.Cash],
    ['GCash balance', totals.balances.GCash], ['Allocated budget', totals.allocated], ['Unallocated budget', totals.unallocated],
    ['Outstanding payments', totals.payments], ['Reimbursements owed', totals.reimbursements], ['Projected remaining money', totals.projected],
  ] as const
  return <dl className="demo-metrics">{metrics.map(([label, total]) => <div className="demo-panel" key={label}>
    <dt>{label}</dt><dd>{money(total)}</dd></div>)}</dl>
}

function Dashboard({ statement, openLedger, openAllocation }: {
  statement: Statement; openLedger: () => void; openAllocation: () => void
}) {
  const totals = finance(statement)
  const latest = ledger(statement).slice(-5).reverse()
  const commitments = totals.payments + totals.reimbursements
  const used = totals.spent + commitments
  const utilization = totals.allocated ? Math.round(used / totals.allocated * 100) : 0

  return <div className="demo-dashboard">
    <section className="demo-balance">
      <div><h2>Recorded balance</h2><strong>{money(totals.balances.Cash + totals.balances.GCash)}</strong></div>
      <dl><div><dt>Cash</dt><dd>{money(totals.balances.Cash)}</dd></div>
        <div><dt>GCash</dt><dd>{money(totals.balances.GCash)}</dd></div>
        <div><dt>Projected remaining</dt><dd>{money(totals.projected)}</dd></div></dl>
    </section>
    <section className="demo-panel demo-budget">
      <div className="demo-actions"><h2>Budget utilization</h2><button className="demo-link" onClick={openAllocation}>View allocation</button></div>
      <p><strong>{money(used)}</strong> used or committed of {money(totals.allocated)}</p>
      <progress max={100} value={Math.max(0, Math.min(100, utilization))} aria-label="Budget utilized" />
      <p className={totals.available < 0 ? 'demo-error' : ''}>
        {money(Math.abs(totals.available))} {totals.available < 0 ? 'over budget' : 'available'}
      </p>
    </section>
    <section className="demo-panel demo-activity">
      <div className="demo-actions"><h2>Recent activity</h2><button className="demo-link" onClick={openLedger}>Open ledger</button></div>
      {latest.length ? <ul>{latest.map(({ entry }) => (
        <li key={entry.id}><div><strong>{entry.items.map(({ name }) => name).join(' / ')}</strong>
          <span>{entry.day} · {entry.reverses ? 'Reversal' : entry.kind}</span></div><strong>{money(amount(entry))}</strong></li>
      ))}</ul> : <p>No transactions in this statement yet.</p>}
    </section>
    <section className="demo-panel demo-flow">
      <h2>Money and commitments</h2>
      <dl><div><dt>Funds received</dt><dd>{money(totals.received)}</dd></div>
        <div><dt>Expenses paid</dt><dd>{money(totals.spent)}</dd></div>
        <div><dt>Outstanding payments</dt><dd>{money(totals.payments)}</dd></div>
        <div><dt>Reimbursements owed</dt><dd>{money(totals.reimbursements)}</dd></div>
        <div><dt>Unallocated budget</dt><dd>{money(totals.unallocated)}</dd></div></dl>
    </section>
  </div>
}

function Cash({ statement, openEntry }: { statement: Statement; openEntry: (id: string) => void }) {
  const [accountFilter, setAccountFilter] = useState<Account | ''>('')
  const totals = finance(statement)
  const history = ledger(statement).reverse().flatMap(({ entry, balances }) => {
    const delta = movements(entry)
    return accounts.filter((account) => delta[account] !== 0 && (!accountFilter || accountFilter === account)).map((account) => ({
      id: entry.id + '-' + account,
      cells: [
        entry.day,
        <button className="demo-link" onClick={() => openEntry(entry.id)}>{entry.items.map(({ name }) => name).join(' / ')}</button>,
        entry.reverses ? 'Reversal' : entry.kind,
        account,
        delta[account] > 0 ? money(delta[account]) : '—',
        delta[account] < 0 ? money(-delta[account]) : '—',
        money(balances[account]),
      ],
    }))
  })
  return <div className="grid gap-4">
    <Sheet title="Account balances" columns={['Account', 'Opening', 'Received', 'Paid', 'Net Transfers', 'Recorded Balance']}
    rows={accounts.map((account) => {
      let received = 0, paid = 0, transfers = 0
      for (const entry of statement.entries) {
        const delta = movements(entry)[account]
        if (entry.kind === 'Transfer') transfers += delta
        else if (delta >= 0) received += delta
        else paid -= delta
      }
      return { id: account, cells: [account, ...[statement.opening[account], received, paid, transfers, totals.balances[account]].map(money)] }
    })} />
    <section className="demo-panel grid gap-3">
      <div className="demo-actions justify-between">
        <h2>Account movement history</h2>
        <label>Account<select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value as Account | '')}>
          <option value="">All accounts</option>
          {accounts.map((account) => <option key={account}>{account}</option>)}
        </select></label>
      </div>
      <Sheet title="Account movement history" columns={['Date', 'Ledger Transaction', 'Type', 'Account', 'Money In', 'Money Out', 'Balance After']}
        rows={history} />
    </section>
  </div>
}

function Reconciliation({ statement, change, edit }: { statement: Statement; change: Change; edit: boolean }) {
  const [error, setError] = useState('')
  return <div className="grid gap-4">
    <Sheet title="Reconciliation history" columns={['Date', 'Account', 'Recorded', 'Counted', 'Difference', 'Notes']}
      rows={(statement.counts ?? []).map((row) => ({ id: row.id, cells: [row.day, row.account, money(row.expected),
        money(row.actual), money(row.actual - row.expected), row.notes] }))} />
    {edit && <form className="demo-panel demo-form" onSubmit={(e) => {
      e.preventDefault()
      const form = e.currentTarget
      const data = new FormData(form)
      try {
        const account = value(data, 'account') as Account
        const day = value(data, 'day')
        const expected = ledger(statement).filter(({ entry }) => entry.day <= day).at(-1)?.balances[account] ?? statement.opening[account]
        const row = { id: crypto.randomUUID(), account, day, expected, actual: parseMoney(value(data, 'actual')), notes: value(data, 'notes') }
        change((current) => ({ ...current, counts: [...(current.counts ?? []), row] }))
        setError('')
        form.reset()
      } catch (failure) { setError((failure as Error).message) }
    }}>
      <h2 className="demo-span">Record account count</h2>
      <label>Account<select name="account">{accounts.map((account) => <option key={account}>{account}</option>)}</select></label>
      <label>Count date<input name="day" type="date" defaultValue={today()} required /></label>
      <label>Counted amount (PHP)<input name="actual" inputMode="decimal" required /></label>
      <label>Notes<input name="notes" maxLength={500} /></label>
      <button className="demo-primary">Record count</button>
    </form>}
    {error && <p className="demo-error" role="alert">{error}</p>}
  </div>
}
