import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { convertV4MiniflareOptions, Miniflare } from 'miniflare'

test('roles, ledger, budgets, settlements, receipts and reconciliations share the same records', async () => {
  const key = randomBytes(32).toString('hex')
  const password = randomBytes(24).toString('hex')
  const worker = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    scriptPath: fileURLToPath(new URL('../dist/comsoc_finance/index.js', import.meta.url)),
    compatibilityDate: '2026-11-17',
    d1Databases: ['DB'],
    r2Buckets: ['RECEIPTS'],
    bindings: { SETUP_KEY: key },
  }))
  try {
    const db = await worker.getD1Database('DB')
    const dir = new URL('../migrations/', import.meta.url)
    for (const file of (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort()) {
      const sql = await readFile(new URL(file, dir), 'utf8')
      const statements = []
      let pending = ''
      for (const line of sql.split(/\r?\n/)) {
        pending += line + '\n'
        if (line.endsWith(';') && (!pending.trimStart().startsWith('CREATE TRIGGER') || line === 'END;')) {
          statements.push(db.prepare(pending))
          pending = ''
        }
      }
      assert.equal(pending.trim(), '')
      await db.batch(statements)
    }

    async function call(route, { data, cookie, status = 200, origin = 'http://localhost' } = {}) {
      const headers = { Origin: origin }
      if (cookie) headers.Cookie = cookie
      if (data && !(data instanceof FormData)) headers['Content-Type'] = 'application/json'
      const outgoing = new Request('http://localhost/api/' + route, {
        method: data ? 'POST' : 'GET',
        headers,
        body: data instanceof FormData ? data : data && JSON.stringify(data),
      })
      // Local dispatch bypasses the HTTP transport that would normally set the body length.
      if (data instanceof FormData) {
        const bytes = await outgoing.clone().arrayBuffer()
        outgoing.headers.set('Content-Length', String(bytes.byteLength))
      }
      const response = await worker.dispatchFetch(outgoing.url, {
        method: outgoing.method,
        headers: Object.fromEntries(outgoing.headers),
        body: data ? await outgoing.arrayBuffer() : undefined,
      })
      assert.equal(response.status, status, route + ': ' + await response.clone().text())
      return response
    }
    async function post(route, data, cookie, status = 201) {
      return (await call(route, { data, cookie, status })).json()
    }
    async function read(route, cookie) {
      return (await call(route, { cookie })).json()
    }

    await call('accounts', { status: 401 })
    await post('setup', { key, treasurerPassword: password, auditorPassword: password })
    await post('setup', { key, treasurerPassword: password, auditorPassword: password }, undefined, 409)
    async function login(username) {
      const response = await call('login', { data: { username, password } })
      const header = response.headers.get('Set-Cookie')
      assert.match(header, /HttpOnly; SameSite=Strict/)
      return header.split(';')[0]
    }
    const treasurer = await login('treasurer')
    const auditor = await login('auditor')
    assert.equal((await read('session', auditor)).user.role, 'auditor')
    await post('events', {}, auditor, 403)
    await call('events', { data: {}, cookie: treasurer, origin: 'https://other.invalid', status: 403 })
    const { id: event } = await post('events', {
      name: 'Workshop', academic_year: '2026–2027', starts_on: '2026-11-22', ends_on: '2026-11-24',
    }, treasurer)
    await post('allocations', { event_id: event, category: 'Food', amount: '2000', reason: 'Approved' }, treasurer)
    const { id: otherEvent } = await post('events', {
      name: 'Second event', academic_year: '2026–2027', starts_on: '2026-11-22', ends_on: '2026-11-22',
    }, treasurer)
    await post('event-changes', { event_id: otherEvent, name: 'Second event updated', academic_year: '2026–2027',
      starts_on: '2026-11-22', ends_on: '2026-11-22', reason: 'Updated name' }, treasurer)
    assert.equal(JSON.parse((await read('event-history', auditor))[0].previous_values).name, 'Second event')
    const transfer = { source_event: event, destination_event: otherEvent, category: 'Food', reason: 'Approved' }
    await post('allocation-transfers', { ...transfer, amount: '2000.01' }, treasurer, 400)
    await post('allocation-transfers', { ...transfer, amount: '20' }, treasurer)
    await post('allocation-transfers', { ...transfer, source_event: otherEvent, destination_event: event, amount: '20' }, treasurer)
    const planned = await post('obligations', {
      kind: 'payment', description: 'Possible purchase', category: 'Food', event_id: event,
      counterparty: 'Vendor', planned: 'yes', amount: '50',
    }, treasurer)
    assert.equal((await read('obligations', treasurer)).find((row) => row.id === planned.id).payment_status, 'planned')
    assert.equal((await read('events', treasurer)).find((row) => row.id === event).available, 200000)
    await post('obligation-status', { obligation_id: planned.id, status: 'active', reason: 'Approved' }, treasurer)
    assert.equal((await read('events', treasurer)).find((row) => row.id === event).available, 195000)
    await post('obligation-status', { obligation_id: planned.id, status: 'cancelled', reason: 'Reconsidered' }, treasurer)
    const day = '2026-11-23'
    const entry = { occurred_on: day, description: 'Test entry' }
    await post('transactions', { ...entry, kind: 'income', amount: '10000', destination_account: 'cash' }, treasurer)
    await post('transactions', { ...entry, kind: 'transfer', amount: '1000', source_account: 'cash', destination_account: 'gcash' }, treasurer)
    await post('transactions', { ...entry, kind: 'transfer', amount: '1000', source_account: 'cash', destination_account: 'cash' }, treasurer, 400)
    await post('purchases', {
      purchased_on: day, description: 'Food', vendor: 'Test vendor', kind: 'reimbursement', counterparty: 'Officer',
      category: 'Food', event_id: event, items: [{ name: 'Lunch', quantity: '13', price: '110' }],
    }, treasurer)
    const obligation = (await read('obligations', treasurer)).find((row) => row.kind === 'reimbursement')
    assert.equal(obligation.amount, 143000)
    assert.equal((await read('accounts', treasurer)).find(({ id }) => id === 'cash').balance, 900000)
    assert.equal((await read('events', treasurer)).find((row) => row.id === event).available, 57000)

    const payment = { ...entry, obligation_id: obligation.id, source_account: 'cash' }
    const { id: transaction } = await post('transactions', { ...payment, amount: '297' }, treasurer)
    await post('transactions', { ...payment, amount: '1133.01' }, treasurer, 400)
    assert.equal((await read('events', treasurer)).find((row) => row.id === event).available, 57000)
    assert.equal((await read('obligations', treasurer)).find((row) => row.id === obligation.id).outstanding, 113300)
    await post('transactions', { ...payment, amount: '1133' }, treasurer)
    assert.equal((await read('obligations', treasurer)).find((row) => row.id === obligation.id).outstanding, 0)
    assert.equal((await read('events', treasurer)).find((row) => row.id === event).paid, 143000)

    const { id: directExpense } = await post('transactions', {
      ...entry, kind: 'expense', amount: '10', source_account: 'cash', event_id: event,
    }, treasurer)
    await post('reversals', { transaction_id: directExpense, occurred_on: day, notes: 'Duplicate' }, treasurer)
    await post('reversals', { transaction_id: directExpense, occurred_on: day, notes: 'Again' }, treasurer, 400)
    assert.equal((await read('events', treasurer)).find((row) => row.id === event).paid, 143000)

    const { id: loan } = await post('loans', {
      ...entry, kind: 'loan_received', account_id: 'cash', counterparty: 'Lender', amount: '200',
    }, treasurer)
    await post('loan-repayments', { ...entry, loan_id: loan, account_id: 'cash', amount: '200.01' }, treasurer, 400)
    await post('loan-repayments', { ...entry, loan_id: loan, account_id: 'cash', amount: '200' }, treasurer)
    assert.equal((await read('loans', treasurer)).find((row) => row.id === loan).outstanding, 0)
    const { id: internalLoan } = await post('loans', {
      ...entry, kind: 'internal_loan', account_id: 'cash', destination_account: 'gcash', amount: '25',
    }, treasurer)
    await post('loan-repayments', { ...entry, loan_id: internalLoan, amount: '25' }, treasurer)
    assert.equal((await read('loans', treasurer)).find((row) => row.id === internalLoan).outstanding, 0)

    const summary = await read('summary', auditor)
    assert.equal(summary.received, 1000000)
    assert.equal(summary.paid, 143000)
    assert.equal(summary.balance, 857000)
    await post('reconciliations', { account_id: 'cash', counted_on: day, actual: '7498' }, treasurer)
    assert.equal((await read('reconciliations', auditor))[0].discrepancy, -7200)

    await post('reviews', { transaction_id: transaction, status: 'verified', notes: 'Reviewed' }, treasurer, 403)
    await post('reviews', { transaction_id: transaction, status: 'pending', notes: 'Ready for review' }, treasurer)
    await post('reviews', { transaction_id: transaction, status: 'verified', notes: 'Reviewed' }, auditor)
    assert.equal((await read('transactions', treasurer)).find(({ id }) => id === transaction).review_status, 'verified')
    const upload = new FormData()
    upload.set('transaction_id', transaction)
    upload.set('receipt', new Blob(['%PDF-1.4\n'], { type: 'application/pdf' }), 'receipt.pdf')
    const receipt = await post('receipts', upload, auditor)
    await call('receipts/' + receipt.id, { status: 401 })
    assert.equal(await (await call('receipts/' + receipt.id, { cookie: treasurer })).text(), '%PDF-1.4\n')
    await post('logout', {}, treasurer, 200)
    await call('accounts', { cookie: treasurer, status: 401 })
    await post('password', { currentPassword: password, newPassword: randomBytes(24).toString('hex') }, auditor, 200)
    await call('accounts', { cookie: auditor, status: 401 })
  } finally {
    await worker.dispose()
  }
})
