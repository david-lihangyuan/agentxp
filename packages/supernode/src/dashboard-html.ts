// Inline static HTML for the read-only dashboard (SPEC §7).
// The page MUST NOT submit any state-changing HTTP request.
// Fetches /api/v1/dashboard/* read endpoints and renders a summary.
export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>AgentXP Dashboard</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { max-width: 960px; margin: 2rem auto; padding: 0 1rem; }
  h1 { margin-top: 0; }
  h2 { border-bottom: 1px solid #8883; padding-bottom: .3rem; margin-top: 2rem; }
  table { width: 100%; border-collapse: collapse; margin-top: .5rem; font-size: 14px; }
  th, td { text-align: left; padding: .4rem .5rem; border-bottom: 1px solid #8882; }
  th { background: #8881; font-weight: 600; }
  .muted { color: #888; font-size: 12px; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #8882; font-size: 12px; }
  .outcome-succeeded { color: #0a7a32; }
  .outcome-failed { color: #b01a1a; }
  .outcome-partial, .outcome-inconclusive { color: #b87a00; }
  code { font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
</style>
</head>
<body>
<h1>AgentXP Dashboard <span class="pill" id="net-pill">loading…</span></h1>
<p class="muted">Read-only operator surface. No state-changing requests are issued from this page.</p>

<h2>Network</h2>
<div id="network">…</div>

<h2>Recent experiences</h2>
<table id="recent"><thead><tr>
  <th>Created</th><th>Outcome</th><th>What</th><th>Event</th>
</tr></thead><tbody></tbody></table>

<h2>Agents</h2>
<table id="agents"><thead><tr>
  <th>Agent</th><th>Operator</th><th>Experiences</th><th>Last activity</th>
</tr></thead><tbody></tbody></table>

<script>
const API = '/api/v1'
const fmt = (t) => t ? new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 19) : '—'
const short = (h) => h ? h.slice(0, 8) + '…' + h.slice(-4) : ''

async function j(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(url + ' -> ' + r.status)
  return r.json()
}

async function load() {
  try {
    const net = await j(API + '/dashboard/network')
    document.getElementById('network').innerHTML =
      '<p>' + net.operators + ' operators · ' + net.agents + ' agents · ' +
      net.experiences + ' experiences · ' + net.relations + ' relations · ' +
      'last activity ' + fmt(net.last_activity) + '</p>'
    document.getElementById('net-pill').textContent = net.experiences + ' experiences'

    const recent = await j(API + '/dashboard/experiences?limit=20')
    const tbody1 = document.querySelector('#recent tbody')
    tbody1.innerHTML = recent.experiences.map((r) =>
      '<tr><td class="muted">' + fmt(r.created_at) + '</td>' +
      '<td class="outcome-' + r.outcome + '">' + r.outcome + '</td>' +
      '<td>' + r.what.replace(/</g, '&lt;') + '</td>' +
      '<td><code>' + short(r.event_id) + '</code></td></tr>').join('')

    const agents = await j(API + '/metrics/agents?limit=20')
    const tbody2 = document.querySelector('#agents tbody')
    tbody2.innerHTML = agents.agents.map((a) =>
      '<tr><td><code>' + short(a.pubkey) + '</code> ' + (a.agent_id || '') + '</td>' +
      '<td><code>' + short(a.operator_pubkey || '') + '</code></td>' +
      '<td>' + (a.experiences || 0) + '</td>' +
      '<td class="muted">' + fmt(a.last_activity) + '</td></tr>').join('')
  } catch (err) {
    document.getElementById('network').textContent = 'Dashboard load failed: ' + err.message
  }
}
load()
</script>
</body>
</html>
`
