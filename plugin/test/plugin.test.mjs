import test from 'node:test'
import assert from 'node:assert/strict'

import {
  searchPlugins,
  registryStats,
  installCommands,
  loadRegistry,
} from '../lib/index.js'

const FIXTURE = {
  version: 2,
  updated: 'fixture',
  plugins: [
    {
      id: 'dsh-plugin-doctor',
      name: 'Plugin Doctor',
      author: 'zoahdev',
      category: 'dev',
      description: 'Health checks for plugins',
      description_zh: '插件健康检查',
      spec: 'github:zoahdev/dsh-plugin-doctor',
      verified: true,
      stars: 0,
    },
    {
      id: 'dsh-context',
      name: 'dsh-context',
      author: 'bowenliang123',
      category: 'ui',
      description: 'Context insight panel',
      description_zh: '上下文洞察面板',
      spec: 'dsh-context',
      verified: false,
      stars: 32,
    },
    {
      id: 'dsh-ads',
      name: 'dsh-ads',
      author: 'Nagi-ovo',
      category: 'fun',
      description: 'Parody ads',
      description_zh: '整活广告',
      spec: 'github:Nagi-ovo/dsh-ads',
      verified: false,
      stars: 357,
    },
  ],
}

test('searchPlugins filters by query, category and verified flag', () => {
  assert.equal(searchPlugins(FIXTURE, { query: 'context' }).total, 1)
  assert.equal(searchPlugins(FIXTURE, { category: 'fun' }).total, 1)
  assert.equal(searchPlugins(FIXTURE, { verifiedOnly: true }).total, 1)
  assert.equal(searchPlugins(FIXTURE, { limit: 1, query: 'dsh' }).plugins.length, 1)
  assert.equal(searchPlugins(FIXTURE, { query: '上下文' }).total, 1, 'zh description searchable')
})

test('registryStats counts totals and categories', () => {
  const stats = registryStats(FIXTURE)
  assert.equal(stats.total, 3)
  assert.equal(stats.verified, 1)
  assert.deepEqual(stats.byCategory, { dev: 1, ui: 1, fun: 1 })
  assert.equal(stats.updated, 'fixture')
})

test('installCommands builds commands for ids and searches', () => {
  const byId = installCommands(FIXTURE, { ids: 'dsh-plugin-doctor,dsh-context' })
  assert.equal(byId.count, 2)
  assert.deepEqual(byId.commands, [
    'dsh plugin --profile web add github:zoahdev/dsh-plugin-doctor',
    'dsh plugin --profile web add dsh-context',
  ])

  const bySearch = installCommands(FIXTURE, { query: 'dsh', profile: 'dev', limit: 2 })
  assert.equal(bySearch.profile, 'dev')
  assert.equal(bySearch.count, 2)

  const unsafe = installCommands(FIXTURE, { ids: 'dsh-ads', profile: 'bad profile; rm' })
  assert.equal(unsafe.profile, 'web', 'unsafe profile falls back to web')
})

test('loadRegistry falls back to the bundled snapshot when offline', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('offline (test)') }
  try {
    const registry = await loadRegistry(new AbortController().signal)
    assert.ok(registry.plugins.length >= 500, `embedded snapshot too small: ${registry.plugins.length}`)
    assert.ok(registry.plugins.every((p) => p.id && p.spec), 'every embedded plugin has id and spec')
  } finally {
    globalThis.fetch = originalFetch
  }
})
