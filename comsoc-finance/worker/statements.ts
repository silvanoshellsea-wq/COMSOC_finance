import type { RuntimeEnv, User } from './auth.js'
import { HttpError, json } from './http.js'
import type { Entry, Statement } from '../src/statementModel.js'

type Receipt = { key: string; name: string; type: string }
type StoredEntry = Omit<Entry, 'receipt'> & { receipt?: Receipt }
type StoredStatement = Omit<Statement, 'entries'> & { entries: StoredEntry[] }
type RecordRow = { revision: number; data: string; deleted: number }

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/
const kinds = ['Income', 'Expense', 'Payment', 'Reimbursement', 'Transfer', 'Loan received', 'Loan issued',
  'Loan repayment received', 'Loan repayment paid', 'Adjustment in', 'Adjustment out']
const isId = (value: unknown) => typeof value === 'string' && uuid.test(value)
const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max
const integer = (value: number, min = 0, max = 999_999_999_999) => Number.isSafeInteger(value) && value >= min && value <= max
const account = (value: unknown) => value === 'Cash' || value === 'GCash'
const day = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
const unique = (ids: string[]) => new Set(ids).size === ids.length

function valid(data: StoredStatement, id: string) {
  try {
    if (data.id !== id || !text(data.name, 150) || !data.name.trim() || !text(data.year, 40) || !data.year.trim() ||
        !text(data.description, 250) || typeof data.archived !== 'boolean' ||
        !integer(data.opening.Cash) || !integer(data.opening.GCash) ||
        !Array.isArray(data.events) || !Array.isArray(data.entries) || !unique(data.events.map((event) => event.id)) ||
        !unique(data.entries.map((entry) => entry.id))) return false
    if (!data.events.every((event) => isId(event.id) && text(event.name, 120) && event.name.trim() &&
      (event.budget === null || integer(event.budget)) && Array.isArray(event.categories) &&
      event.categories.every((category) => text(category, 80) && category.trim()) && unique(event.categories) &&
      Array.isArray(event.plans) && unique(event.plans.map((plan) => plan.id)) && event.plans.every((plan) =>
        isId(plan.id) && event.categories.includes(plan.category) && text(plan.name, 150) && plan.name.trim() &&
        integer(plan.quantity, 1, 999) && integer(plan.price) && typeof plan.cancelled === 'boolean') &&
      (event.budget === null || event.plans.reduce((sum, plan) =>
        sum + (plan.cancelled ? 0 : plan.quantity * plan.price), 0) <= event.budget))) return false
    if (!data.entries.every((entry) => {
      const event = data.events.find((row) => row.id === entry.eventId)
      return isId(entry.id) && day(entry.day) && kinds.includes(entry.kind) &&
        ['Paid', 'To Pay', 'To Reimburse'].includes(entry.status) &&
        (entry.kind === 'Expense' || entry.status === 'Paid') &&
        (entry.status === 'To Reimburse' ? entry.account === 'Personal Funds' : account(entry.account)) &&
        (!entry.eventId || Boolean(event?.categories.includes(entry.category))) &&
        text(entry.category, 500) && text(entry.person, 120) && entry.person.trim() && text(entry.notes, 500) &&
        Array.isArray(entry.items) && entry.items.length > 0 && entry.items.length <= 25 &&
        entry.items.every((item) => text(item.name, 150) && item.name.trim() && integer(item.quantity, 1, 999) &&
          integer(item.price, 1) && (item.account === undefined || (entry.kind === 'Expense' && entry.status === 'Paid' && account(item.account))) &&
          (!item.planId || event?.plans.some((plan) => plan.id === item.planId && plan.category === entry.category))) &&
        (!entry.settles || data.entries.some((row) => row.id === entry.settles && row.kind === 'Expense' && row.status !== 'Paid')) &&
        (!entry.reverses || data.entries.some((row) => row.id === entry.reverses && row.status === 'Paid' && !row.reverses)) &&
        (entry.review === undefined || entry.review === 'Verified' || entry.review === 'Flagged') &&
        (entry.receiptItemIndexes === undefined || (Array.isArray(entry.receiptItemIndexes) &&
          entry.receiptItemIndexes.length > 0 && entry.receiptItemIndexes.every((position) => integer(position, 0, entry.items.length - 1))))
    })) return false
    const entries = new Map(data.entries.map((entry) => [entry.id, entry]))
    const reversals = data.entries.flatMap((entry) => entry.reverses ? [entry.reverses] : [])
    const reversed = new Set(reversals)
    const payments = data.entries.flatMap((entry) => entry.settles && !reversed.has(entry.id) ? [entry.settles] : [])
    const amount = (entry: StoredEntry) => entry.items.reduce((sum, item) => sum + item.quantity * item.price, 0)
    if (!unique(reversals) || !unique(payments) || !data.entries.every((entry) => {
      if (entry.reverses) {
        const original = entries.get(entry.reverses)!
        return !entry.settles && entry.status === 'Paid' && entry.day >= original.day && Boolean(entry.notes.trim()) &&
          entry.kind === original.kind && entry.account === original.account && entry.eventId === original.eventId &&
          entry.category === original.category && JSON.stringify(entry.items) === JSON.stringify(original.items)
      }
      if (entry.settles) {
        const obligation = entries.get(entry.settles)!
        return entry.kind === (obligation.status === 'To Reimburse' ? 'Reimbursement' : 'Payment') &&
          entry.eventId === obligation.eventId && entry.category === obligation.category &&
          entry.day >= obligation.day && amount(entry) === amount(obligation)
      }
      return entry.kind !== 'Payment' && entry.kind !== 'Reimbursement'
    })) return false
    return data.counts === undefined || (Array.isArray(data.counts) && data.counts.every((count) =>
      isId(count.id) && account(count.account) && day(count.day) && integer(count.expected, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) &&
      integer(count.actual) && text(count.notes, 500)))
  } catch {
    return false
  }
}

function canUpdate(next: StoredStatement, previous: StoredStatement, user: User) {
  const immutable = ({ person: _person, notes: _notes, history: _history, review: _review,
    receipt: _receipt, receiptItemIndexes: _receiptItemIndexes, ...entry }: StoredEntry) => entry
  const changes = new Map(next.entries.map((entry) => [entry.id, entry]))
  if (!previous.entries.every((entry) => {
    const changed = changes.get(entry.id)
    return changed && JSON.stringify(immutable(changed)) === JSON.stringify(immutable(entry))
  })) return false
  if (user.role === 'treasurer') {
    if (next.opening.Cash !== previous.opening.Cash || next.opening.GCash !== previous.opening.GCash) return false
    if (!previous.archived) return true
    return JSON.stringify(next.entries) === JSON.stringify(previous.entries.map(({ receipt: _receipt, ...entry }) => entry)) &&
      JSON.stringify(next.events) === JSON.stringify(previous.events) &&
      JSON.stringify(next.counts) === JSON.stringify(previous.counts)
  }
  const strip = ({ entries, ...statement }: StoredStatement) => ({
    ...statement, entries: entries.map(({ receipt: _receipt, receiptItemIndexes: _items, review: _review, history: _history, ...entry }) => entry),
  })
  return !previous.archived && JSON.stringify(strip(next)) === JSON.stringify(strip(previous))
}

function supported(file: File, bytes: Uint8Array) {
  const start = new TextDecoder().decode(bytes.subarray(0, 12))
  return (file.type === 'application/pdf' && start.startsWith('%PDF-')) ||
    (file.type === 'image/gif' && /^GIF8[79]a/.test(start)) ||
    (file.type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
    (file.type === 'image/png' && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) ||
    (file.type === 'image/webp' && start.startsWith('RIFF') && start.slice(8) === 'WEBP')
}

export async function statementRoute(request: Request, env: RuntimeEnv, path: string, user: User) {
  if (!path.startsWith('/api/statements')) return null
  if (path === '/api/statements' && request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT revision, data FROM financial_statements WHERE deleted = 0 ORDER BY rowid')
      .all<RecordRow>()
    return json(rows.results.map(({ revision, data }) => {
      const statement = JSON.parse(data) as StoredStatement
      return {
        revision,
        statement: {
          ...statement,
          entries: statement.entries.map(({ receipt, ...entry }) => ({
            ...entry, receipt: receipt && { name: receipt.name, type: receipt.type },
          })),
        },
      }
    }))
  }
  const [, , , id, entryId] = path.split('/')
  if (!isId(id) || (entryId && !isId(entryId))) return null
  const row = await env.DB.prepare('SELECT revision, data, deleted FROM financial_statements WHERE id = ?').bind(id).first<RecordRow>()
  const previous = row && !row.deleted ? JSON.parse(row.data) as StoredStatement : undefined
  if (entryId && request.method === 'GET') {
    const receipt = previous?.entries.find((entry) => entry.id === entryId)?.receipt
    const file = receipt && await env.RECEIPTS?.get(receipt.key)
    if (!file || !receipt) throw new HttpError(404, 'Receipt not found.')
    return new Response(file.body, { headers: {
      'Content-Type': receipt.type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': 'attachment',
    } })
  }
  if (entryId || request.method !== 'POST') return null
  if (row?.deleted) throw new HttpError(409, 'This statement was deleted.')
  const contentLength = Number(request.headers.get('Content-Length'))
  if (contentLength > 6 * 1024 * 1024) throw new HttpError(413, 'The update is too large.')
  let form: FormData
  try { form = await request.formData() } catch { throw new HttpError(400, 'Invalid statement update.') }
  const revision = Number(form.get('revision'))
  if (!integer(revision) || revision !== (row?.revision ?? 0)) throw new HttpError(409, 'The statement changed in another tab. Reload before saving.')
  if (form.get('delete') === 'yes') {
    if (user.role !== 'treasurer') throw new HttpError(403, 'Only a Treasurer can delete statements.')
    const result = await env.DB.prepare('UPDATE financial_statements SET deleted = 1, revision = revision + 1, updated_by = ? WHERE id = ? AND revision = ?')
      .bind(user.id, id, revision).run()
    if (!result.meta.changes) throw new HttpError(409, 'The statement changed in another tab.')
    return json({ revision: revision + 1 })
  }
  const payload = form.get('statement')
  if (typeof payload !== 'string' || new TextEncoder().encode(payload).byteLength > 500_000) throw new HttpError(413, 'The statement is too large.')
  let data: StoredStatement
  try { data = JSON.parse(payload) } catch { throw new HttpError(400, 'Invalid statement data.') }
  if (!valid(data, id)) throw new HttpError(400, 'Check the statement fields and amounts.')
  if (previous ? !canUpdate(data, previous, user) : user.role !== 'treasurer') {
    throw new HttpError(403, 'Your role cannot make this change or the update rewrites posted entries.')
  }
  const previousEntries = new Map(previous?.entries.map((entry) => [entry.id, entry]))
  const uploads: { key: string; buffer: ArrayBuffer }[] = []
  for (const entry of data.entries) {
    const file = form.get('receipt:' + entry.id)
    const existing = previousEntries.get(entry.id)?.receipt
    if (existing) {
      entry.receipt = existing
      entry.receiptItemIndexes = previousEntries.get(entry.id)?.receiptItemIndexes
    } else if (file instanceof File) {
      if (!env.RECEIPTS) throw new HttpError(403, 'Receipt uploads are disabled for this installation.')
      if (!file.size || file.size > 5 * 1024 * 1024 || !text(file.name, 255)) throw new HttpError(400, 'Choose a receipt under 5 MB.')
      const buffer = await file.arrayBuffer()
      if (!supported(file, new Uint8Array(buffer))) throw new HttpError(415, 'Choose a supported image or PDF.')
      const key = 'statements/' + id + '/' + crypto.randomUUID()
      entry.receipt = { key, name: file.name, type: file.type }
      uploads.push({ key, buffer })
    } else {
      delete entry.receipt
      delete entry.receiptItemIndexes
    }
  }
  try {
    for (const { key, buffer } of uploads) await env.RECEIPTS?.put(key, buffer)
    const updated = await (row
      ? env.DB.prepare(`UPDATE financial_statements SET data = ?, revision = revision + 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ? AND revision = ? AND deleted = 0`).bind(JSON.stringify(data), user.id, id, revision)
      : env.DB.prepare('INSERT INTO financial_statements (id, revision, data, updated_by) VALUES (?, 1, ?, ?) ON CONFLICT(id) DO NOTHING')
        .bind(id, JSON.stringify(data), user.id)).run()
    if (!updated.meta.changes) throw new HttpError(409, 'The statement changed in another tab. Reload before saving.')
  } catch (error) {
    await Promise.allSettled(uploads.map(({ key }) => env.RECEIPTS?.delete(key)))
    throw error
  }
  return json({ revision: revision + 1 })
}
