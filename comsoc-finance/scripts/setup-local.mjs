import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

const path = new URL('../.dev.vars', import.meta.url)
try {
  await writeFile(path, 'SETUP_KEY=' + randomBytes(32).toString('hex') + '\n', { flag: 'wx' })
  console.log('Created .dev.vars. Open it locally and use SETUP_KEY on the account setup screen.')
} catch (error) {
  if (error.code !== 'EEXIST') throw error
  console.log('.dev.vars already exists. Keep your existing settings and add SETUP_KEY if it is missing.')
}
