# @agentxp/plugin

**Let every AI agent learn from experience.**

AgentXP is an OpenClaw plugin that gives your AI agent a memory of what worked and what didn't. It automatically extracts lessons from tool call patterns, injects relevant past experiences into prompts, and optionally shares knowledge across agents.

## Install

```bash
openclaw plugins install @agentxp/plugin
```

## How It Works (30-Second Version)

1. **Auto-inject** — When your agent starts a task, AgentXP searches its local lesson database for relevant past experiences and injects them into the system prompt (~500 tokens).

2. **Auto-extract** — When the agent finishes, AgentXP analyzes the tool call sequence (error → fix → success patterns, read → edit → test-pass patterns) and extracts any new lessons learned.

3. **Distill** — Over time, similar lessons are grouped and distilled into higher-quality, deduplicated knowledge.

4. **Optional network sharing** — In `network` mode, publish lessons to a relay so other agents can benefit from your agent's experience.

```
Agent runs → tool calls recorded → patterns detected → lesson stored
                                                          ↓
Next run → keywords extracted → relevant lessons found → injected into prompt
```

## Configuration

AgentXP works out of the box with zero configuration. To customize:

```yaml
# In your OpenClaw plugin config
agentxp:
  mode: local        # 'local' (default) or 'network'
  relayUrl: https://relay.agentxp.io  # only used in network mode
```

| Option | Default | Description |
|--------|---------|-------------|
| `mode` | `local` | `local` = all data stays on your machine. `network` = can publish/pull from relay. |
| `relayUrl` | `https://relay.agentxp.io` | Relay server URL for network mode. Must be HTTPS. |

### Code-Level Defaults (not exposed in config UI)

| Option | Default | Description |
|--------|---------|-------------|
| `maxInjectionTokens` | `500` | Max tokens injected per request |
| `autoPublish` | `false` | Auto-publish extracted lessons to relay |
| `weaning.enabled` | `true` | Probabilistically skip injection to measure agent independence |
| `weaning.rate` | `0.1` | Skip rate (10%) — measures how much the agent relies on injected lessons |
| `weeklyDigest` | `true` | Generate weekly learning digest |

## Commands

Use `/xp` in chat to manage AgentXP:

| Command | Description |
|---------|-------------|
| `/xp status` | Show lesson count, injection stats, mode, and state |
| `/xp pause` | Pause injection and extraction |
| `/xp resume` | Resume after pause |
| `/xp unpublish` | Unpublish the most recently published lesson |

## CLI

```bash
# Check plugin health and stats
openclaw agentxp status

# Diagnose issues — pattern detection on traces and lessons
openclaw agentxp diagnose

# Run distillation — deduplicate and consolidate similar lessons
openclaw agentxp distill

# Export lessons to JSON
openclaw agentxp export [--output lessons.json]
```

## Token Usage

AgentXP adds **~500 tokens per request** to the system prompt when relevant lessons are found. This is controlled by the `maxInjectionTokens` setting.

- If no relevant lessons match the current context → **0 additional tokens**
- Weaning mechanism (10% default) periodically skips injection to measure agent independence
- All injected content is wrapped in safe XML-like tags marked `executable="false"`

## Security

AgentXP is designed with security as a first-class concern:

- **Local-only by default** — all data stays in a local SQLite database. Nothing leaves your machine unless you explicitly enable `network` mode.
- **No environment variable access** — the plugin never reads `process.env`. No secrets can leak through lesson extraction.
- **Credential redaction** — API keys, tokens, private keys, and connection strings are automatically redacted before storage (supports 12+ credential patterns including GitHub, OpenAI, AWS, Slack, etc.).
- **Prompt injection protection** — All injected content is wrapped in `<external_experience executable="false">` tags with a safety header. Content is HTML-entity-escaped. Known injection patterns are detected and blocked before publish.
- **Invisible unicode detection** — Zero-width characters and direction overrides are detected and rejected before publishing.
- **SSRF protection** — Relay URLs are validated: must be HTTPS, no private/reserved IP ranges, no localhost.
- **Encoding bypass prevention** — URL-encoded and base64-encoded payloads are expanded and scanned for threats.
- **No raw params stored** — Tool call traces only store tool names and actions, never raw parameters or file contents.

For the full security model, see [SECURITY.md](./SECURITY.md).

## How It Compares

| Aspect | AgentXP (Learned Experience) | Traditional Skills |
|--------|-----------------------------|--------------------|
| Source | Auto-extracted from agent behavior | Hand-written by humans |
| Certainty | 19–87% contextual relevance | 100% deterministic execution |
| Update cycle | Continuous (every session) | Manual maintenance |
| Token cost | ~500/request | Varies (often 1K–5K) |
| Knowledge type | "What worked" patterns | "How to do X" procedures |

AgentXP complements skills — it fills in the gaps that rigid procedures can't cover.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   OpenClaw Agent                 │
├────────────┬──────────────┬─────────────────────┤
│ message_   │ before/after │ agent_end           │
│ sending    │ _tool_call   │                     │
│ hook       │ hooks        │ hook                │
├────────────┴──────────────┴─────────────────────┤
│              AgentXP Plugin                      │
├──────────┬────────────┬──────────┬──────────────┤
│ Context  │ Injection  │ Extract  │ Memory       │
│ Cache    │ Engine     │ Engine   │ Corpus       │
├──────────┴────────────┴──────────┴──────────────┤
│             SQLite (local_lessons, FTS5)         │
└─────────────────────────────────────────────────┘
```

## Development

```bash
# Build
npm run build

# Type-check
npm run typecheck

# Run tests
npm run test

# Watch mode
npm run test:watch
```

## License

MIT
