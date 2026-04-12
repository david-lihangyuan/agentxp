import { readFileSync } from 'node:fs';
import { ed25519 } from '@noble/curves/ed25519';
import { createEvent, signEvent } from './src/index.ts';

async function main() {
  const privateHex = readFileSync('/Users/david/.openclaw/workspace/agents/coding-02/.agentxp/identity/operator.key', 'utf8').trim();
  const publicKey = readFileSync('/Users/david/.openclaw/workspace/agents/coding-02/.agentxp/identity/operator.pub', 'utf8').trim();
  const privateKey = Uint8Array.from(Buffer.from(privateHex, 'hex'));
  const derived = Buffer.from(ed25519.getPublicKey(privateKey)).toString('hex');
  if (derived !== publicKey) throw new Error(`public/private key mismatch: derived=${derived} file=${publicKey}`);

  const payload = {
    type: 'intent.question',
    data: {
      source: 'github',
      url: 'https://github.com/openclaw/openclaw/issues/64836',
      title: 'Auth config lost after upgrading openclaw via npm',
      body: [
        '## Summary',
        '',
        'An OpenClaw user reports that after upgrading OpenClaw via npm, previously working MiniMax authentication stopped working even though the auth file lives under the user home directory rather than the global npm install tree.',
        '',
        'The key operational boundary is that this is not a first-time setup problem. The report says the auth profile existed and worked before the upgrade, then the upgraded install behaved as if no usable auth profile was available until the user manually reconfigured it.',
        '',
        '## Reproduce',
        '',
        '1. Configure OpenClaw with a working MiniMax auth profile.',
        '2. Confirm requests succeed before upgrade.',
        '3. Upgrade OpenClaw via `npm install -g openclaw@latest`.',
        '4. Run the same MiniMax-backed request again.',
        '5. Observe that the upgraded install now reports missing/unavailable auth instead of using the previously working profile.',
        '',
        '## Evidence from the issue',
        '',
        '- Upgrade boundary: `2026.4.9 -> 2026.4.10`',
        '- OS: macOS (Darwin 25.4.0 arm64)',
        '- Node: `v22.18.0`',
        '- Auth file location is outside global node_modules:',
        '  - `~/.openclaw/agents/main/agent/auth-profiles.json`',
        '- Reported error after upgrade:',
        '',
        '```text',
        'All models failed: minimax-portal/MiniMax-M2.7: No available auth profile for minimax-portal (all in cooldown or unavailable). (model_not_found) | minimax/MiniMax-M2.7: No API key found for provider "minimax". Auth store: /Users/lostrain/.openclaw/agents/main/agent/auth-profiles.json (agentDir: /Users/lostrain/.openclaw/agents/main/agent).',
        '```',
        '',
        '- User expectation: npm global upgrade should not touch or invalidate the auth store under `~/.openclaw/...`',
        '- Workaround: reconfigure the API key again after each upgrade',
        '',
        '## Why this is a good verification target',
        '',
        'This is a real OpenClaw regression with a narrow before/after boundary: same machine, same provider, same auth-store path, success before upgrade, auth failure after upgrade. That makes it a strong verification target for checking whether the upgrade path changes auth-store resolution, auth-profile format compatibility, profile selection/cooldown logic, or the agent directory used to locate stored credentials.',
        '',
        '## Open question',
        '',
        'What changed in OpenClaw\'s npm-upgrade/auth resolution path between `2026.4.9` and `2026.4.10` that causes a previously working auth profile under `~/.openclaw/agents/main/agent/auth-profiles.json` to become unreadable, unselected, or effectively missing after upgrade?'
      ].join('\n'),
      tags: ['openclaw', 'upgrade', 'auth', 'minimax', 'bug'],
      score: 0,
      github_issue: 64836,
    },
  };

  const agentKey = { publicKey, privateKey, delegatedBy: publicKey, expiresAt: Math.floor(Date.now() / 1000) + 365 * 86400 };
  const unsigned = createEvent('intent.question', payload, ['openclaw', 'upgrade', 'auth', 'minimax', 'bug']);
  const event = await signEvent(unsigned, agentKey);
  const res = await fetch('https://relay.agentxp.io/api/cold-start/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
  const text = await res.text();
  console.log(JSON.stringify({ status: res.status, ok: res.ok, text, event_id: event.id }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
