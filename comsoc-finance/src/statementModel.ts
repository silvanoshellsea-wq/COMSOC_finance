export type Account = 'Cash' | 'GCash'
export type Status = 'Paid' | 'To Pay' | 'To Reimburse'
export type Kind = 'Income' | 'Expense' | 'Payment' | 'Reimbursement' | 'Transfer' | 'Loan received' | 'Loan issued' | 'Loan repayment received' | 'Loan repayment paid' | 'Adjustment in' | 'Adjustment out'
export type Plan = { id: string; category: string; name: string; quantity: number; price: number; cancelled: boolean }
export type Event = { id: string; name: string; budget: number | null; categories: string[]; plans: Plan[] }
export type Item = { name: string; quantity: number; price: number; planId?: string }
export type Entry = {
  id: string; day: string; eventId: string; category: string; items: Item[]; kind: Kind;
  account: Account | 'Personal Funds'; status: Status; person: string; notes: string;
  receipt?: File; receiptItemIndexes?: number[]; settles?: string; reverses?: string; review?: 'Verified' | 'Flagged'
  history?: { id: string; at: string; detail: string }[]
}
export type Statement = {
  id: string; name: string; year: string; description: string; archived: boolean;
  opening: Record<Account, number>; events: Event[]; entries: Entry[]
  counts?: { id: string; account: Account; day: string; expected: number; actual: number; notes: string }[]
}

export const accounts = ['Cash', 'GCash'] as const
export const kinds: Kind[] = ['Income', 'Expense', 'Reimbursement', 'Transfer', 'Loan received', 'Loan issued',
  'Loan repayment received', 'Loan repayment paid', 'Adjustment in', 'Adjustment out']
export const incoming: Kind[] = ['Income', 'Loan received', 'Loan repayment received', 'Adjustment in']
export const amount = (entry: Entry) => entry.items.reduce((sum, item) => sum + item.quantity * item.price, 0)
export const linkedReceiptItems = (entry: Entry) => entry.receipt
  ? entry.items.filter((_, index) => entry.receiptItemIndexes?.includes(index) ?? true)
  : []
export const itemAllocation = (event: Event) => event.plans.reduce((sum, plan) =>
  sum + (plan.cancelled ? 0 : plan.quantity * plan.price), 0)

export function parseMoney(value: string) {
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(value)) throw new Error('Enter a peso amount with up to two decimal places.')
  const [whole, fraction = ''] = value.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}

export function movements(entry: Entry) {
  const delta = { Cash: 0, GCash: 0 }
  if (entry.status !== 'Paid' || entry.account === 'Personal Funds') return delta
  const total = amount(entry) * (entry.reverses ? -1 : 1)
  delta[entry.account] = incoming.includes(entry.kind) ? total : -total
  if (entry.kind === 'Transfer') delta[entry.account === 'Cash' ? 'GCash' : 'Cash'] = total
  return delta
}

export function ledger(statement: Statement) {
  const balances = { ...statement.opening }
  return [...statement.entries].sort((a, b) => a.day.localeCompare(b.day)).map((entry) => {
    const delta = movements(entry)
    for (const account of accounts) balances[account] += delta[account]
    return { entry, balances: { ...balances } }
  })
}

export function finance(statement: Statement, eventId?: string) {
  const reversed = new Set(statement.entries.flatMap((entry) => entry.reverses ? [entry.reverses] : []))
  const entries = statement.entries.filter((entry) => !entry.reverses && !reversed.has(entry.id) &&
    (!eventId || eventId === entry.eventId))
  const settled = new Set(entries.flatMap((entry) => entry.settles ? [entry.settles] : []))
  const sum = (predicate: (entry: Entry) => boolean) => entries.filter(predicate).reduce((total, entry) => total + amount(entry), 0)
  const received = sum((entry) => entry.kind === 'Income')
  const spent = sum((entry) => (entry.kind === 'Expense' || Boolean(entry.settles)) && entry.status === 'Paid')
  const unpaid = (entry: Entry) => entry.kind === 'Expense' && !settled.has(entry.id)
  const payments = sum((entry) => unpaid(entry) && entry.status === 'To Pay')
  const reimbursements = sum((entry) => unpaid(entry) && entry.status === 'To Reimburse')
  const allocated = statement.events.filter((event) => !eventId || event.id === eventId)
    .reduce((total, event) => total + (event.budget ?? itemAllocation(event)), 0)
  const balances = ledger(statement).at(-1)?.balances ?? statement.opening
  return { received, spent, payments, reimbursements, allocated, balances,
    available: allocated - spent - payments - reimbursements,
    unallocated: statement.opening.Cash + statement.opening.GCash + received - allocated,
    projected: balances.Cash + balances.GCash - payments - reimbursements }
}

export function worksheet(statement: Statement, event: Event) {
  const reversed = new Set(statement.entries.flatMap((entry) => entry.reverses ? [entry.reverses] : []))
  const entries = statement.entries.filter((entry) => entry.kind === 'Expense' && !entry.reverses &&
    !reversed.has(entry.id) && entry.eventId === event.id)
  const actuals = entries.flatMap((entry) => entry.items.map((item, index) => ({ entry, item, index })))
  return [
    ...event.plans.map((plan) => ({ plan, actuals: actuals.filter(({ item }) => item.planId === plan.id) })),
    ...actuals.filter(({ item }) => !event.plans.some((plan) => plan.id === item.planId))
      .map((actual) => ({ plan: undefined, actuals: [actual] })),
  ]
}

export function updateStatement(statements: Statement[], id: string, update: (statement: Statement) => Statement) {
  return statements.map((statement) => statement.id === id ? update(statement) : statement)
}

export function postEntry(statement: Statement, entry: Entry): Statement {
  if (statement.archived) throw new Error('Reopen the statement before making changes.')
  if (!entry.items.length || entry.items.some((item) => !item.name.trim() || !Number.isSafeInteger(item.quantity) ||
    item.quantity < 1 || item.quantity > 999 || !Number.isSafeInteger(item.price) || item.price <= 0)) {
    throw new Error('Enter a name, whole quantity from 1 to 999, and positive unit price for each item.')
  }
  if (!entry.person.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.day)) throw new Error('Enter a date and person in charge.')
  if (entry.receipt && !linkedReceiptItems(entry).length) throw new Error('Select at least one item covered by the receipt.')
  if (entry.kind !== 'Expense' && entry.status !== 'Paid') throw new Error('Only expenses can be entered as unpaid.')
  if ((entry.account === 'Personal Funds') !== (entry.status === 'To Reimburse')) {
    throw new Error('Use Personal Funds for purchases to reimburse. Use Cash or GCash for other entries.')
  }
  const event = statement.events.find((event) => event.id === entry.eventId)
  if (entry.eventId && !event) throw new Error('Choose an event from this statement.')
  if (event && !event.categories.includes(entry.category)) throw new Error('Choose an event category.')
  if (!entry.settles && entry.items.some(({ planId }) => planId && !event?.plans.some((plan) =>
    plan.id === planId && !plan.cancelled && plan.category === entry.category))) {
    throw new Error('Choose an active planned item in this category.')
  }
  if (entry.settles) {
    const obligation = statement.entries.find((row) => row.id === entry.settles)
    if (!obligation || obligation.kind !== 'Expense' || obligation.status === 'Paid' || entry.status !== 'Paid' ||
      entry.kind !== (obligation.status === 'To Reimburse' ? 'Reimbursement' : 'Payment') ||
      entry.eventId !== obligation.eventId || entry.category !== obligation.category || entry.day < obligation.day ||
      amount(obligation) !== amount(entry) ||
      statement.entries.some((row) => row.settles === obligation.id && !row.reverses &&
        !statement.entries.some((reversal) => reversal.reverses === row.id))) {
      throw new Error('Choose an outstanding expense and enter its full settlement amount.')
    }
  }
  return { ...statement, entries: [...statement.entries, entry] }
}

export const demoStatements: Statement[] = [
  { id: 'semester', name: '2nd Semester Financial Statement', year: '2026–2027', description: 'Sample semester records',
    archived: false, opening: { Cash: 200000, GCash: 100000 }, entries: [],
    events: [{ id: 'academic', name: 'Academic Competition', budget: 180000,
      categories: ['Materials', 'Food and Beverages', 'Prizes'],
      plans: [{ id: 'food', category: 'Food and Beverages', name: 'Lunch', quantity: 10, price: 11000, cancelled: false }] }] },
  { id: 'ccs', name: 'CCS Days Financial Statement', year: '2026–2027', description: 'Independent sample statement',
    archived: false, opening: { Cash: 70000, GCash: 50000 }, entries: [],
    events: [{ id: 'sports', name: 'Sports Festival', budget: 90000, categories: ['Venue', 'Equipment'], plans: [] }] },
]
