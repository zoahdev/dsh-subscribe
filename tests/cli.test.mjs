import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLI = path.join(ROOT, 'scripts', 'dsh-subscribe.mjs')

function node(args, cwd = ROOT) {
  return spawnSync(process.execPath, args, { cwd, encoding: 'utf8' })
}

test('registry passes structural checks', () => {
  const r = node([path.join(ROOT, 'scripts', 'check-registry.mjs')])
  assert.equal(r.status, 0, r.stderr || r.stdout)
  assert.match(r.stdout, /registry OK/)
})

test('CLI list exposes the full merged registry', () => {
  const r = node([CLI, 'list', '--json'])
  assert.equal(r.status, 0, r.stderr || r.stdout)
  const data = JSON.parse(r.stdout)
  assert.ok(data.total >= 500, `expected >=500 plugins, got ${data.total}`)
  assert.ok(data.plugins.some((p) => p.verified), 'expected verified plugins in list')
})

test('CLI subscribe + sync --dry-run works end to end', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-subscribe-cli-test-'))
  try {
    const subs = path.join(dir, 'subs.json')
    const s = node([CLI, 'subscribe', 'dsh-plugin-doctor', '--file', subs])
    assert.equal(s.status, 0, s.stderr || s.stdout)
    assert.match(s.stdout, /subscribed: dsh-plugin-doctor/)

    const sync = node([CLI, 'sync', '--profile', 'web', '--dry-run', '--file', subs])
    assert.equal(sync.status, 0, sync.stderr || sync.stdout)
    assert.match(sync.stdout, /dry-run/)
    assert.match(sync.stdout, /github:zoahdev\/dsh-plugin-doctor/)

    const written = JSON.parse(readFileSync(subs, 'utf8'))
    assert.equal(written.plugins.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('storefront inline script parses', () => {
  const html = readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8')
  const match = /<script>([\s\S]*?)<\/script>/.exec(html)
  assert.ok(match, 'expected an inline script block in docs/index.html')
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-subscribe-html-'))
  try {
    const js = path.join(dir, 'app.mjs')
    writeFileSync(js, match[1])
    const check = spawnSync(process.execPath, ['--check', js], { encoding: 'utf8' })
    assert.equal(check.status, 0, check.stderr || check.stdout)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
