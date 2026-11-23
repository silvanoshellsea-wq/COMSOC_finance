export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('Content-Length')) > 32_768) throw new HttpError(413, 'Request is too large.')
  try {
    const body: unknown = JSON.parse(await request.text())
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error()
    return body as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'Expected a JSON object.')
  }
}

export function field(value: unknown, name: string, max = 200, required = true) {
  if (value == null && !required) return ''
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new HttpError(400, `Enter a valid ${name}.`)
  }
  return value.trim()
}

export function cents(value: unknown, allowZero = false) {
  if (typeof value !== 'string' || !/^\d{1,10}(\.\d{1,2})?$/.test(value)) {
    throw new HttpError(400, 'Enter an amount in PHP with up to two decimal places.')
  }
  const [pesos, fraction = ''] = value.split('.')
  const amount = Number(pesos) * 100 + Number(fraction.padEnd(2, '0'))
  if (!allowZero && amount === 0) throw new HttpError(400, 'Amount must be greater than zero.')
  return amount
}

export function date(value: unknown) {
  const input = field(value, 'date', 10)
  const parsed = new Date(input)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input) || Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== input) throw new HttpError(400, 'Enter a valid date.')
  return input
}

export function json(value: unknown, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('Cache-Control', 'no-store')
  return Response.json(value, { status, headers: responseHeaders })
}
