import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  sameOrigin,
  allowedInstallSpec,
  parseIgnoredBuilds,
  readInstalled,
  setAllowBuilds,
  mountMarketRoutes,
  profileDir,
} from '../lib/market-server.js'

function jsonRequest(method, url, headers = {}, body) {
  if (body === undefined) return { method, url, headers }
  return {
    method,
    url,
    headers,
    [Symbol.asyncIterator]: async function* () {
      yield Buffer.from(JSON.stringify(body))
    },
  }
}

function fakeResponse() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(payload) { this.body = payload },
  }
}

function fakeHost() {
  const routes = []
  return {
    routes,
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
  }
}

const FIXTURE = {
  plugins: [
    { id: 'dsh-plugin-doctor', name: 'Plugin Doctor', install: { target: 'git', spec: 'github:zoahdev/dsh-plugin-doctor' } },
    { id: 'dsh-context', name: 'dsh-context', install: { target: 'npm', spec: 'dsh-context' } },
  ],
}

test('sameOrigin requires a matching Origin and Host', () => {
  assert.equal(sameOrigin({ headers: { origin: 'http://127.0.0.1:4099', host: '127.0.0.1:4099' } }), true)
  assert.equal(sameOrigin({ headers: { origin: 'http://evil.example', host: '127.0.0.1:4099' } }), false)
  assert.equal(sameOrigin({ headers: { host: '127.0.0.1:4099' } }), false)
})

test('allowedInstallSpec accepts registry specs and explicit local specs', () => {
  assert.equal(allowedInstallSpec(FIXTURE, 'github:zoahdev/dsh-plugin-doctor'), true)
  assert.equal(allowedInstallSpec(FIXTURE, 'dsh-context'), true)
  assert.equal(allowedInstallSpec(FIXTURE, 'file:C:/tmp/plugin.tgz'), true)
  assert.equal(allowedInstallSpec(FIXTURE, 'link:../plugin'), true)
  assert.equal(allowedInstallSpec(FIXTURE, 'not-in-registry'), false)
})

test('parseIgnoredBuilds extracts package names', () => {
  const names = parseIgnoredBuilds('Ignored build scripts: esbuild, koffi@1.2.3.', '')
  assert.deepEqual(names, ['esbuild', 'koffi'])
  assert.deepEqual(parseIgnoredBuilds('ok', ''), [])
})

test('readInstalled filters in-box bundles and setAllowBuilds merges safely', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-subscribe-profile-'))
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    const p = profileDir('test')
    mkdirSync(p, { recursive: true })
    writeFileSync(path.join(p, 'package.json'), JSON.stringify({
      dependencies: {
        '@deepseek-ai/dsh-base': '4.0.1',
        'dsh-context': '0.3.0',
        'github:zoahdev/dsh-plugin-doctor': 'github:zoahdev/dsh-plugin-doctor#abc123',
      },
    }), 'utf8')
    const installed = readInstalled('test')
    assert.equal(installed['@deepseek-ai/dsh-base'], undefined)
    assert.equal(installed['dsh-context'], '0.3.0')
    assert.ok(Object.values(installed).some((s) => s.startsWith('github:zoahdev/dsh-plugin-doctor')))

    setAllowBuilds('test', ['esbuild', 'koffi'])
    const yaml = readFileSync(path.join(p, 'pnpm-workspace.yaml'), 'utf8')
    assert.match(yaml, /allowBuilds:/)
    assert.match(yaml, /esbuild: true/)
    setAllowBuilds('test', ['koffi'])
    const yaml2 = readFileSync(path.join(p, 'pnpm-workspace.yaml'), 'utf8')
    assert.equal((yaml2.match(/koffi:/g) ?? []).length, 1, 'no duplicate keys')
  } finally {
    if (oldHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = oldHome
    rmSync(dir, { recursive: true, force: true })
  }
})

test('routes mount, registry GET works, install validates origin/spec, UI serves HTML', async () => {
  const host = fakeHost()
  const calls = []
  const runner = async (profile, args) => {
    calls.push({ profile, args })
    return { exitCode: 0, timedOut: false, cancelled: false, stdout: 'ok', stderr: '' }
  }
  const disposer = mountMarketRoutes(host, {
    profile: 'web',
    runner,
    loadRegistry: async () => FIXTURE,
  })

  const paths = host.routes.map((r) => r.path)
  for (const expected of ['/dsh-subscribe/registry', '/dsh-subscribe/installed', '/dsh-subscribe/status', '/dsh-subscribe/updates', '/dsh-subscribe/logs', '/dsh-subscribe/install', '/dsh-subscribe/uninstall', '/dsh-subscribe/update', '/dsh-subscribe/approve-builds', '/dsh-subscribe/cancel', '/dsh-subscribe', '/dsh-subscribe/']) {
    assert.ok(paths.includes(expected), `missing route ${expected}`)
  }

  const registryRoute = host.routes.find((r) => r.path === '/dsh-subscribe/registry')
  const regRes = fakeResponse()
  await registryRoute.handler(jsonRequest('GET', '/dsh-subscribe/registry'), regRes)
  assert.equal(regRes.status, 200)
  const regBody = JSON.parse(regRes.body)
  assert.equal(regBody.count, 2)

  const installRoute = host.routes.find((r) => r.path === '/dsh-subscribe/install')
  const noOrigin = fakeResponse()
  await installRoute.handler(jsonRequest('POST', '/dsh-subscribe/install', {}, { spec: 'dsh-context' }), noOrigin)
  assert.equal(noOrigin.status, 403, 'install without origin is rejected')

  const okRes = fakeResponse()
  await installRoute.handler(jsonRequest('POST', '/dsh-subscribe/install', { origin: 'http://127.0.0.1:4099', host: '127.0.0.1:4099' }, { spec: 'dsh-context' }), okRes)
  assert.equal(okRes.status, 200)
  assert.deepEqual(calls[0], { profile: 'web', args: ['add', 'dsh-context'] })

  const badRes = fakeResponse()
  await installRoute.handler(jsonRequest('POST', '/dsh-subscribe/install', { origin: 'http://127.0.0.1:4099', host: '127.0.0.1:4099' }, { spec: 'not-in-registry' }), badRes)
  assert.equal(badRes.status, 400)

  const uiRoute = host.routes.find((r) => r.path === '/dsh-subscribe/')
  const uiRes = fakeResponse()
  await uiRoute.handler(jsonRequest('GET', '/dsh-subscribe/'), uiRes)
  assert.equal(uiRes.status, 200)
  assert.match(uiRes.body, /dsh-subscribe/)
  assert.match(uiRes.headers['content-type'], /text\/html/)

  disposer()
})
