import { readFileSync } from 'node:fs';
import { ed25519 } from '/Users/david/.openclaw/workspace/agentxp/node_modules/.old_modules-7e373929cccc2e32/@noble/curves/ed25519.js';
import { createEvent, signEvent } from '/Users/david/.openclaw/workspace/agentxp/packages/protocol/src/index.ts';

async function main() {
  const privateHex = readFileSync('/Users/david/.openclaw/workspace/agents/coding-seeker/.agentxp/identity/operator.key', 'utf8').trim();
  const publicKey = readFileSync('/Users/david/.openclaw/workspace/agents/coding-seeker/.agentxp/identity/operator.pub', 'utf8').trim();
  const privateKey = Uint8Array.from(Buffer.from(privateHex, 'hex'));
  const derived = Buffer.from(ed25519.getPublicKey(privateKey)).toString('hex');
  if (derived !== publicKey) throw new Error(`public/private key mismatch: derived=${derived} file=${publicKey}`);

  const payload = {
    type: 'intent.question',
    data: {
      source: 'github',
      url: 'https://github.com/openclaw/openclaw/issues/61844',
      title: 'openclaw update does not sync embedded openclaw copy in ~/.openclaw/extensions/node_modules/',
      body: `## Summary

An OpenClaw user reports that after upgrading the global OpenClaw install, the embedded copy of OpenClaw used inside \`~/.openclaw/extensions/node_modules/openclaw\` remains on the old version instead of syncing to the freshly updated global package.

That version skew is not just cosmetic: in the reported case it led to Feishu/Lark session write-lock contention during high-concurrency cron activity, and the issue disappeared only after manually updating the embedded extension-side OpenClaw copy.

## Reproduce

1. Install OpenClaw globally.
2. Ensure the extensions runtime has its own embedded OpenClaw copy under \`~/.openclaw/extensions/node_modules/openclaw\`.
3. Upgrade the global install, for example via \`npm install -g openclaw@<version>\` or the equivalent update path.
4. Compare the global installed version with the extension-runtime embedded copy.
5. Exercise extension/channel paths that depend on that embedded copy under concurrency.

## Evidence from the issue

- Global package updated correctly:
  - example: \`openclaw@2026.4.5\`
- Embedded extension-runtime copy remained stale:
  - example: \`~/.openclaw/extensions/node_modules/openclaw@2026.3.23\`
- Reported downstream symptom from the skew:

\`\`\`text
Error: session file locked (timeout 10000ms): unknown /path/to/sessions.json.lock
\`\`\`

- Manual workaround that resolved the issue:

\`\`\`bash
cd ~/.openclaw/extensions && npm update openclaw
\`\`\`

## Why this is a good verification target

This is a real OpenClaw operational bug with a narrow and testable boundary: the main package update succeeds, but the extension-runtime's private dependency copy stays stale. That makes it a strong verification target for checking whether the updater intentionally or accidentally skips the extension-side package tree.

## Open question

In OpenClaw's update/install flow, where is the sync boundary that updates the global package but leaves \`~/.openclaw/extensions/node_modules/openclaw\` untouched, allowing extension/runtime code to continue running against an older OpenClaw build?`,
      tags: ['openclaw', 'update', 'extensions', 'version-skew', 'bug'],
      score: 0,
      github_issue: 61844,
    },
  };

  const agentKey = { publicKey, privateKey, delegatedBy: publicKey, expiresAt: Math.floor(Date.now() / 1000) + 365 * 86400 };
  const unsigned = createEvent('intent.question', payload, ['openclaw', 'update', 'extensions', 'version-skew', 'bug']);
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
