import { field, HttpError, json, readBody } from './http.js'

export type User = { id: string; username: string; display_name: string; role: 'treasurer' | 'auditor' }
type Credential = User & { password_hash: string; salt: string }
export type RuntimeEnv = Omit<Env, 'RECEIPTS'> & { SETUP_KEY?: string; RECEIPTS?: R2Bucket }

const encoder = new TextEncoder()
const sessionAge = 8 * 60 * 60

function hex(bytes: ArrayBuffer | Uint8Array) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function hash(value: string) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

function equal(left: string, right: string) {
  if (left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index++) diff |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return diff === 0
}

async function passwordHash(password: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: 600_000,
  }, key, 256)
  return hex(bits)
}

function sessionToken(request: Request) {
  return request.headers.get('Cookie')?.match(/(?:^|;\s*)comsoc_session=([a-f0-9]{64})(?:;|$)/)?.[1]
}

function cookie(request: Request, token: string, age: number) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `comsoc_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure}`
}

export async function currentUser(request: Request, db: D1Database) {
  const token = sessionToken(request)
  if (!token) return null
  return db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).bind(await hash(token), Date.now()).first<User>()
}

async function credentials(password: unknown) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128 || !password.trim()) {
    throw new HttpError(400, 'Use a password of 12 to 128 characters.')
  }
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)))
  return { salt, passwordHash: await passwordHash(password, salt) }
}

export async function authRoute(request: Request, env: RuntimeEnv, path: string, user: User | null) {
  const db = env.DB

  if (request.method === 'GET' && path === '/api/session') {
    const setupRequired = !await db.prepare('SELECT 1 FROM users LIMIT 1').first()
    return json({ user, setupRequired, receiptUploads: Boolean(env.RECEIPTS) })
  }

  if (request.method === 'POST' && path === '/api/setup') {
    if (!env.SETUP_KEY || env.SETUP_KEY.length < 24) throw new HttpError(503, 'Configure a local setup key first.')
    if (await db.prepare('SELECT 1 FROM users LIMIT 1').first()) throw new HttpError(409, 'Setup is complete.')
    const body = await readBody(request)
    const provided = field(body.key, 'setup key', 256)
    if (!equal(await hash(provided), await hash(env.SETUP_KEY))) throw new HttpError(403, 'Invalid setup key.')
    const treasurer = await credentials(body.treasurerPassword)
    const auditor = await credentials(body.auditorPassword)
    const insert = db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)')
    try {
      await db.batch([
        insert.bind('treasurer', 'treasurer', 'Treasurer', 'treasurer', treasurer.passwordHash, treasurer.salt),
        insert.bind('auditor', 'auditor', 'Auditor', 'auditor', auditor.passwordHash, auditor.salt),
      ])
    } catch (error) {
      if (await db.prepare('SELECT 1 FROM users LIMIT 1').first()) throw new HttpError(409, 'Setup is complete.')
      throw error
    }
    return json({ ok: true }, 201)
  }

  if (request.method === 'POST' && path === '/api/login') {
    const body = await readBody(request)
    const username = field(body.username, 'username', 64).toLowerCase()
    const password = body.password
    if (typeof password !== 'string' || password.length > 128) throw new HttpError(401, 'Invalid username or password.')
    const record = await db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<Credential>()
    const now = Date.now()
    const expired = now - 15 * 60 * 1000
    const attempt = await db.prepare(`INSERT INTO auth_attempts VALUES (?, ?, 1)
      ON CONFLICT(username) DO UPDATE SET
        attempts = CASE WHEN started_at < ? THEN 1 ELSE attempts + 1 END,
        started_at = CASE WHEN started_at < ? THEN excluded.started_at ELSE started_at END
      RETURNING attempts`).bind(record?.username ?? '_unknown', now, expired, expired).first<{ attempts: number }>()
    if (attempt && attempt.attempts > 10) throw new HttpError(429, 'Too many sign-in attempts. Try again in 15 minutes.')
    const computed = await passwordHash(password, record?.salt ?? '00000000000000000000000000000000')
    if (!record || !equal(computed, record.password_hash)) throw new HttpError(401, 'Invalid username or password.')
    const token = hex(crypto.getRandomValues(new Uint8Array(32)))
    await db.batch([
      db.prepare('DELETE FROM auth_attempts WHERE username = ?').bind(record.username),
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(Date.now()),
      db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').bind(await hash(token), record.id, Date.now() + sessionAge * 1000),
    ])
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, token, sessionAge) })
  }

  if (request.method === 'POST' && path === '/api/logout') {
    const token = sessionToken(request)
    if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hash(token)).run()
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, '', 0) })
  }

  if (request.method === 'POST' && path === '/api/profile' && user) {
    const body = await readBody(request)
    const name = field(body.displayName, 'display name', 100)
    await db.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind(name, user.id).run()
    return json({ ok: true })
  }

  if (request.method === 'POST' && path === '/api/password' && user) {
    const body = await readBody(request)
    const previous = body.currentPassword
    const record = await db.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first<Credential>()
    if (!record || typeof previous !== 'string' || previous.length > 128 ||
        !equal(await passwordHash(previous, record.salt), record.password_hash)) {
      throw new HttpError(400, 'The current password is incorrect.')
    }
    const next = await credentials(body.newPassword)
    const update = await db.batch([
      db.prepare('UPDATE users SET salt = ?, password_hash = ? WHERE id = ? AND password_hash = ?')
        .bind(next.salt, next.passwordHash, user.id, record.password_hash),
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)')
        .bind(user.id, user.id, next.passwordHash),
    ])
    if (!update[0].meta.changes) throw new HttpError(409, 'The password was already changed. Sign in again.')
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, '', 0) })
  }

  return null
}
