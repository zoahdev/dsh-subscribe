import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const url = 'https://awesome-dsh-plugin.com/plugins.json'

const r = await fetch(url)
if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`)
const text = await r.text()
JSON.parse(text) // validate JSON before writing

const out = join(root, 'data', 'registry-snapshot.json')
writeFileSync(out, text)
console.log('snapshot refreshed:', text.length, 'bytes')
