import http from 'node:http'

// #89: temporary loopback server to catch the OAuth callback.
// Listens on the redirect_uri registered with the provider (vendor-fixed
// port: codex localhost:1455, grok 127.0.0.1:56121). Accepts a GET with
// code/state, serves an HTML page and shuts down after the first request.

const OK_HTML = '<!doctype html><meta charset="utf-8"><title>Subscriptions</title><p>Signed in. You can close this tab and return to Settings.</p>'
const ERR_HTML = '<!doctype html><meta charset="utf-8"><title>Subscriptions</title><p>Login failed. Return to Settings and paste the redirected URL.</p>'

function onRequest(port, path, state, onCode, resolve) {
  return (req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)
    if (!url.pathname.startsWith(path)) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(ERR_HTML)
      return
    }
    if (state.done) return
    state.done = true
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    Promise.resolve(onCode(url.searchParams))
      .then((html) => res.end(html || OK_HTML))
      .catch(() => res.end(ERR_HTML))
      .finally(() => {
        clearTimeout(state.timer)
        for (const server of state.servers) server.close()
        resolve({ ok: true })
      })
  }
}

function listen(port, host, handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler)
    const fail = (err) => {
      server.close()
      reject(err)
    }
    server.once('error', fail)
    const opts = host === '::' ? { port, host, ipv6Only: false } : { port, host }
    server.listen(opts, () => {
      server.removeListener('error', fail)
      resolve(server)
    })
  })
}

/**
 * Start the loopback server and wait for the callback.
 * @param {object} opts
 * @param {string} opts.redirectUri  registered redirect_uri (localhost/127.0.0.1)
 * @param {number} opts.timeoutMs    server lifetime
 * @param {(query: URLSearchParams) => Promise<string>} opts.onCode
 * @returns {Promise<{ok: boolean}>}
 */
export function startLoopback({ redirectUri, timeoutMs = 10 * 60 * 1000, onCode }) {
  const parsed = new URL(redirectUri)
  if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new Error(`loopback redirect requires localhost, got ${parsed.hostname}`)
  }
  const port = Number(parsed.port) || 80
  const path = parsed.pathname
  const state = { servers: [], timer: null, done: false }

  const promise = new Promise((resolve, reject) => {
    const handler = onRequest(port, path, state, onCode, resolve)
    const hosts = parsed.hostname === 'localhost' ? ['::', '127.0.0.1'] : [parsed.hostname]
    Promise.all(hosts.map((host) => listen(port, host, handler).catch((err) => {
      if (hosts.length === 1) throw err
      return null
    }))).then((servers) => {
      state.servers = servers.filter(Boolean)
      if (!state.servers.length) {
        reject(new Error(`loopback listen failed on port ${port}`))
        return
      }
      state.timer = setTimeout(() => {
        if (state.done) return
        state.done = true
        for (const server of state.servers) server.close()
        reject(new Error('loopback timeout: no callback received'))
      }, timeoutMs)
    }).catch((err) => {
      state.done = true
      reject(err)
    })
  })
  return promise
}
