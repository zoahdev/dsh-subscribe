/**
 * dsh-subscribe in-harness market server.
 *
 * Mounts HTTP routes on the host webServer so the plugin's storefront UI can
 * browse the registry and install/uninstall/update plugins with one click —
 * the same job dsh-market does, implemented from scratch for dsh-subscribe
 * and layered on top of the Steam-style subscription workflow and the
 * 536-plugin registry.
 *
 * Security model (mirrors the proven dsh-market design):
 *  - every mutating route requires a same-origin POST
 *  - install specs must come from the curated registry, or be explicit
 *    local file:/link: specs the user typed themselves
 *  - every spawn target passes an allowlist regex
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const INBOX_BUNDLES = new Set([
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-headless',
])

export const PROFILE_RE = /^[A-Za-z0-9_-]+$/
export const TARGET_RE = /^[A-Za-z0-9@:./_#+-]+$/

export const BOOT_ID = `${String(process.pid)}-${String(Date.now())}`

export const progress = { active: false, target: '', startedAt: 0, lastLine: '' }

const logLines = []

export function logEvent(level, event, message) {
  logLines.push(`[${new Date().toISOString()}] ${level} ${event}: ${message}`)
  if (logLines.length > 400) logLines.splice(0, logLines.length - 400)
}

export function exportLogs(extra = {}) {
  const head = Object.entries(extra).map(([k, v]) => `${k}: ${String(v)}`).join('\n')
  return `${head}\n${logLines.join('\n')}\n`
}

/** Resolve a profile name to its directory under DSH_HOME (default ~/.dsh). */
export function profileDir(profile) {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'profiles', profile)
}

/** Community dependencies of a profile (in-box bundles filtered out). */
export function readInstalled(profile) {
  try {
    const manifest = JSON.parse(readFileSync(join(profileDir(profile), 'package.json'), 'utf8'))
    const installed = {}
    for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
      if (!INBOX_BUNDLES.has(name)) installed[name] = spec
    }
    return installed
  } catch {
    return {}
  }
}

/** Version present in the profile's node_modules, or null. */
export function readInstalledVersion(profile, name) {
  try {
    return JSON.parse(readFileSync(join(profileDir(profile), 'node_modules', name, 'package.json'), 'utf8')).version ?? null
  } catch {
    return null
  }
}

/** Merge packages into the profile's pnpm-workspace.yaml allowBuilds block. */
export function setAllowBuilds(profile, packages) {
  const file = join(profileDir(profile), 'pnpm-workspace.yaml')
  let yaml = ''
  try { yaml = readFileSync(file, 'utf8') } catch { /* created below */ }
  const blockRe = /allowBuilds:\n((?:[ \t]+[^\n]*\n?)*)/
  const map = {}
  const match = blockRe.exec(yaml)
  if (match !== null) {
    for (const line of match[1].split('\n')) {
      const m = /^[ \t]+([^:\s]+(?:\/[^:\s]+)?)\s*:\s*(\S.*)?$/.exec(line)
      if (m !== null) map[m[1]] = m[2] ?? 'true'
    }
  }
  for (const pkg of packages) {
    if (/^[A-Za-z0-9@/_.-]+$/.test(pkg)) map[pkg] = 'true'
  }
  const block = Object.entries(map).map(([k, v]) => `  ${k}: ${v}`).join('\n')
  const blockText = `allowBuilds:\n${block}\n`
  writeFileSync(file, match !== null ? yaml.replace(blockRe, blockText) : `${yaml.replace(/\n?$/, '\n')}${blockText}`)
  return Object.keys(map)
}

/** Minimal HTTP helpers. */
export function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

export function sameOrigin(request) {
  const origin = request.headers?.origin
  const host = request.headers?.host
  if (origin === undefined || host === undefined) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 4096) throw new Error('request body too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Kill a spawned child and, on Windows, its whole process tree. */
export function killChild(child) {
  if (process.platform === 'win32' && child.pid !== undefined) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
      return
    } catch { /* fall through */ }
  }
  if (child.pid !== undefined) {
    try { process.kill(-child.pid, 'SIGTERM') } catch {
      try { child.kill('SIGTERM') } catch { /* already gone */ }
    }
  }
}

let activeChild = null
let cancelRequested = false

export function cancelActive() {
  if (activeChild === null) return false
  cancelRequested = true
  killChild(activeChild)
  return true
}

/**
 * Run `pnpm dlx @deepseek-ai/dsh plugin --profile <p> ...` (the same real
 * CLI path dsh-subscribe's zero-dependency CLI uses). Blocks the route until
 * the child exits, times out, or is cancelled.
 */
export function runPlugin(profile, pluginArgs, { timeoutMs = 15 * 60 * 1000, env = {} } = {}) {
  return new Promise((resolvePromise) => {
    const args = ['dlx', '@deepseek-ai/dsh', 'plugin', '--profile', profile, ...pluginArgs]
    const target = pluginArgs[pluginArgs.length - 1] ?? ''
    if (!TARGET_RE.test(target)) {
      logEvent('error', 'install', `unsafe plugin target rejected: ${JSON.stringify(target)}`)
      resolvePromise({ exitCode: 1, timedOut: false, cancelled: false, stdout: '', stderr: `unsafe plugin target rejected: ${JSON.stringify(target)}` })
      return
    }
    progress.active = true
    progress.target = target
    progress.startedAt = Date.now()
    progress.lastLine = ''
    cancelRequested = false

    const child = spawn('pnpm', args, {
      env: { ...process.env, CI: 'true', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      detached: process.platform !== 'win32',
    })
    activeChild = child

    let stdout = ''
    let stderr = ''
    let timedOut = false
    const collect = (side) => (chunk) => {
      const text = String(chunk)
      if (side === 'out') stdout = (stdout + text).slice(-64 * 1024)
      else stderr = (stderr + text).slice(-64 * 1024)
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
      if (lines.length > 0) progress.lastLine = lines[lines.length - 1].slice(0, 200)
    }
    child.stdout.on('data', collect('out'))
    child.stderr.on('data', collect('err'))

    const timer = setTimeout(() => {
      timedOut = true
      logEvent('warn', 'install', `timeout after ${timeoutMs}ms: ${target}`)
      killChild(child)
    }, timeoutMs)

    child.on('error', (error) => {
      clearTimeout(timer)
      progress.active = false
      activeChild = null
      resolvePromise({ exitCode: 127, timedOut, cancelled: false, stdout, stderr: error.message })
    })

    child.on('close', (exitCode) => {
      clearTimeout(timer)
      progress.active = false
      activeChild = null
      resolvePromise({ exitCode, timedOut, cancelled: cancelRequested, stdout, stderr })
    })
  })
}

/** Parse "Ignored build scripts: esbuild, koffi." style output. */
export function parseIgnoredBuilds(stdout, stderr) {
  const m = /Ignored build scripts:?\s*([^\n]+)/i.exec(`${stdout}\n${stderr}`)
  if (m === null) return []
  const found = []
  for (const chunk of m[1].split(',')) {
    const trimmed = chunk.trim().replace(/\.$/, '')
    if (trimmed === '') continue
    const at = trimmed.lastIndexOf('@')
    const name = at > 0 ? trimmed.slice(0, at) : trimmed
    if (name !== '' && !found.includes(name)) found.push(name)
  }
  return found
}

/** Per-plugin update checks with a 30-minute TTL cache. */
const UPDATES_TTL_MS = 30 * 60 * 1000
let updatesCache = null

export function invalidateUpdates() {
  updatesCache = null
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'dsh-subscribe' },
    signal: AbortSignal.timeout(4000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function checkUpdates(profile, force = false) {
  if (!force && updatesCache && Date.now() - updatesCache.at < UPDATES_TTL_MS) return updatesCache.data
  const installed = readInstalled(profile)
  const result = {}
  await Promise.all(Object.entries(installed).map(async ([name, spec]) => {
    const version = readInstalledVersion(profile, name)
    if (spec.startsWith('link:') || spec.startsWith('file:')) {
      result[name] = { kind: 'linked', version, current: null, latest: null, updateAvailable: false }
      return
    }
    const gh = /^(?:github:)?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:#.*)?$/.exec(spec)
    try {
      if (spec.startsWith('github:') && gh !== null) {
        const head = await fetchJson(`https://api.github.com/repos/${gh[1]}/commits/HEAD`)
        result[name] = { kind: 'github', version, current: version, latest: head.sha ?? null, updateAvailable: version === null }
      } else {
        const meta = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`)
        const latest = meta.version ?? null
        result[name] = { kind: 'npm', version, current: version, latest, updateAvailable: version !== null && latest !== null && version !== latest }
      }
    } catch {
      result[name] = { kind: spec.startsWith('github:') ? 'github' : 'npm', version, current: null, latest: null, updateAvailable: false }
    }
  }))
  updatesCache = { at: Date.now(), data: result }
  return result
}

/** The exact pnpm spec for a registry entry (npm target wins). */
export function installTargetOf(entry) {
  return entry?.install?.spec ?? null
}

/** True when a spec is either in the registry or an explicit local spec. */
export function allowedInstallSpec(registry, spec) {
  if (registry.plugins.some((p) => p.install?.spec === spec)) return true
  return spec.startsWith('file:') || spec.startsWith('link:')
}

function readUiHtml() {
  try {
    return readFileSync(new URL('./ui/index.html', import.meta.url), 'utf8')
  } catch {
    return '<!doctype html><meta charset="utf-8"><title>dsh-subscribe</title><pre>UI bundle missing</pre>'
  }
}

/**
 * Guard against duplicate route sets when a preset/composition remounts the
 * plugin in the same process. Upstream has a class of bugs where a stale
 * standing generation is not disposed on composition change, which would
 * register webServer routes twice and break remount (deepseek-harness
 * discussion #1862). We defensively dispose the previous set before mounting
 * a new one, keyed by profile.
 */
const activeMounts = new Map()

/**
 * Mount every market route on the host webServer.
 * @param host - host context exposing webServer.register.
 * @param config - { profile, runner? } — runner is injectable for tests.
 * @returns disposer that removes all routes.
 */
export function mountMarketRoutes(host, config) {
  const profile = PROFILE_RE.test(config.profile) ? config.profile : 'web'
  const previousDisposer = activeMounts.get(profile)
  if (previousDisposer !== undefined) {
    logEvent('warn', 'mount', `replacing existing route set for profile ${profile} (idempotent remount)`)
    try { previousDisposer() } catch { /* best-effort */ }
  }
  const run = config.runner ?? ((p, args) => runPlugin(p, args))
  const uiHtml = readUiHtml()
  let installing = false

  const disposers = [
    host.webServer.register({
      kind: 'exact',
      path: '/dsh-subscribe/registry',
      handler: async (request, response) => {
        if (request.method !== 'GET') { response.writeHead(405, { allow: 'GET' }); response.end(); return }
        try {
          const registry = await config.loadRegistry?.() ?? (await import('./index.js')).loadRegistry()
          sendJson(response, 200, { profile, count: registry.plugins.length, verified: registry.verifiedCount, updated: registry.updated, plugins: registry.plugins })
        } catch (error) {
          sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }),

    host.webServer.register({
      kind: 'exact',
      path: '/dsh-subscribe/installed',
      handler: (request, response) => {
        if (request.method !== 'GET') { response.writeHead(405, { allow: 'GET' }); response.end(); return }
        sendJson(response, 200, { profile, installed: readInstalled(profile) })
      },
    }),

    host.webServer.register({
      kind: 'exact',
      path: '/dsh-subscribe/status',
      handler: (request, response) => {
        if (request.method !== 'GET') { response.writeHead(405, { allow: 'GET' }); response.end(); return }
        sendJson(response, 200, {
          profile,
          active: progress.active,
          target: progress.target,
          seconds: progress.active ? Math.round((Date.now() - progress.startedAt) / 1000) : 0,
          lastLine: progress.lastLine,
          boot: BOOT_ID,
          installed: readInstalled(profile),
        })
      },
    }),

    host.webServer.register({
      kind: 'exact',
      path: '/dsh-subscribe/updates',
      handler: async (request, response) => {
        if (request.method !== 'GET') { response.writeHead(405, { allow: 'GET' }); response.end(); return }
        try {
          const force = (request.url ?? '').includes('force=1')
          sendJson(response, 200, { updates: await checkUpdates(profile, force) })
        } catch (error) {
          sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }),

    host.webServer.register({
      kind: 'exact',
      path: '/dsh-subscribe/logs',
      handler: (request, response) => {
        if (request.method !== 'GET') { response.writeHead(405, { allow: 'GET' }); response.end(); return }
        response.writeHead(200, {
          'cache-control': 'no-store',
          'content-type': 'text/plain; charset=utf-8',
          'content-disposition': 'attachment; filename="dsh-subscribe-log.txt"',
        })
        response.end(exportLogs({ platform: `${process.platform} ${process.arch}`, node: process.version, profile }))
      },
    }),

    host.webServer.register({
      kind: 'exact',
      path: '/dsh-subscribe/install',
      handler: async (request, response) => {
        if (request.method !== 'POST') { response.writeHead(405, { allow: 'POST' }); response.end(); return }
        if (!sameOrigin(request)) { sendJson(response, 403, { error: 'untrusted origin' }); return }
        if (installing) { sendJson(response, 409, { error: 'another install is already running' }); return }
        try {
          const body = await readJsonBody(request)
          const spec = typeof body.spec === 'string' ? body.spec : ''
          if (!TARGET_RE.test(spec)) { sendJson(response, 400, { error: 'invalid spec' }); return }
          const registry = await config.loadRegistry?.() ?? (await import('./index.js')).loadRegistry()
          if (!allowedInstallSpec(registry, spec)) {
            logEvent('warn', 'install-rejected', `not in curated registry: ${spec.slice(0, 120)}`)
            sendJson(response, 400, { error: 'plugin is not in the curated registry (use the web storefront or a file:/link: spec)' })
            return
          }
          installing = true
          try {
            const before = new Set(Object.keys(readInstalled(profile)))
            const result = await run(profile, ['add', spec])
            const ok = result.exitCode === 0 && !result.timedOut && !result.cancelled
            if (ok) invalidateUpdates()
            const added = ok ? Object.keys(readInstalled(profile)).filter((name) => !before.has(name)) : []
            const ignoredBuilds = parseIgnoredBuilds(result.stdout, result.stderr)
            logEvent(ok ? 'info' : 'error', 'install', `${spec} exit=${String(result.exitCode)}${result.timedOut ? ' TIMEOUT' : ''}${result.cancelled ? ' CANCELLED' : ''}${ok ? '' : ` stderr=${result.stderr.slice(-300)}`}`)
            sendJson(response, ok ? 200 : 502, {
              ok,
              cancelled: result.cancelled || undefined,
              timedOut: result.timedOut || undefined,
              added,
              ignoredBuilds: ignoredBuilds.length > 0 ? ignoredBuilds : undefined,
              exitCode: result.exitCode,
              stdout: result.stdout,
              stderr: result.stderr,
              installed: readInstalled(profile),
            })
          } finally {
            installing = false
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          logEvent('error', 'install', `route error: ${message}`)
          sendJson(response, 500, { error: message })
        }
      },
    }),

    host.webServer.register({
      kind: 'exact',
      path: '/dsh-subscribe/uninstall',
      handler: async (request, response) => {
        if (request.method !== 'POST') { response.writeHead(405, { allow: 'POST' }); response.end(); return }
        if (!sameOrigin(request)) { sendJson(response, 403, { error: 'untrusted origin' }); return }
        if (installing) { sendJson(response, 409, { error: 'another install is already running' }); return }
        try {
          const body = await readJsonBody(request)
          const name = typeof body.name === 'string' ? body.name : ''
          if (name === 'dsh-subscribe' || name === 'dsh-market') {
            sendJson(response, 400, { error: 'the market cannot uninstall itself; use the dsh CLI' })
            return
          }
          if (!/^[A-Za-z0-9@/_.-]+$/.test(name) || readInstalled(profile)[name] === undefined) {
            sendJson(response, 400, { error: 'plugin is not installed' })
            return
          }
          installing = true
          try {
            const result = await run(profile, ['remove', name])
            const ok = result.exitCode === 0 && !result.timedOut && !result.cancelled
            if (ok) invalidateUpdates()
            sendJson(response, ok ? 200 : 502, {
              ok,
              cancelled: result.cancelled || undefined,
              exitCode: result.exitCode,
              stdout: result.stdout,
              stderr: result.stderr,
              installed: readInstalled(profile),
            })
          } finally {
            installing = false
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          logEvent('error', 'uninstall', `route error: ${message}`)
          sendJson(response, 500, { error: message })
        }
      },
    }),

    host.webServer.register({
      kind: 'exact',
      path: '/dsh-subscribe/update',
      handler: async (request, response) => {
        if (request.method !== 'POST') { response.writeHead(405, { allow: 'POST' }); response.end(); return }
        if (!sameOrigin(request)) { sendJson(response, 403, { error: 'untrusted origin' }); return }
        if (installing) { sendJson(response, 409, { error: 'another install is already running' }); return }
        try {
          const body = await readJsonBody(request)
          const name = typeof body.name === 'string' ? body.name : ''
          const spec = readInstalled(profile)[name]
          if (spec === undefined) { sendJson(response, 400, { error: 'plugin is not installed' }); return }
          if (spec.startsWith('link:') || spec.startsWith('file:')) {
            sendJson(response, 400, { error: 'locally linked plugins update from their checkout' })
            return
          }
          const target = spec.startsWith('github:') ? spec.replace(/#.*$/, '') : `${name}@latest`
          installing = true
          try {
            const result = await run(profile, ['add', target])
            const ok = result.exitCode === 0 && !result.timedOut && !result.cancelled
            if (ok) invalidateUpdates()
            sendJson(response, ok ? 200 : 502, {
              ok,
              cancelled: result.cancelled || undefined,
              target,
              exitCode: result.exitCode,
              stdout: result.stdout,
              stderr: result.stderr,
              installed: readInstalled(profile),
            })
          } finally {
            installing = false
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          logEvent('error', 'update', `route error: ${message}`)
          sendJson(response, 500, { error: message })
        }
      },
    }),

    host.webServer.register({
      kind: 'exact',
      path: '/dsh-subscribe/approve-builds',
      handler: async (request, response) => {
        if (request.method !== 'POST') { response.writeHead(405, { allow: 'POST' }); response.end(); return }
        if (!sameOrigin(request)) { sendJson(response, 403, { error: 'untrusted origin' }); return }
        try {
          const body = await readJsonBody(request)
          const installed = readInstalled(profile)
          const packages = (Array.isArray(body.packages) ? body.packages.map(String) : [])
            .filter((name) => installed[name] !== undefined)
          if (packages.length === 0) { sendJson(response, 400, { error: 'no installed packages given' }); return }
          const approved = setAllowBuilds(profile, packages)
          logEvent('info', 'approve-builds', `allowed build scripts: ${approved.join(', ')}`)
          sendJson(response, 200, { ok: true, approved })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          sendJson(response, 500, { error: message })
        }
      },
    }),

    host.webServer.register({
      kind: 'exact',
      path: '/dsh-subscribe/cancel',
      handler: async (request, response) => {
        if (request.method !== 'POST') { response.writeHead(405, { allow: 'POST' }); response.end(); return }
        if (!sameOrigin(request)) { sendJson(response, 403, { error: 'untrusted origin' }); return }
        if (!cancelActive()) { sendJson(response, 400, { error: 'no operation is running' }); return }
        logEvent('info', 'cancel', `cancelled ${progress.target || 'operation'}`)
        sendJson(response, 200, { ok: true, cancelled: true, target: progress.target })
      },
    }),

    host.webServer.register({
      kind: 'exact',
      path: '/dsh-subscribe',
      handler: (request, response) => {
        if (request.method !== 'GET') { response.writeHead(405, { allow: 'GET' }); response.end(); return }
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        response.end(uiHtml)
      },
    }),

    host.webServer.register({
      kind: 'exact',
      path: '/dsh-subscribe/',
      handler: (request, response) => {
        if (request.method !== 'GET') { response.writeHead(405, { allow: 'GET' }); response.end(); return }
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        response.end(uiHtml)
      },
    }),
  ]

  const disposer = () => {
    for (const dispose of disposers) dispose()
    if (activeMounts.get(profile) === disposer) activeMounts.delete(profile)
  }
  activeMounts.set(profile, disposer)
  return disposer
}
