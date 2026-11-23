import { useState } from 'react'
import { RecordForm } from './Records'
import type { Field, Option } from './Records'
import { money } from './api'

export default function PurchaseForm({ events, accounts, available, onSaved }: {
  events: Option[]; accounts: Option[]; available: Map<string, number>; onSaved: () => void
}) {
  const [items, setItems] = useState([crypto.randomUUID()])
  const [values, setValues] = useState<FormData>()
  const total = items.reduce((sum, id) => {
    const price = String(values?.get(id + '-price') ?? '')
    const quantity = Number(values?.get(id + '-quantity') ?? 0)
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(price) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 9999) return sum
    const [pesos, fraction = ''] = price.split('.')
    return sum + (Number(pesos) * 100 + Number(fraction.padEnd(2, '0'))) * quantity
  }, 0)
  const remaining = available.get(String(values?.get('event_id') ?? ''))
  const fields: Field[] = [
    { key: 'purchased_on', label: 'Purchase date', type: 'date' },
    { key: 'description', label: 'Description' },
    { key: 'vendor', label: 'Vendor' },
    { key: 'category', label: 'Category' },
    { key: 'event_id', label: 'Event', options: events, optional: true },
    { key: 'kind', label: 'Payment status', options: [
      { value: 'expense', label: 'Paid from COMSOC funds' },
      { value: 'payment', label: 'To pay' },
      { value: 'reimbursement', label: 'To reimburse' },
    ] },
    { key: 'source_account', label: 'Paid from account (if paid)', options: accounts, optional: true },
    { key: 'counterparty', label: 'Payee (if outstanding)', optional: true },
  ]

  return <RecordForm resource="purchases" title="Record purchase" fields={fields} onChange={setValues} onSaved={() => {
    setItems([crypto.randomUUID()])
    setValues(undefined)
    onSaved()
  }} prepare={(data) => ({
    ...Object.fromEntries(fields.map(({ key }) => [key, data.get(key)])),
    items: items.map((id) => ({ name: data.get(id + '-name'), quantity: data.get(id + '-quantity'), price: data.get(id + '-price') })),
  })}>
    <fieldset className="grid min-w-0 gap-4 sm:col-span-2">
      <legend className="mb-3 font-semibold">Purchase items</legend>
      {items.map((id, index) => (
        <div key={id} className="grid gap-2 rounded-lg border border-stone-200 p-3 lg:grid-cols-[2fr_1fr_1fr_auto]">
          <label className="field">Item {index + 1}<input name={id + '-name'} required maxLength={200} /></label>
          <label className="field">Quantity<input name={id + '-quantity'} type="number" min="1" max="9999" required /></label>
          <label className="field">Unit price (PHP)
            <input name={id + '-price'} inputMode="decimal" pattern="[0-9]{1,10}([.][0-9]{1,2})?" required />
          </label>
          {items.length > 1 && <button type="button" className="action self-end" aria-label={`Remove item ${index + 1}`}
            onClick={() => setItems(items.filter((item) => item !== id))}>Remove</button>}
        </div>
      ))}
      {items.length < 30 && <button type="button" className="action justify-self-start"
        onClick={() => setItems([...items, crypto.randomUUID()])}>Add item</button>}
      <div aria-live="polite">
        <p className="font-semibold">Estimated total {Number.isSafeInteger(total) ? money(total) : 'is too large'}</p>
        {remaining !== undefined && total > 0 && total > remaining && (
          <p className="rounded-lg bg-amber-50 p-3 text-amber-900">
            This purchase exceeds the event’s available budget of {money(remaining)}. Confirm the amount before saving.
          </p>
        )}
      </div>
    </fieldset>
  </RecordForm>
}
