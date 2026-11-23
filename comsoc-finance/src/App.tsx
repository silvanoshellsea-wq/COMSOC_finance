import { useEffect, useState } from 'react'
import { api } from './api'
import type { Row, Session, User } from './api'
import Finance, { resources } from './Finance'
import type { FinanceData } from './Finance'
import { RecordForm } from './Records'

const sections = [
  { id: 'dashboard', label: 'Dashboard', description: 'Review your balances, spending, and commitments.' },
  { id: 'ledger', label: 'Ledger', description: 'Review income, expenses, transfers, and verification history.' },
  { id: 'allocations', label: 'Final Allocation', description: 'Compare approved allocations, spending, and outstanding commitments.' },
  { id: 'budgets', label: 'Event Budgets', description: 'Manage events, allocations, and budget transfers.' },
  { id: 'receipts', label: 'Receipts', description: 'Upload and find supporting documents.' },
  { id: 'purchases', label: 'Purchases', description: 'Record itemized purchases and their payment obligations.' },
  { id: 'accounts', label: 'Cash & GCash', description: 'View balances and transfer funds between accounts.' },
  { id: 'reimbursements', label: 'Reimbursements', description: 'Track payments and reimbursements, including partial settlements.' },
  { id: 'loans', label: 'Loans', description: 'Track funds borrowed, lent, and repaid.' },
  { id: 'reconciliation', label: 'Cash Reconciliation', description: 'Compare counted funds against recorded balances.' },
  { id: 'reports', label: 'Financial Reports', description: 'Filter and export reports from your financial records.' },
  { id: 'profile', label: 'Profile', description: 'Manage how your name appears in the workspace.' },
] as const

function currentSection() {
  return sections.find(({ id }) => '#' + id === window.location.hash) ?? sections[0]
}

function Workspace({ user, reloadSession }: { user: User; reloadSession: () => Promise<void> }) {
  const [section, setSection] = useState(currentSection)
  const [data, setData] = useState<FinanceData>()
  const [error, setError] = useState('')
  const [revision, refresh] = useState(0)

  useEffect(() => {
    const update = () => setSection(currentSection())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  useEffect(() => {
    let ignore = false
    async function load() {
      try {
        const [summary, rows] = await Promise.all([
          api<Record<string, number>>('summary'),
          Promise.all(resources.map(async (resource) => [resource, await api<Row[]>(resource)] as const)),
        ])
        if (!ignore) {
          setData({ ...Object.fromEntries(rows), summary } as FinanceData)
          setError('')
        }
      } catch (failure) {
        if (!ignore) setError(failure instanceof Error ? failure.message : 'Could not load records.')
      }
    }
    void load()
    return () => { ignore = true }
  }, [revision])

  async function logout() {
    try {
      await api('logout', {})
      await reloadSession()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not sign out.')
    }
  }

  return (
    <div className="workspace">
      <aside className="sidebar print:hidden">
        <a href="#dashboard" className="brand">
          <span className="brand-mark" aria-hidden="true">C</span>
          <span>COMSOC <small>Finance</small></span>
        </a>
        <nav className="navigation" aria-label="Finance modules">
          {sections.map(({ id, label }) => (
            <a key={id} href={'#' + id} aria-current={id === section.id ? 'page' : undefined}>{label}</a>
          ))}
        </nav>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 px-2 text-sm lg:mt-8">
          <span className="capitalize">{user.display_name} · {user.role}</span>
          <button className="min-h-11 underline underline-offset-4" onClick={() => void logout()}>Sign out</button>
        </div>
      </aside>
      <main className="content">
        <header className="page-heading">
          <h1>{section.label}</h1>
          <p>{section.description}</p>
        </header>
        {error && <div className="panel mb-4">
          <p role="alert">{error}</p>
          <button className="action" onClick={() => { refresh((value) => value + 1); void reloadSession() }}>Retry</button>
        </div>}
        <div className="grid min-w-0 gap-4">
          {section.id === 'profile' ? (
            <>
              <RecordForm title="Profile settings" resource="profile" fields={[{ key: 'displayName', label: 'Display name' }]}
                onSaved={() => void reloadSession()} />
              <RecordForm title="Change password and sign out" resource="password" fields={[
                { key: 'currentPassword', label: 'Current password', type: 'password', autoComplete: 'current-password' },
                { key: 'newPassword', label: 'New password (at least 12 characters)', type: 'password' },
              ]} onSaved={() => void reloadSession()} />
            </>
          ) : data ? (
            <Finance key={section.id} section={section.id} data={data} user={user} refresh={() => refresh((value) => value + 1)} />
          ) : !error && <p role="status">Loading financial records…</p>}
        </div>
      </main>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState<Session>()
  const [error, setError] = useState('')

  async function reload() {
    try {
      setSession(await api<Session>('session'))
      setError('')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not connect.')
    }
  }

  useEffect(() => { void reload() }, [])

  if (session?.user) return <Workspace user={session.user} reloadSession={reload} />

  return (
    <main className="mx-auto grid max-w-2xl gap-4 p-4 sm:p-8">
      <header className="page-heading">
        <h1>COMSOC Finance</h1>
        <p>{session?.setupRequired ? 'Create the initial Treasurer and Auditor accounts.' : 'Sign in to the financial workspace.'}</p>
      </header>
      {error && <div className="panel"><p role="alert">{error}</p>
        <button className="action" onClick={() => void reload()}>Retry</button></div>}
      {session?.setupRequired ? (
        <RecordForm key="setup" title="Initial account setup" resource="setup" label="Create accounts" onSaved={() => void reload()} fields={[
          { key: 'key', label: 'Local setup key', type: 'password' },
          { key: 'treasurerPassword', label: 'Treasurer password (at least 12 characters)', type: 'password' },
          { key: 'auditorPassword', label: 'Auditor password (at least 12 characters)', type: 'password' },
        ]}>
          <p className="sm:col-span-2">
            In VS Code, open <code>comsoc-finance/.dev.vars</code> and copy the value after <code>SETUP_KEY=</code>.
            Then choose a new password for each account.
          </p>
        </RecordForm>
      ) : session ? (
        <RecordForm key="login" title="Sign in" resource="login" label="Sign in" onSaved={() => void reload()} fields={[
          { key: 'username', label: 'Username', options: [{ value: 'treasurer', label: 'Treasurer' }, { value: 'auditor', label: 'Auditor' }] },
          { key: 'password', label: 'Password', type: 'password', autoComplete: 'current-password' },
        ]} />
      ) : !error && <p role="status">Connecting to the local application…</p>}
    </main>
  )
}
