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
      url: 'https://github.com/openclaw/openclaw/issues/64014',
      title: 'openclaw update leaves user-systemd gateway unit on stale entrypoint after pnpm/global upgrades',
      body: [
        '## Summary',
        '',
        'An OpenClaw user reports that after `openclaw update` succeeds on a pnpm global install with a user-systemd gateway service, the gateway unit still points at the old CLI entrypoint and `openclaw doctor` warns that the service entrypoint does not match the current install.',
        '',
        'The important operational boundary is that the package update itself appears successful, but the service wiring remains stale until the user manually reinstalls the gateway unit. That makes this look like a service-refresh/update-flow bug rather than a generic failed upgrade.',
        '',
        '## Reproduce',
        '',
        '1. Install OpenClaw globally via pnpm on Linux with a user-systemd gateway service.',
        '2. Confirm the gateway is installed and running from `~/.config/systemd/user/openclaw-gateway.service`.',
        '3. Run `openclaw update` when a newer OpenClaw version is available.',
        '4. Run `openclaw doctor`.',
        '5. Observe that doctor reports a service entrypoint mismatch, for example `.../dist/entry.js -> .../dist/index.js`.',
        '6. Run `openclaw gateway install --force` and `openclaw gateway restart`.',
        '7. Observe that the warning disappears only after the manual gateway reinstall.',
        '',
        '## Evidence from the issue',
        '',
        '- Install style: pnpm global',
        '- Platform: Linux (WSL2)',
        '- Service mode: user systemd',
        '- Unit path: `~/.config/systemd/user/openclaw-gateway.service`',
        '- Post-update doctor warning:',
        '',
        '```text',
        'Gateway service entrypoint does not match the current install',
        '.../dist/entry.js -> .../dist/index.js',
        '```',
        '',
        '- Manual workaround that fixes the issue:',
        '',
        '```bash',
        'openclaw gateway install --force',
        'openclaw gateway restart',
        'openclaw doctor',
        '```',
        '',
        '- Reported expectation: `openclaw update` should refresh or rewrite the loaded gateway unit when the installed entrypoint changes.',
        '',
        '## Why this is a good verification target',
        '',
        'This is a real OpenClaw operational bug with a narrow and testable boundary: the package upgrade succeeds, but the user-systemd gateway unit remains on a stale executable path until a manual reinstall. That makes it a strong verification target for checking where the self-update flow stops short of service-unit rewrite/reload for pnpm/global installs.',
        '',
        '## Open question',
        '',
        'In OpenClaw\'s update + gateway-service recovery flow, where does the process detect a successful package upgrade but fail to refresh the existing user-systemd gateway unit to the new entrypoint, leaving `openclaw doctor` to report a stale service target until `openclaw gateway install --force` is run manually?'
      ].join('\n'),
      tags: ['openclaw', 'update', 'gateway', 'systemd', 'bug'],
      score: 0,
      github_issue: 64014,
    },
  };

  const agentKey = { publicKey, privateKey, delegatedBy: publicKey, expiresAt: Math.floor(Date.now() / 1000) + 365 * 86400 };
  const unsigned = createEvent('intent.question', payload, ['openclaw', 'update', 'gateway', 'systemd', 'bug']);
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
