import assert from 'node:assert/strict'
import { test } from 'node:test'
import { demoStatements, finance, ledger, linkedReceiptItems, parseMoney, postEntry, updateStatement, worksheet } from '../src/statementModel.ts'

const entry = {
  id: 'purchase', day: '2026-11-14', eventId: 'academic', category: 'Materials',
  items: [{ name: 'Vellum Board', quantity: 2, price: 5000 }],
  kind: 'Expense', status: 'Paid', account: 'Cash', person: 'Procurement Officer', notes: '',
}

test('one Ledger receipt can cover multiple selected items', () => {
  const [semester] = demoStatements
  const receipt = new File(['sample'], 'receipt.png', { type: 'image/png' })
  const items = [...entry.items,
    { name: 'Tape', quantity: 1, price: 500 }, { name: 'Marker', quantity: 1, price: 250 }]
  const posted = postEntry(semester, { ...entry, receipt, items, receiptItemIndexes: [0, 2] })
  assert.deepEqual(linkedReceiptItems(posted.entries[0]).map((item) => item.name), ['Vellum Board', 'Marker'])
  assert.equal(linkedReceiptItems({ ...entry, receipt, items }).length, 3)
  assert.throws(() => postEntry(semester, { ...entry, receipt, receiptItemIndexes: [] }), /select at least one/i)
})

test('item-based event allocation rolls up active plans while Ledger activity drives spending', () => {
  const [semester] = demoStatements
  const event = { ...semester.events[0], budget: null }
  const statement = { ...semester, events: [event] }
  assert.equal(finance(statement, event.id).allocated, 110000)
  assert.equal(finance(statement, event.id).spent, 0)
  const posted = postEntry(statement, entry)
  assert.equal(finance(posted, event.id).allocated, 110000)
  assert.equal(finance(posted, event.id).available, 100000)
  const cancelled = { ...posted, events: [{ ...event, plans: event.plans.map((plan) => ({ ...plan, cancelled: true })) }] }
  assert.equal(finance(cancelled, event.id).allocated, 0)
  assert.equal(finance(cancelled, event.id).spent, 10000)
})

test('Ledger posts one purchase to its event and account, with no change to another statement', () => {
  const [semester, ccs] = demoStatements
  const updated = updateStatement(demoStatements, semester.id, (state) => postEntry(state, entry))
  const event = updated[0].events[0]
  assert.deepEqual(finance(updated[0]).balances, { Cash: 190000, GCash: 100000 })
  assert.equal(finance(updated[0], event.id).spent, 10000)
  assert.equal(finance(updated[0], event.id).available, 170000)
  assert.equal(worksheet(updated[0], event).find(({ actuals }) => actuals.length).actuals[0].entry.id, entry.id)
  assert.deepEqual(ledger(updated[0])[0].balances, { Cash: 190000, GCash: 100000 })
  assert.strictEqual(updated[1], ccs)
  assert.deepEqual(finance(updated[1]), finance(ccs))
  assert.throws(() => postEntry(ccs, entry), /event from this statement/)
})

test('explicit planning links preserve estimates and count actual purchases only once', () => {
  const [semester] = demoStatements
  const actual = { ...entry, category: 'Food and Beverages',
    items: [{ name: 'Ten meals', quantity: 10, price: parseMoney('105'), planId: 'food' }] }
  const statement = postEntry(semester, actual)
  const [{ plan, actuals }] = worksheet(statement, statement.events[0])
  assert.equal(actuals.length, 1)
  assert.equal(plan.quantity * plan.price - actuals[0].item.quantity * actuals[0].item.price, 5000)
  assert.equal(finance(statement).spent, 105000)
  assert.throws(() => postEntry(semester, { ...actual, category: 'Materials' }), /active planned item/)
})

test('personal funds, settlement, transfer, and reversal use actual cash movements only', () => {
  const [semester] = demoStatements
  const obligation = { ...entry, status: 'To Reimburse', account: 'Personal Funds' }
  const outstanding = postEntry(semester, obligation)
  assert.equal(finance(outstanding).reimbursements, 10000)
  assert.equal(finance(outstanding).balances.Cash, semester.opening.Cash)
  const payment = { ...entry, id: 'payment', kind: 'Reimbursement', account: 'GCash', settles: entry.id }
  const settled = postEntry(outstanding, payment)
  assert.equal(finance(settled).spent, 10000)
  assert.equal(finance(settled).reimbursements, 0)
  assert.equal(finance(settled).balances.GCash, 90000)
  assert.throws(() => postEntry(settled, { ...payment, id: 'duplicate' }), /outstanding expense/)
  const transfer = postEntry(settled, { ...entry, id: 'transfer', kind: 'Transfer' })
  assert.deepEqual(finance(transfer).balances, { Cash: 190000, GCash: 100000 })
  assert.equal(finance(transfer).spent, 10000)
  const reversed = { ...transfer, entries: [...transfer.entries,
    { ...payment, id: 'reversal', settles: undefined, reverses: 'payment' }] }
  assert.equal(finance(reversed).spent, 0)
  assert.equal(finance(reversed).reimbursements, 10000)
  assert.equal(finance(reversed).balances.GCash, 110000)
})
