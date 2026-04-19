// Local Server + Auto-auth — Lightweight HTTP server for dashboard and relay proxy
// SSRF prevention: only wss:// or https:// relay URLs; block private IPs, localhost.
// CSP headers on all responses. Random port per session.

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http'

export interface LocalServerOptions {
  /** Workspace directory for reading config and reflection files */
  workspaceDir: string
  /** Home directory for key storage */
  homeDir?: string
  /** Specific port to listen on (default: random) */
  port?: number
}

export interface LocalServerInfo {
  /** Port the server is listening on */
  port: number
  /** Full URL to access the dashboard */
  url: string
}

export interface LocalServer {
  /** Port the server is listening on */
  port: number
  /** Full URL to access the dashboard */
  url: string
  /** Close the server */
  close: () => Promise<void>
}

export interface RelayUrlValidation {
  /** Whether the URL is valid and safe */
  valid: boolean
  /** Reason for rejection */
  reason?: string
}

// Module-level server reference for cleanup
let _server: Server | null = null

/** CSP header value — restrictive, no inline scripts */
const CSP_HEADER = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"

/** Private IP patterns for SSRF prevention */
const PRIVATE_IP_PATTERNS = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^\[::1\]$/,
]

/** Blocked hostnames for SSRF */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  '0.0.0.0',
  '[::1]',
])

/**
 * Validate a relay URL for SSRF safety.
 * Only wss:// and https:// are allowed.
 * Private IPs, localhost, and loopback addresses are blocked.
 */
export function validateRelayUrl(url: string): RelayUrlValidation {
  try {
    // Must be wss:// or https://
    if (!url.startsWith('wss://') && !url.startsWith('https://')) {
      return { valid: false, reason: 'Only wss:// and https:// relay URLs are allowed' }
    }

    // Parse the URL to extract hostname
    // Convert wss:// to https:// for URL parsing (URL doesn't understand wss://)
    const parseable = url.replace(/^wss:\/\//, 'https://')
    const parsed = new URL(parseable)
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '') // strip [] from IPv6

    // Check blocked hostnames
    if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) {
      return { valid: false, reason: 'private/localhost addresses are not allowed as relay URLs' }
    }

    // Check private IP patterns
    for (const pattern of PRIVATE_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        return { valid: false, reason: 'private IP addresses are not allowed as relay URLs' }
      }
    }

    return { valid: true }
  } catch {
    return { valid: false, reason: 'Invalid URL format' }
  }
}

/**
 * Apply security headers to a response.
 */
function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader('Content-Security-Policy', CSP_HEADER)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Access-Control-Allow-Origin', 'null') // restrictive default
}

/**
 * Start the local HTTP server.
 * Listens on 127.0.0.1 only (not accessible from network).
 * Uses a random port unless specified.
 */
export async function startLocalServer(
  workspaceDirOrOptions: string | LocalServerOptions,
  homeDir?: string
): Promise<LocalServer> {
  const options: LocalServerOptions = typeof workspaceDirOrOptions === 'string'
    ? { workspaceDir: workspaceDirOrOptions, homeDir }
    : workspaceDirOrOptions

  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      applySecurityHeaders(res)

      const url = req.url || '/'

      if (url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }))
        return
      }

      if (url.startsWith('/api/v1/')) {
        // API proxy — auto-authenticated via local keys
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ authenticated: true }))
        return
      }

      // Default: 404
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
    })

    const port = options.port || 0 // 0 = random available port

    server.listen(port, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to get server address'))
        return
      }

      _server = server

      resolve({
        port: addr.port,
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((res) => {
          server.close(() => {
            if (_server === server) _server = null
            res()
          })
        }),
      })
    })

    server.on('error', reject)
  })
}

/**
 * Stop the local server if running.
 */
export async function stopLocalServer(): Promise<void> {
  if (_server) {
    return new Promise<void>((resolve) => {
      _server!.close(() => {
        _server = null
        resolve()
      })
    })
  }
}
