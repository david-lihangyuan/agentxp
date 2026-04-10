const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.AGENTXP_PORT || 3721;
const CONFIG_PATH = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.agentxp', 'config.json');

let API_BASE = 'https://agentxp.io';
let API_KEY = '';

// Load config from ~/.agentxp/config.json
try {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (config.server_url) API_BASE = config.server_url;
  if (config.api_key) API_KEY = config.api_key;
} catch {
  // Config not found — will auto-register on first start
}

// Auto-register if no API key
async function ensureApiKey() {
  if (API_KEY) return;
  console.log('🔑 No API key found, auto-registering...');
  const agentId = `dashboard-${require('os').hostname()}-${Date.now().toString(36)}`;
  try {
    const body = JSON.stringify({ agent_id: agentId, name: `Dashboard@${require('os').hostname()}` });
    const data = await new Promise((resolve, reject) => {
      const url = new URL('/register', API_BASE);
      const req = https.request({ hostname: url.hostname, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
        let chunks = '';
        res.on('data', c => chunks += c);
        res.on('end', () => resolve(JSON.parse(chunks)));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    if (data.api_key) {
      API_KEY = data.api_key;
      // Save to config
      const configDir = path.dirname(CONFIG_PATH);
      if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(CONFIG_PATH, JSON.stringify({ server_url: API_BASE, api_key: API_KEY, agent_id: agentId }, null, 2));
      console.log(`✅ Registered as ${agentId}`);
      console.log(`   API key saved to ${CONFIG_PATH}`);
    }
  } catch (e) {
    console.error('⚠️  Auto-registration failed:', e.message);
    console.error('   Start the dashboard anyway — some features may not work without an API key.');
  }
}

function proxyApi(apiPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(apiPath, API_BASE);
    const isPost = body !== null;
    const postData = isPost ? JSON.stringify(body) : null;

    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: isPost ? 'POST' : 'GET',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      }
    };

    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(opts, (res) => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => resolve(chunks));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // API proxy
  if (req.url.startsWith('/api/')) {
    try {
      let body = null;
      if (req.method === 'POST') {
        body = await new Promise((resolve) => {
          let d = '';
          req.on('data', c => d += c);
          req.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
        });
      }
      const apiPath = req.url; // /api/search, /api/profile, etc.
      const data = await proxyApi(apiPath, body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /translate proxy
  if (req.url === '/translate' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { texts } = JSON.parse(body);
        if (!texts || !texts.length) { res.writeHead(400); res.end('{"error":"no texts"}'); return; }
        const results = [];
        for (const text of texts) {
          if (!text || !/[a-zA-Z]/.test(text)) { results.push(text); continue; }
          const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;
          const resp = await fetch(url);
          const data = await resp.json();
          const translated = data[0]?.map(s => s[0]).join('') || text;
          results.push(translated);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ translations: results }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // /experiences proxy (browse/filter)
  if (req.url.startsWith('/experiences')) {
    try {
      const data = await proxyApi(req.url, null);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /profile proxy
  if (req.url.startsWith('/profile/')) {
    try {
      const data = await proxyApi(req.url, null);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /stats proxy (no auth needed but we proxy anyway)
  if (req.url === '/stats') {
    try {
      const data = await proxyApi('/stats', null);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    } catch (e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // /health proxy
  if (req.url === '/health') {
    try {
      const data = await proxyApi('/health', null);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    } catch (e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Static files
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, 'public', filePath);

  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  };

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
});

ensureApiKey().then(() => {
  server.listen(PORT, () => {
    console.log(`\n🦞 AgentXP Dashboard running at http://localhost:${PORT}`);
    console.log(`   Server: ${API_BASE}`);
    console.log(`   Config: ${CONFIG_PATH}`);
    if (API_KEY) console.log(`   API Key: ${API_KEY.slice(0, 8)}...`);
    else console.log(`   ⚠️  No API key — register at ${API_BASE}/register`);
  });
});
