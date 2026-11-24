import type { RuntimeEnv, User } from './auth.js'
import { field, HttpError, json } from './http.js'

const maxBytes = 5 * 1024 * 1024

function mediaType(bytes: Uint8Array) {
  const signature = new TextDecoder().decode(bytes.subarray(0, 8))
  if (signature.startsWith('%PDF-')) return 'application/pdf'
  if (signature.startsWith('GIF87a') || signature.startsWith('GIF89a')) return 'image/gif'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'image/png'
  return null
}

export async function receiptRoute(request: Request, env: RuntimeEnv, path: string, user: User) {
  if (request.method === 'POST' && path === '/api/receipts') {
    if (!env.RECEIPTS) throw new HttpError(403, 'Receipt uploads are disabled for this installation.')
    const length = Number(request.headers.get('Content-Length'))
    if (!Number.isSafeInteger(length) || length <= 0 || length > maxBytes + 16_384) {
      throw new HttpError(413, 'Select a receipt under 5 MB.')
    }
    let form: FormData
    try {
      form = await request.formData()
    } catch {
      throw new HttpError(400, 'Expected a receipt upload.')
    }
    const transaction = field(form.get('transaction_id'), 'transaction', 100, false) || null
    const obligation = field(form.get('obligation_id'), 'obligation', 100, false) || null
    if (Boolean(transaction) === Boolean(obligation)) throw new HttpError(400, 'Choose one transaction or obligation.')
    const file = form.get('receipt')
    if (!(file instanceof File) || file.size === 0 || file.size > maxBytes) {
      throw new HttpError(400, 'Select a receipt under 5 MB.')
    }
    const buffer = await file.arrayBuffer()
    const type = mediaType(new Uint8Array(buffer))
    if (!type) throw new HttpError(415, 'Upload a PDF, PNG, GIF, or JPEG.')
    const filename = field(file.name, 'filename', 255)
    const targetTable = transaction ? 'transactions' : 'obligations'
    const exists = await env.DB.prepare(`SELECT 1 FROM ${targetTable} WHERE id = ?`).bind(transaction ?? obligation).first()
    if (!exists) throw new HttpError(404, 'The record could not be found.')
    const id = crypto.randomUUID()
    await env.RECEIPTS.put(id, buffer, { httpMetadata: { contentType: type } })
    try {
      await env.DB.prepare(`INSERT INTO receipts (id, transaction_id, obligation_id, filename, media_type, created_by)
        VALUES (?, ?, ?, ?, ?, ?)`).bind(id, transaction, obligation, filename, type, user.id).run()
    } catch (error) {
      await env.RECEIPTS.delete(id)
      throw error
    }
    return json({ id }, 201)
  }

  if (request.method === 'GET' && /^\/api\/receipts\/[a-f0-9-]{36}$/.test(path)) {
    const id = path.split('/').pop()!
    const metadata = await env.DB.prepare('SELECT media_type FROM receipts WHERE id = ?')
      .bind(id).first<{ media_type: string }>()
    if (!metadata) throw new HttpError(404, 'Receipt not found.')
    const object = await env.RECEIPTS?.get(id)
    if (!object) throw new HttpError(404, 'Receipt file not found.')
    return new Response(object.body, { headers: {
      'Content-Type': metadata.media_type,
      'Content-Disposition': metadata.media_type === 'application/pdf' ? 'attachment; filename="receipt.pdf"' : 'inline',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    } })
  }
  return null
}
