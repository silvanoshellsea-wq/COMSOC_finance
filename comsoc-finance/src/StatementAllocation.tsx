import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import StatementDialog from './StatementDialog'
import { money } from './api'
import { finance, itemAllocation, parseMoney, worksheet } from './statementModel'
import type { Event, Plan, Statement } from './statementModel'
import { Sheet, value } from './StatementLedger'
import type { Change } from './StatementLedger'

function AllocationIcon({ label, icon, onClick, add = false }: {
  label: string; icon: string; onClick: () => void; add?: boolean
}) {
  return <button type="button" className={add ? 'demo-primary demo-icon' : 'demo-icon'} title={label}
    aria-label={label} aria-haspopup={add ? 'dialog' : undefined} onClick={onClick}>
    <span aria-hidden="true">{icon}</span>
  </button>
}

export default function StatementAllocation({ statement, change, edit, eventId, openEvent, openLedger }: {
  statement: Statement; change: Change; edit: boolean; eventId: string;
  openEvent: (id: string) => void; openLedger: (eventId: string, entryId?: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const event = statement.events.find((row) => row.id === eventId)
  if (event) return <Worksheet key={event.id} event={event} statement={statement} change={change}
    edit={edit} back={() => openEvent('')} openLedger={(id) => openLedger(event.id, id)} />

  function addEvent(e: FormEvent<HTMLFormElement>, dismiss: () => void) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    try {
      const name = value(data, 'name')
      if (!name) throw new Error('Enter an event name.')
      const budget = value(data, 'budget')
      const created = { id: crypto.randomUUID(), name, budget: budget ? parseMoney(budget) : null, categories: [], plans: [] }
      change((current) => ({ ...current, events: [...current.events, created] }))
      dismiss()
      openEvent(created.id)
    } catch (failure) { setError((failure as Error).message) }
  }

  return <div className="grid gap-4">
    {edit && <div className="demo-actions"><AllocationIcon icon="+" label="Add event" add onClick={() => { setError(''); setAdding(true) }} /></div>}
    <Sheet title="Final Allocation" columns={['Event', 'Allocated', 'Spent', 'To Pay', 'Available']}
      rows={statement.events.map((event) => {
        const totals = finance(statement, event.id)
        return { id: event.id, cells: [<button className="demo-link" onClick={() => openEvent(event.id)}>{event.name}</button>,
          money(totals.allocated), money(totals.spent), money(totals.payments + totals.reimbursements), money(totals.available)] }
      })} />
    {edit && adding && <StatementDialog title="Add event" close={() => setAdding(false)}>{(dismiss) =>
      <form className="demo-form" onSubmit={(e) => addEvent(e, dismiss)}>
        <label>Event name<input name="name" required maxLength={120} /></label>
        <label>Approved budget cap (PHP, optional)<input name="budget" inputMode="decimal" /></label>
        <p className="demo-span">Leave the cap blank to build the event allocation by adding items.</p>
        {error && <p className="demo-error demo-span" role="alert">{error}</p>}
        <div className="demo-actions demo-span"><button className="demo-primary">Create event</button>
          <button type="button" onClick={dismiss}>Cancel</button></div>
      </form>
    }</StatementDialog>}
  </div>
}

function Worksheet({ event, statement, change, edit, back, openLedger }: {
  event: Event; statement: Statement; change: Change; edit: boolean; back: () => void; openLedger: (id?: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Plan>()
  const totals = finance(statement, event.id)
  const allotted = itemAllocation(event)
  const unassigned = event.budget === null ? null : event.budget - allotted
  const lines = worksheet(statement, event)
  const reversed = new Set(statement.entries.flatMap((entry) => entry.reverses ? [entry.reverses] : []))
  const settledIds = new Set(statement.entries.filter((entry) => entry.settles && !reversed.has(entry.id)).map((entry) => entry.settles))
  const editEvent = (update: (event: Event) => Event) => change((current) => ({
    ...current, events: current.events.map((candidate) => candidate.id === event.id ? update(candidate) : candidate),
  }))

  return <div className="grid gap-4">
    <div className="demo-actions">
      <AllocationIcon icon="←" label="Back to Final Allocation" onClick={back} />
      <AllocationIcon icon="↗" label="View event in Ledger" onClick={() => openLedger()} />
      {edit && <AllocationIcon icon="+" label="Add allotted item" add onClick={() => setAdding(true)} />}
    </div>
    <section className="demo-panel grid gap-3">
      <h2>{event.name} Breakdown</h2>
      <dl className="demo-ledger-summary">
        <div><dt>Event budget</dt><dd>{money(totals.allocated)}</dd></div>
        <div><dt>Spent</dt><dd>{money(totals.spent)}</dd></div>
        <div><dt>To Pay</dt><dd>{money(totals.payments + totals.reimbursements)}</dd></div>
        <div><dt>Available</dt><dd className={totals.available < 0 ? 'demo-error' : undefined}>{money(totals.available)}</dd></div>
      </dl>
      <p className={unassigned !== null && unassigned < 0 ? 'demo-error' : 'demo-notice'}>
        {unassigned === null ? 'This event’s allocation is the sum of its allotted items.' :
          money(allotted) + ' allotted to items. ' + (unassigned === 0 ? 'Event budget fully allotted.' :
            unassigned > 0 ? money(unassigned) + ' left to allot.' : money(-unassigned) + ' over the event budget.')}
      </p>
    </section>
    <Sheet title={event.name + ' allocation breakdown'} columns={['Allotted Item', 'Category', 'Allocated', 'Spent', 'To Pay', 'Available', 'Actions']}
      rows={lines.map(({ plan, actuals }) => {
        const allocated = plan && !plan.cancelled ? plan.quantity * plan.price : 0
        let spent = 0
        let toPay = 0
        for (const { entry, item } of actuals) {
          const total = item.quantity * item.price
          if (entry.status === 'Paid' || settledIds.has(entry.id)) spent += total
          else toPay += total
        }
        const available = allocated - spent - toPay
        const transactionIds = new Set(actuals.map(({ entry }) => entry.id))
        return { id: plan?.id ?? actuals[0].entry.id + '-' + actuals[0].index, cells: [
          <>{plan?.name ?? actuals[0].item.name}{plan?.cancelled && <> · Cancelled</>}{!plan && <> · Unplanned</>}</>,
          plan?.category ?? actuals[0].entry.category,
          money(allocated), money(spent), money(toPay), <span className={available < 0 ? 'demo-error' : undefined}>{money(available)}</span>,
          <div className="demo-actions">
            {[...transactionIds].map((id) => <AllocationIcon icon="↗" label={'Open Ledger transaction ' + id.slice(0, 8)} key={id}
              onClick={() => openLedger(id)} />)}
            {edit && plan && !plan.cancelled && <>
              <button className="demo-link" onClick={() => { setEditing(plan); setAdding(true) }}>Edit</button>
              <button className="demo-link" onClick={() => editEvent((current) => ({
                ...current, plans: current.plans.map((row) => row.id === plan.id ? { ...row, cancelled: true } : row),
              }))}>Cancel item</button>
            </>}
          </div>,
        ] }
      })} />
    {edit && adding && <PlanDialog event={event} editing={editing}
      remaining={unassigned === null ? null : unassigned + (editing ? editing.quantity * editing.price : 0)}
      lockCategory={Boolean(editing && lines.find((line) => line.plan?.id === editing.id)?.actuals.length)}
      close={() => { setAdding(false); setEditing(undefined) }} save={(plan) => editEvent((current) => ({
        ...current,
        categories: current.categories.includes(plan.category) ? current.categories : [...current.categories, plan.category],
        plans: editing ? current.plans.map((row) => row.id === editing.id ? plan : row) : [...current.plans, plan],
      }))} />}
  </div>
}

function PlanDialog({ event, editing, remaining, lockCategory, close, save }: {
  event: Event; editing?: Plan; remaining: number | null; lockCategory: boolean; close: () => void; save: (plan: Plan) => void
}) {
  const categoriesId = useId()
  const [estimate, setEstimate] = useState(editing ? editing.quantity * editing.price : undefined)
  const [error, setError] = useState('')

  function total(data: FormData) {
    const quantity = Number(value(data, 'quantity'))
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) throw new Error('Enter a whole quantity from 1 to 999.')
    return { quantity, price: parseMoney(value(data, 'price')) }
  }

  function submit(e: FormEvent<HTMLFormElement>, dismiss: () => void) {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    try {
      const name = value(data, 'name')
      const entered = value(data, 'category')
      if (!name || !entered) throw new Error('Enter an item name and category.')
      const category = event.categories.find((row) => row.toLowerCase() === entered.toLowerCase()) ?? entered
      const item = total(data)
      if (remaining !== null && item.quantity * item.price > remaining) throw new Error('This item would exceed the event budget.')
      save({ id: editing?.id ?? crypto.randomUUID(), name, category, ...item, cancelled: false })
      dismiss()
    } catch (failure) { setError((failure as Error).message) }
  }

  return <StatementDialog title={editing ? 'Edit allotted item' : 'Add allotted item'} close={close}>{(dismiss) =>
    <form className="demo-form" onSubmit={(e) => submit(e, dismiss)} onChange={(e) => {
      try {
        const { quantity, price } = total(new FormData(e.currentTarget))
        setEstimate(quantity * price)
      } catch { setEstimate(undefined) }
    }}>
      <label>Item name<input name="name" defaultValue={editing?.name} required maxLength={150} /></label>
      <label>Category<input name="category" list={categoriesId} defaultValue={editing?.category} required readOnly={lockCategory} maxLength={80} /></label>
      <datalist id={categoriesId}>{event.categories.map((category) => <option key={category} value={category} />)}</datalist>
      <label>Quantity<input name="quantity" defaultValue={editing?.quantity ?? 1} type="number" min="1" max="999" required /></label>
      <label>Allocated unit price (PHP)<input name="price" defaultValue={editing ? (editing.price / 100).toFixed(2) : ''} inputMode="decimal" required /></label>
      <output className="demo-span">Allocated total <strong>{estimate === undefined ? '—' : money(estimate)}</strong></output>
      {remaining !== null && <p className="demo-span" role="status">
        {estimate !== undefined && estimate > remaining
          ? <span className="demo-error">Over the allotted budget by {money(estimate - remaining)}.</span>
          : estimate === remaining ? 'This item fully allots the event budget.'
            : money(Math.max(0, remaining - (estimate ?? 0))) + (estimate === undefined ? ' available to allot.' : ' left to allot after saving.')}
      </p>}
      {error && <p className="demo-error demo-span" role="alert">{error}</p>}
      <div className="demo-actions demo-span"><button className="demo-primary">{editing ? 'Save changes' : 'Add item'}</button>
        <button type="button" onClick={dismiss}>Cancel</button></div>
    </form>
  }</StatementDialog>
}
