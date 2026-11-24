import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { demoStatements } from './statementModel'
import type { Entry, Statement } from './statementModel'

type StoredStatement = Omit<Statement, 'entries'> & {
  entries: (Omit<Entry, 'receipt'> & { receipt?: { name: string; type: string } })[]
}

export function useStatements(demo: boolean) {
  const [statements, setStatements] = useState<Statement[]>(demo ? demoStatements : [])
  const [loading, setLoading] = useState(!demo)
  const [pending, setPending] = useState(0)
  const [error, setError] = useState('')
  const current = useRef(statements)
  const versions = useRef(new Map<string, number>())
  const uploaded = useRef(new WeakSet<File>())
  const queue = useRef(Promise.resolve())
  const failed = useRef(false)

  async function reload(signal?: AbortSignal) {
    setLoading(true)
    try {
      const rows = await api<{ revision: number; statement: StoredStatement }[]>('statements')
      const results = await Promise.all(rows.map(async ({ statement }) => ({
        ...statement,
        entries: await Promise.all(statement.entries.map(async ({ receipt, ...entry }) => {
          if (!receipt) return entry
          const response = await fetch('/api/statements/' + statement.id + '/' + entry.id, { signal })
          if (!response.ok) throw new Error('A saved receipt could not be loaded.')
          const file = new File([await response.blob()], receipt.name, { type: receipt.type })
          uploaded.current.add(file)
          return { ...entry, receipt: file }
        })),
      })))
      if (signal?.aborted) return
      versions.current = new Map(rows.map(({ revision, statement }) => [statement.id, revision]))
      current.current = results
      setStatements(results)
      failed.current = false
      setError('')
    } catch (failure) {
      if (!signal?.aborted) setError(failure instanceof Error ? failure.message : 'Could not load saved statements.')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    if (demo) return
    const controller = new AbortController()
    void reload(controller.signal)
    return () => controller.abort()
  }, [demo])

  function change(id: string, update: (statement: Statement | undefined) => Statement | undefined) {
    if (loading || failed.current) return
    const previous = current.current.find((row) => row.id === id)
    const next = update(previous)
    const rows = previous
      ? current.current.flatMap((row) => row.id === id ? (next ? [next] : []) : [row])
      : next ? [...current.current, next] : current.current
    current.current = rows
    setStatements(rows)
    if (demo) return

    setPending((count) => count + 1)
    queue.current = queue.current.then(async () => {
      if (failed.current) return
      const form = new FormData()
      const files: File[] = []
      form.set('revision', String(versions.current.get(id) ?? 0))
      if (next) {
        form.set('statement', JSON.stringify({
          ...next,
          entries: next.entries.map(({ receipt, ...entry }) => {
            if (receipt && !uploaded.current.has(receipt)) {
              form.set('receipt:' + entry.id, receipt)
              files.push(receipt)
            }
            return entry
          }),
        }))
      } else form.set('delete', 'yes')
      const result = await api<{ revision: number }>('statements/' + id, form)
      versions.current.set(id, result.revision)
      for (const file of files) uploaded.current.add(file)
    }).catch((failure: unknown) => {
      failed.current = true
      setError(failure instanceof Error ? failure.message : 'Could not save the statement.')
    }).finally(() => setPending((count) => count - 1))
  }

  return { statements, change, loading, pending, error, reload }
}
