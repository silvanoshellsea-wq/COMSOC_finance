import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { api, money } from './api'
import { downloadCsv } from './csv'
import type { Row } from './api'

export type Option = { value: string; label: string }
export type Field = {
  key: string; label: string; type?: 'date' | 'month' | 'money' | 'password' | 'file';
  options?: Option[]; optional?: boolean; autoComplete?: string
}
export type Column = { key: string; label: string; money?: boolean; options?: Option[] }

export function RecordForm({ title, fields, resource, onSaved, label = 'Save', upload = false, children, prepare, onChange }: {
  title: string; fields: Field[]; resource: string; onSaved: () => void; label?: string; upload?: boolean
  children?: ReactNode; prepare?: (data: FormData) => Record<string, unknown>
  onChange?: (data: FormData) => void
}) {
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setPending(true)
    setMessage('')
    try {
      await api(resource, upload ? data : prepare ? prepare(data) : Object.fromEntries(data.entries()))
      form.reset()
      setFailed(false)
      setMessage('Saved.')
      onSaved()
    } catch (error) {
      setFailed(true)
      setMessage(error instanceof Error ? error.message : 'The record could not be saved.')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="panel">
      <h2>{title}</h2>
      <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={submit}
        onChange={onChange ? (event) => onChange(new FormData(event.currentTarget)) : undefined}>
        {fields.map((field) => (
          <label key={field.key} className="field">
            {field.label}
            {field.options ? (
              <select name={field.key} required={!field.optional} defaultValue="">
                <option value="">{field.optional ? 'None' : 'Choose an option'}</option>
                {field.options.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select>
            ) : (
              <input name={field.key} required={!field.optional}
                type={field.type === 'money' ? 'text' : (field.type ?? 'text')}
                inputMode={field.type === 'money' ? 'decimal' : undefined}
                pattern={field.type === 'money' ? '[0-9]{1,10}([.][0-9]{1,2})?' : undefined}
                accept={field.type === 'file' ? 'application/pdf,image/png,image/jpeg,image/gif' : undefined}
                autoComplete={field.autoComplete ?? (field.type === 'password' ? 'new-password' : undefined)} />
            )}
          </label>
        ))}
        {children}
        <button type="submit" disabled={pending} className="primary-button justify-self-start disabled:opacity-50">
          {pending ? 'Saving…' : label}
        </button>
      </form>
      {message && <p role={failed ? 'alert' : 'status'}>{message}</p>}
    </section>
  )
}

function display(row: Row, column: Column) {
  const value = row[column.key]
  if (value === null || value === undefined || value === '') return '—'
  return column.options?.find((option) => option.value === value)?.label ??
    (column.money && typeof value === 'number' ? money(value) : String(value))
}

export function RecordTable({ title, rows, columns, receiptLinks = false, report = false }: {
  title: string; rows: Row[]; columns: Column[]; receiptLinks?: boolean; report?: boolean
}) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ key: string; descending: boolean }>()
  const query = search.trim().toLowerCase()
  const shown = rows.filter((row) => columns.some((column) => display(row, column).toLowerCase().includes(query)))
  if (sort) {
    shown.sort((left, right) => {
      const a = left[sort.key]
      const b = right[sort.key]
      const order = typeof a === 'number' && typeof b === 'number'
        ? a - b : String(a ?? '').localeCompare(String(b ?? ''))
      return sort.descending ? -order : order
    })
  }

  function exportCsv() {
    const lines = [columns.map((c) => c.label), ...shown.map((row) => columns.map((column) =>
      column.money && typeof row[column.key] === 'number'
        ? Number(row[column.key]) / 100 : display(row, column),
    ))]
    downloadCsv(title.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-') + '.csv', lines)
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>{title}</h2>
        {report && <div className="flex flex-wrap gap-4 print:hidden">
          <button className="action" onClick={exportCsv}>Export CSV</button>
          <button className="action" onClick={() => window.print()}>Print / Save PDF</button>
        </div>}
      </div>
      <label className="field mt-3 max-w-sm print:hidden">Search {title.toLowerCase()}
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      {shown.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr>{columns.map(({ key, label }) => (
              <th className="px-3 py-2" key={key} scope="col"
                aria-sort={sort?.key === key ? (sort.descending ? 'descending' : 'ascending') : undefined}>
                <button className="min-h-11 text-left" onClick={() => setSort({ key, descending: sort?.key === key && !sort.descending })}>{label}</button>
              </th>
            ))}{receiptLinks && <th scope="col" className="px-3 py-2">File</th>}</tr></thead>
            <tbody>{shown.map((row) => (
              <tr key={String(row.id)} className="border-t border-stone-200">
                {columns.map((column) => <td key={column.key} className="px-3 py-3">{display(row, column)}</td>)}
                {receiptLinks && <td className="px-3 py-3"><a className="action"
                  href={'/api/receipts/' + row.id} target="_blank" rel="noreferrer">Open file</a></td>}
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p role="status">{rows.length ? 'No records match the search.' : 'No records yet.'}</p>}
    </section>
  )
}
