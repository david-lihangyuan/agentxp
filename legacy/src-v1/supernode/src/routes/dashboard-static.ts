// Static dashboard file serving — root redirect + HTML/JS/CSS assets
// loaded from supernode/dashboard/ on every request.

import type { Hono } from 'hono'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSP_HEADER = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'"

export interface DashboardStaticDeps {
  /** Absolute path to the directory containing index.html, operator.html, etc. */
  dashboardDir: string
}

export function registerDashboardStaticRoutes(app: Hono, deps: DashboardStaticDeps): void {
  const { dashboardDir } = deps

  function readDashboardFile(filename: string): string {
    try {
      return readFileSync(join(dashboardDir, filename), 'utf8')
    } catch {
      return ''
    }
  }

  app.get('/', (c) => c.redirect('/dashboard', 302))

  app.get('/dashboard', (c) => {
    const html = readDashboardFile('index.html')
    if (!html) return c.json({ error: 'dashboard not found' }, 404)
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': CSP_HEADER,
      },
    })
  })

  app.get('/dashboard/operator', (c) => {
    const html = readDashboardFile('operator.html')
    if (!html) return c.json({ error: 'dashboard not found' }, 404)
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': CSP_HEADER,
      },
    })
  })

  app.get('/dashboard/app.js', (c) => {
    const js = readDashboardFile('app.js')
    if (!js) return c.json({ error: 'not found' }, 404)
    return new Response(js, {
      status: 200,
      headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
    })
  })

  app.get('/dashboard/operator.js', (c) => {
    const js = readDashboardFile('operator.js')
    if (!js) return c.json({ error: 'not found' }, 404)
    return new Response(js, {
      status: 200,
      headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
    })
  })

  app.get('/dashboard/style.css', (c) => {
    const css = readDashboardFile('style.css')
    if (!css) return c.json({ error: 'not found' }, 404)
    return new Response(css, {
      status: 200,
      headers: { 'Content-Type': 'text/css; charset=utf-8' },
    })
  })
}
