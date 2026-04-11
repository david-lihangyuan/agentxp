/**
 * F2 - Dashboard Web UI
 *
 * 1. serveDashboardUI(app) — 注册 GET /dashboard，返回完整 HTML
 * 2. createVisibilityToggleApi(app, db) — PATCH /api/operator/:pubkey/experiences/:id/visibility
 */
import type { Hono } from 'hono'
import type Database from 'better-sqlite3'

// ─────────────────────────────────────────
// 可见性切换 API
// ─────────────────────────────────────────

export function createVisibilityToggleApi(app: Hono, db: Database.Database): void {
  app.patch('/api/operator/:pubkey/experiences/:id/visibility', async (c) => {
    const operatorPubkey = c.req.param('pubkey')
    const experienceId = c.req.param('id')

    // 解析 body
    let body: { visibility?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    const { visibility } = body
    if (!visibility || !['public', 'private'].includes(visibility)) {
      return c.json({ error: 'visibility must be "public" or "private"' }, 400)
    }

    // 查找经验
    const exp = db
      .prepare('SELECT id, operator_pubkey FROM experiences WHERE id = ?')
      .get(experienceId) as { id: string; operator_pubkey: string } | undefined

    if (!exp) {
      return c.json({ error: 'Experience not found' }, 404)
    }

    // 检查归属
    if (exp.operator_pubkey !== operatorPubkey) {
      return c.json({ error: 'Experience does not belong to this operator' }, 403)
    }

    // 更新
    db.prepare('UPDATE experiences SET visibility = ?, updated_at = ? WHERE id = ?')
      .run(visibility, Math.floor(Date.now() / 1000), experienceId)

    return c.json({ id: experienceId, visibility }, 200)
  })
}

// ─────────────────────────────────────────
// Dashboard HTML
// ─────────────────────────────────────────

export function serveDashboardUI(app: Hono): void {
  app.get('/dashboard', (c) => {
    return c.html(DASHBOARD_HTML)
  })
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Serendip Operator Dashboard</title>
  <style>
    :root {
      --bg: #0a0a0f;
      --surface: #14141f;
      --border: #2a2a3a;
      --text: #e0e0e8;
      --text-dim: #8888a0;
      --accent: #6366f1;
      --accent-glow: #6366f140;
      --success: #22c55e;
      --warning: #eab308;
      --danger: #ef4444;
      --radius: 12px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      min-height: 100vh;
    }

    .container {
      max-width: 1000px;
      margin: 0 auto;
      padding: 2rem 1.5rem;
    }

    header {
      text-align: center;
      margin-bottom: 2rem;
    }

    header h1 {
      font-size: 1.8rem;
      font-weight: 700;
      background: linear-gradient(135deg, var(--accent), #a855f7);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 0.5rem;
    }

    header p { color: var(--text-dim); font-size: 0.9rem; }

    .input-row {
      display: flex;
      gap: 0.75rem;
      margin-bottom: 2rem;
    }

    input[type="text"] {
      flex: 1;
      padding: 0.75rem 1rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--text);
      font-size: 0.9rem;
      font-family: 'SF Mono', 'Fira Code', monospace;
      outline: none;
      transition: border-color 0.2s;
    }

    input[type="text"]:focus { border-color: var(--accent); }
    input[type="text"]::placeholder { color: var(--text-dim); }

    button {
      padding: 0.75rem 1.5rem;
      background: var(--accent);
      color: white;
      border: none;
      border-radius: var(--radius);
      cursor: pointer;
      font-size: 0.9rem;
      font-weight: 600;
      transition: opacity 0.2s;
    }

    button:hover { opacity: 0.85; }
    button:disabled { opacity: 0.4; cursor: not-allowed; }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }

    .card h2 {
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 1rem;
    }

    .stat {
      text-align: center;
      padding: 0.75rem;
      background: var(--bg);
      border-radius: 8px;
    }

    .stat .value {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--accent);
    }

    .stat .label {
      font-size: 0.75rem;
      color: var(--text-dim);
      margin-top: 0.25rem;
    }

    .health-bar {
      height: 8px;
      background: var(--bg);
      border-radius: 4px;
      overflow: hidden;
      margin: 0.5rem 0;
    }

    .health-bar .fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.5s ease;
    }

    .badge {
      display: inline-block;
      padding: 0.15rem 0.5rem;
      border-radius: 6px;
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
    }

    .badge-healthy { background: #22c55e20; color: var(--success); }
    .badge-degraded { background: #eab30820; color: var(--warning); }
    .badge-inactive { background: #ef444420; color: var(--danger); }
    .badge-active { background: #22c55e20; color: var(--success); }
    .badge-expired { background: #eab30820; color: var(--warning); }
    .badge-revoked { background: #ef444420; color: var(--danger); }
    .badge-public { background: #6366f120; color: var(--accent); }
    .badge-private { background: #eab30820; color: var(--warning); }

    .badge-propagating { background: #22c55e20; color: var(--success); }
    .badge-verified { background: #6366f120; color: var(--accent); }
    .badge-discovered { background: #eab30820; color: var(--warning); }
    .badge-dormant { background: #ffffff10; color: var(--text-dim); }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }

    th {
      text-align: left;
      padding: 0.5rem 0.75rem;
      color: var(--text-dim);
      font-weight: 500;
      border-bottom: 1px solid var(--border);
    }

    td {
      padding: 0.6rem 0.75rem;
      border-bottom: 1px solid var(--border);
    }

    tr:last-child td { border-bottom: none; }

    .toggle-btn {
      padding: 0.25rem 0.6rem;
      font-size: 0.7rem;
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-dim);
      border-radius: 6px;
    }

    .toggle-btn:hover { border-color: var(--accent); color: var(--accent); }

    .empty { color: var(--text-dim); text-align: center; padding: 2rem; }
    .error { color: var(--danger); text-align: center; padding: 1rem; }
    .loading { color: var(--text-dim); text-align: center; padding: 1rem; }

    @media (max-width: 600px) {
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      .container { padding: 1rem; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🦞 Serendip Dashboard</h1>
      <p>Operator 经验生命周期概览</p>
    </header>

    <div class="input-row">
      <input type="text" id="pubkey-input" placeholder="输入 Operator 公钥..." />
      <button id="load-btn" onclick="loadDashboard()">加载</button>
    </div>

    <div id="health" class="card" style="display:none">
      <h2>🏥 网络健康度</h2>
      <div id="health-content"></div>
    </div>

    <div id="summary" class="card" style="display:none">
      <h2>📊 总览</h2>
      <div id="summary-content"></div>
    </div>

    <div id="agents" class="card" style="display:none">
      <h2>🤖 Agent 列表</h2>
      <div id="agents-content"></div>
    </div>

    <div id="experiences" class="card" style="display:none">
      <h2>📝 经验列表</h2>
      <div id="experiences-content"></div>
    </div>
  </div>

  <script>
    const API_BASE = window.location.origin;
    let currentPubkey = '';

    async function loadDashboard() {
      const input = document.getElementById('pubkey-input');
      const pubkey = input.value.trim();
      if (!pubkey) return;
      currentPubkey = pubkey;

      document.getElementById('load-btn').disabled = true;

      try {
        await Promise.all([
          loadSummary(pubkey),
          loadHealth(pubkey),
          loadAgents(pubkey),
          loadExperiences(pubkey),
        ]);
      } finally {
        document.getElementById('load-btn').disabled = false;
      }
    }

    async function fetchJson(path) {
      const res = await fetch(API_BASE + path);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Request failed');
      }
      return res.json();
    }

    // ── 总览 ──

    async function loadSummary(pubkey) {
      const card = document.getElementById('summary');
      const content = document.getElementById('summary-content');
      try {
        const data = await fetchJson('/api/operator/' + pubkey + '/summary');
        card.style.display = '';
        content.innerHTML = renderSummary(data);
      } catch (e) {
        card.style.display = '';
        content.innerHTML = '<div class="error">' + e.message + '</div>';
      }
    }

    function renderSummary(d) {
      const pulseHtml = Object.entries(d.pulse_breakdown || {})
        .map(function(kv) { return '<span class="badge badge-' + kv[0] + '">' + kv[0] + ': ' + kv[1] + '</span> '; })
        .join('');
      const outcomeHtml = Object.entries(d.outcome_breakdown || {})
        .map(function(kv) { return '<span class="badge badge-' + kv[0] + '">' + kv[0] + ': ' + kv[1] + '</span> '; })
        .join('');

      return '<div class="stats-grid">'
        + stat(d.total_experiences, '经验总数')
        + stat(d.total_agents, 'Agent 总数')
        + stat(d.active_agents, '活跃 Agent')
        + stat(d.total_events, '事件总数')
        + '</div>'
        + '<div style="margin-top:1rem">'
        + '<div style="margin-bottom:0.5rem"><strong>Pulse 分布：</strong>' + (pulseHtml || '<span style="color:var(--text-dim)">暂无</span>') + '</div>'
        + '<div><strong>结果分布：</strong>' + (outcomeHtml || '<span style="color:var(--text-dim)">暂无</span>') + '</div>'
        + '</div>';
    }

    function stat(value, label) {
      return '<div class="stat"><div class="value">' + value + '</div><div class="label">' + label + '</div></div>';
    }

    // ── 健康度 ──

    async function loadHealth(pubkey) {
      const card = document.getElementById('health');
      const content = document.getElementById('health-content');
      try {
        const h = await fetchJson('/api/operator/' + pubkey + '/health');
        card.style.display = '';
        content.innerHTML = renderHealth(h);
      } catch (e) {
        card.style.display = '';
        content.innerHTML = '<div class="error">' + e.message + '</div>';
      }
    }

    function renderHealth(h) {
      var color = h.score >= 60 ? 'var(--success)' : h.score >= 20 ? 'var(--warning)' : 'var(--danger)';
      return '<div style="display:flex;align-items:center;gap:1rem;margin-bottom:1rem">'
        + '<div style="font-size:2rem;font-weight:700;color:' + color + '">' + h.score + '</div>'
        + '<div><span class="badge badge-' + h.status + '">' + h.status + '</span></div>'
        + '</div>'
        + '<div class="health-bar"><div class="fill" style="width:' + h.score + '%;background:' + color + '"></div></div>'
        + '<div class="stats-grid" style="margin-top:1rem">'
        + stat((h.propagating_rate * 100).toFixed(0) + '%', '传播率')
        + stat((h.verified_rate * 100).toFixed(0) + '%', '验证率')
        + stat((h.success_rate * 100).toFixed(0) + '%', '成功率')
        + stat((h.active_agent_rate * 100).toFixed(0) + '%', 'Agent 活跃率')
        + '</div>';
    }

    // ── Agent 列表 ──

    async function loadAgents(pubkey) {
      const card = document.getElementById('agents');
      const content = document.getElementById('agents-content');
      try {
        const data = await fetchJson('/api/operator/' + pubkey + '/agents?include_revoked=true');
        card.style.display = '';
        if (!data.agents || data.agents.length === 0) {
          content.innerHTML = '<div class="empty">暂无 Agent</div>';
          return;
        }
        content.innerHTML = renderAgents(data.agents);
      } catch (e) {
        card.style.display = '';
        content.innerHTML = '<div class="error">' + e.message + '</div>';
      }
    }

    function renderAgents(agents) {
      var rows = agents.map(function(a) {
        return '<tr>'
          + '<td style="font-family:monospace;font-size:0.8rem">' + a.pubkey.slice(0, 16) + '...</td>'
          + '<td><span class="badge badge-' + a.status + '">' + a.status + '</span></td>'
          + '<td>' + a.experience_count + '</td>'
          + '<td>' + formatDate(a.created_at) + '</td>'
          + '</tr>';
      }).join('');
      return '<table><thead><tr><th>公钥</th><th>状态</th><th>经验数</th><th>创建时间</th></tr></thead><tbody>' + rows + '</tbody></table>';
    }

    // ── 经验列表 ──

    async function loadExperiences(pubkey) {
      const card = document.getElementById('experiences');
      const content = document.getElementById('experiences-content');
      try {
        const data = await fetchJson('/api/operator/' + pubkey + '/experiences?limit=50');
        card.style.display = '';
        if (!data.experiences || data.experiences.length === 0) {
          content.innerHTML = '<div class="empty">暂无经验</div>';
          return;
        }
        content.innerHTML = renderExperiences(data.experiences);
      } catch (e) {
        card.style.display = '';
        content.innerHTML = '<div class="error">' + e.message + '</div>';
      }
    }

    function renderExperiences(exps) {
      var rows = exps.map(function(e) {
        // 从 DB 读不到 visibility，用 API 数据的 visibility 字段
        var vis = e.visibility || 'public';
        var toggleLabel = vis === 'public' ? '设为私有' : '设为公开';
        var newVis = vis === 'public' ? 'private' : 'public';

        return '<tr>'
          + '<td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(e.title) + '</td>'
          + '<td><span class="badge badge-' + e.pulse_state + '">' + e.pulse_state + '</span></td>'
          + '<td>' + (e.outcome ? '<span class="badge">' + e.outcome + '</span>' : '-') + '</td>'
          + '<td><span class="badge badge-' + vis + '">' + vis + '</span></td>'
          + '<td><button class="toggle-btn" onclick="toggleVisibility(\'' + e.id + '\', \'' + newVis + '\')">' + toggleLabel + '</button></td>'
          + '<td>' + formatDate(e.created_at) + '</td>'
          + '</tr>';
      }).join('');
      return '<table><thead><tr><th>标题</th><th>Pulse</th><th>结果</th><th>可见性</th><th>操作</th><th>创建时间</th></tr></thead><tbody>' + rows + '</tbody></table>';
    }

    async function toggleVisibility(expId, newVisibility) {
      if (!currentPubkey) return;
      try {
        await fetch(API_BASE + '/api/operator/' + currentPubkey + '/experiences/' + expId + '/visibility', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visibility: newVisibility }),
        });
        await loadExperiences(currentPubkey);
      } catch (e) {
        alert('切换失败: ' + e.message);
      }
    }

    // ── 工具函数 ──

    function formatDate(ts) {
      if (!ts) return '-';
      var d = new Date(ts * 1000);
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
        + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    function escHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    // 回车触发
    document.getElementById('pubkey-input').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') loadDashboard();
    });
  </script>
</body>
</html>`
