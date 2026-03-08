import { createServer } from 'http'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
import { exec } from 'child_process'
import { WebSocketServer, WebSocket } from 'ws'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
import { createConnection } from 'net'
import chokidar from 'chokidar'
import { scanAllSessions } from './scanner.ts'
import type { CockpitState } from './models.ts'

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects')
const IS_DEV = process.env.NODE_ENV !== 'production'

async function findFreePort(start: number): Promise<number> {
  return new Promise((resolve) => {
    const tryPort = (port: number) => {
      const conn = createConnection({ port, host: '127.0.0.1' })
      conn.on('connect', () => { conn.destroy(); tryPort(port + 1) })
      conn.on('error', () => { conn.destroy(); resolve(port) })
    }
    tryPort(start)
  })
}

const REQUESTED_PORT = parseInt(process.env.PORT ?? '3000', 10)
const PORT = await findFreePort(REQUESTED_PORT)

// ── State ────────────────────────────────────────────────────────────────────

let currentState: CockpitState = { sessions: [], lastScan: new Date().toISOString(), totalActiveSessions: 0, totalSubAgents: 0 }
let broadcastTimer: ReturnType<typeof setTimeout> | null = null

// ── WebSocket ────────────────────────────────────────────────────────────────

const clients = new Set<WebSocket>()

function broadcast(data: unknown) {
  const msg = JSON.stringify(data)
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg)
    }
  }
}

function scheduleBroadcast() {
  // Debounce: wait 300ms after last FS change before re-scanning
  if (broadcastTimer) clearTimeout(broadcastTimer)
  broadcastTimer = setTimeout(() => {
    currentState = scanAllSessions()
    broadcast({ type: 'state', payload: currentState })
  }, 300)
}

// ── HTTP Server ──────────────────────────────────────────────────────────────

const server = createServer((req, res) => {
  const url = req.url ?? '/'

  // API: POST /api/hook — receives Claude hook events
  if (req.method === 'POST' && url === '/api/hook') {
    let body = ''
    req.on('data', chunk => (body += chunk))
    req.on('end', () => {
      try {
        const event = JSON.parse(body) as Record<string, unknown>
        console.log('[hook]', event.hook_event_name ?? event.type, event.session_id ?? '')
        // Re-scan immediately on hook events (more accurate than waiting for FS)
        currentState = scanAllSessions()
        broadcast({ type: 'hook', event, state: currentState })
      } catch (e) {
        console.warn('[hook] parse error', e)
      }
      res.writeHead(200).end('ok')
    })
    return
  }

  // API: GET /api/state — full state snapshot
  if (url === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify(currentState))
    return
  }

  // In dev mode, Vite handles the frontend — only serve static in production
  if (!IS_DEV) {
    const clientDir = join(__dirname, '..', 'client')
    let filePath = join(clientDir, url === '/' ? 'index.html' : url)
    if (!existsSync(filePath)) filePath = join(clientDir, 'index.html')
    try {
      const content = readFileSync(filePath)
      const ext = filePath.split('.').pop() ?? 'html'
      const mime: Record<string, string> = {
        html: 'text/html', js: 'application/javascript', css: 'text/css',
        svg: 'image/svg+xml', ico: 'image/x-icon',
      }
      res.writeHead(200, { 'Content-Type': mime[ext] ?? 'text/plain' })
      res.end(content)
    } catch {
      res.writeHead(404).end('Not found')
    }
    return
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('Claude Cockpit API running (dev mode)')
})

// ── WebSocket upgrade ────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (ws) => {
  clients.add(ws)
  console.log(`[ws] client connected (${clients.size} total)`)

  // Send current state immediately on connect
  ws.send(JSON.stringify({ type: 'state', payload: currentState }))

  ws.on('close', () => {
    clients.delete(ws)
    console.log(`[ws] client disconnected (${clients.size} total)`)
  })
})

// ── File Watcher ─────────────────────────────────────────────────────────────

if (existsSync(CLAUDE_PROJECTS_DIR)) {
  console.log(`[watcher] watching ${CLAUDE_PROJECTS_DIR}`)
  const watcher = chokidar.watch(CLAUDE_PROJECTS_DIR, {
    persistent: true,
    ignoreInitial: true,
    depth: 4,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
  })

  watcher.on('change', (path) => {
    if (path.endsWith('.jsonl')) {
      console.log('[watcher] changed:', path.split('/').slice(-3).join('/'))
      scheduleBroadcast()
    }
  })

  watcher.on('add', (path) => {
    if (path.endsWith('.jsonl')) {
      console.log('[watcher] new session:', path.split('/').slice(-3).join('/'))
      scheduleBroadcast()
    }
  })
} else {
  console.warn(`[watcher] ${CLAUDE_PROJECTS_DIR} not found — falling back to 5s polling`)
  setInterval(() => {
    const newState = scanAllSessions()
    broadcast({ type: 'state', payload: newState })
    currentState = newState
  }, 5000)
}

// ── Startup ───────────────────────────────────────────────────────────────────

currentState = scanAllSessions()
console.log(`[scan] found ${currentState.sessions.length} sessions, ${currentState.totalSubAgents} sub-agents`)

// Write port to file so Vite config can read it
import { writeFileSync } from 'fs'
writeFileSync('.cockpit-port', String(PORT))

server.listen(PORT, () => {
  const url = IS_DEV ? `http://localhost:5173` : `http://localhost:${PORT}`
  console.log(`\n  Claude Cockpit API: http://localhost:${PORT}`)
  console.log(`  Open in browser:    ${url}\n`)

  // Open browser
  const cmd = process.platform === 'win32'
    ? `powershell -command "Start-Process '${url}'"`
    : process.platform === 'darwin'
      ? `open ${url}`
      : `xdg-open ${url}`
  exec(cmd, (err) => { if (err) console.warn('[browser] could not open:', err.message) })
})
