# AgentXP Plugin — Security Audit

This document enumerates all 36 security measures implemented in the AgentXP OpenClaw plugin.

## 1. Data Sanitization (measures 1–8)

1. **Credential redaction on store** — `sanitizeBeforeStore()` redacts API keys, tokens, private keys, and connection strings before any data reaches the database.
2. **Multi-pattern credential detection** — 12 regex patterns covering OpenAI (sk-*), GitHub (ghp_*, gho_*, github_pat_*), GitLab (glpat-*), Slack (xoxb-*, xoxp-*), AWS (AKIA*), generic key/token prefixes, PEM private keys, and database connection strings.
3. **Prompt injection blocking on publish** — `sanitizeBeforePublish()` rejects lessons containing prompt injection patterns before they leave the local system.
4. **Multi-language injection patterns** — 50+ regex patterns covering English, Chinese (Simplified), Japanese, and Korean prompt injection vectors.
5. **Data exfiltration pattern detection** — Patterns for "output your prompt", "reveal your instructions", "show me your rules" etc.
6. **Role hijacking detection** — Patterns for "enter developer mode", "unrestricted AI", "act as unrestricted" etc.
7. **Invisible unicode detection** — Blocks zero-width spaces, direction overrides, and other invisible characters that can hide malicious content.
8. **Encoding expansion scanning** — Before checking patterns, expands URL-encoded and base64-encoded content to catch encoding bypass attacks.

## 2. FTS5 & Database Security (measures 9–14)

9. **FTS5 query sanitization** — `sanitizeFtsQuery()` strips AND/OR/NOT/NEAR operators and special characters before any MATCH query.
10. **Parameterized queries only** — All database queries use prepared statements with bound parameters. No string interpolation in SQL.
11. **FTS5 runtime detection** — Graceful fallback to LIKE queries if FTS5 is unavailable, preventing crashes on minimal SQLite builds.
12. **WAL mode** — Write-Ahead Logging for safe concurrent access without corruption risk.
13. **Foreign keys enabled** — `PRAGMA foreign_keys = ON` for referential integrity.
14. **No raw params in traces** — `trace_steps` table stores only `toolName` and normalized `action`, never raw parameters or user content.

## 3. Network Security (measures 15–20)

15. **HTTPS-only relay URL** — `validateRelayUrl()` rejects any non-HTTPS relay URL.
16. **Private IP rejection** — Blocks localhost, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, and 0.0.0.0.
17. **Link-local IP rejection** — Blocks 169.254.0.0/16 (including AWS metadata endpoint 169.254.169.254).
18. **IPv6 loopback rejection** — Blocks ::1 and [::1].
19. **URL parsing validation** — Invalid URLs throw and are caught, returning false.
20. **HTTP write operation scope** — Export/publish routes require trusted-operator scope authorization.

## 4. Hook Safety (measures 21–26)

21. **message_sending returns void** — Hook never modifies, cancels, or blocks outgoing messages.
22. **before_tool_call returns void** — Hook never modifies, blocks, or cancels tool calls.
23. **after_tool_call returns void** — Hook only observes results, never alters them.
24. **All hooks wrapped in try-catch** — Every hook factory wraps its body in try-catch to prevent exceptions from breaking the agent pipeline.
25. **No raw content storage in hooks** — message_sending extracts keywords only; raw message content is never persisted.
26. **Session key normalization** — Hooks use conversationId or channelId as session key, never raw user identifiers.

## 5. Code-Level Safety (measures 27–32)

27. **No child_process imports** — Plugin never spawns subprocesses or executes shell commands.
28. **No eval() or new Function()** — No dynamic code execution anywhere in the codebase.
29. **No direct process.env access** — All configuration comes through the plugin config object, not environment variables.
30. **No raw credentials in source** — Source code contains no hardcoded API keys, tokens, or secrets.
31. **ESM strict mode** — TypeScript strict: true with ESM modules prevents common type safety issues.
32. **Explicit .js extensions** — All imports use .js extensions for correct ESM resolution.

## 6. Install & Runtime Safety (measures 33–36)

33. **Idempotent install** — `installIfNeeded()` checks lesson count before importing; safe to call multiple times.
34. **Preloaded lessons sanitized** — Every preloaded lesson passes through `sanitizeBeforeStore()` before insertion, ensuring no credentials survive even if templates are modified.
35. **Identity key non-overwrite** — Serendip identity keys are only generated if not present; existing keys are never replaced.
36. **Cryptographic key generation** — Identity keys use `crypto.randomBytes()` for secure random generation, not Math.random().

---

_Last audited: 2026-04-16_
_Covers: src/**/*.ts, templates/, tests/security.test.ts_
