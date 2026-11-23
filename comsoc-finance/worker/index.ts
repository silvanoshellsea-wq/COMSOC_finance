import { authRoute, currentUser } from './auth.js'
import type { RuntimeEnv } from './auth.js'
import { financeRoute } from './finance.js'
import { HttpError, json } from './http.js'
import { receiptRoute } from './receipts.js'
import { workflowRoute } from './workflows.js'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    try {
      if (!url.pathname.startsWith('/api/')) return new Response(null, { status: 404 })
      if (request.method !== 'GET' && request.headers.get('Origin') !== url.origin) {
        throw new HttpError(403, 'Request origin does not match the application.')
      }
      const user = await currentUser(request, env.DB)
      const auth = await authRoute(request, env, url.pathname, user)
      if (auth) return auth
      if (!user) throw new HttpError(401, 'Sign in to continue.')

      return await receiptRoute(request, env, url.pathname, user) ??
        await workflowRoute(request, env, url.pathname.slice('/api/'.length), user) ??
        await financeRoute(request, env, url.pathname, user) ??
        json({ error: 'Endpoint not found.' }, 404)
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status)
      console.error(error instanceof Error ? error.message : 'Unexpected request failure.')
      return json({ error: 'The request could not be completed.' }, 500)
    }
  },
} satisfies ExportedHandler<RuntimeEnv>
