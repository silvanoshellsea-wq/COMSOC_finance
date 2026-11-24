import { readFile, unlink } from 'node:fs/promises'
import { createBuilder } from 'vite'

process.env.CLOUDFLARE_ENV = 'production'
const builder = await createBuilder()
await builder.buildApp()

const output = new URL('../dist/comsoc_finance/', import.meta.url)
const config = JSON.parse(await readFile(new URL('wrangler.json', output), 'utf8'))
if (config.r2_buckets?.length || config.d1_databases?.[0]?.database_name !== 'comsoc-finance-hosted') {
  throw new Error('Hosted output must use the hosted D1 database with no R2 bindings.')
}

try {
  await unlink(new URL('.dev.vars', output))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
