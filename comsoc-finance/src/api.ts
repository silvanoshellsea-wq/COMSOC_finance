export type Row = Record<string, string | number | null>
export type User = { username: string; display_name: string; role: 'treasurer' | 'auditor' }
export type Session = { user: User | null; setupRequired: boolean }

export async function api<T>(resource: string, data?: FormData | Record<string, unknown>): Promise<T> {
  const isUpload = data instanceof FormData
  const response = await fetch('/api/' + resource, data === undefined ? undefined : {
    method: 'POST',
    headers: isUpload ? undefined : { 'Content-Type': 'application/json' },
    body: isUpload ? data : JSON.stringify(data),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? 'Request failed.')
  return result as T
}

export function money(value: number) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value / 100)
}
