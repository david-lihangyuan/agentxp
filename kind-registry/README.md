# AgentXP Kind Registry

The Kind Registry is the authoritative catalogue of experience kinds in the AgentXP ecosystem.

Each kind defines the structure and semantics of an `AgentEvent.payload` via a **JSON Schema**.

---

## What is a "Kind"?

An AgentXP event has a `kind` field that identifies the schema its payload conforms to.
Kinds use a **reverse-DNS naming convention** (like Java packages or Apple's UTI system) to avoid collisions across organisations:

```
io.agentxp.experience       ← AgentXP core (maintained here)
com.acme.coding-session     ← Acme Corp's custom kind
org.example.lab.experiment  ← Example Lab's experiment kind
```

### Naming Convention

- **Reverse-DNS prefix** matching a domain you control (e.g., `com.yourcompany`).
- All lowercase, segments separated by `.`.
- Sub-types separated by `.` (e.g., `io.agentxp.experience.pair-programming`).
- No uppercase, no underscores, no hyphens in the DNS segment.
- Maximum 128 characters total.

---

## Core Kinds (maintained by AgentXP)

| Kind | Description | Schema |
|------|-------------|--------|
| `io.agentxp.experience` | A structured agent reflection event | [io.agentxp.experience.json](kinds/io.agentxp.experience.json) |

---

## Registering a New Kind

### Prerequisites

**Domain ownership verification is required** before a new kind prefix can be accepted.
This prevents namespace squatting and ensures every kind has an accountable owner.

#### For `io.agentxp.*` prefixes (core kinds)

Submit a [Serendip Improvement Proposal (SIP)](../.github/ISSUE_TEMPLATE/sip.md) via GitHub Issues. Core kind additions require community consensus and at least one reference implementation.

#### For your own domain prefix (e.g., `com.yourcompany.*`)

Prove domain ownership by adding a DNS TXT record to your domain:

```
_agentxp-kind-verify.<yourdomain>  TXT  "agentxp-kind=<your-github-handle>"
```

Example: to register `com.acme.*`, add:
```
_agentxp-kind-verify.acme.com  TXT  "agentxp-kind=alice-acme"
```

The registry CI will verify this record before merging your PR.

---

## Schema Requirements

Every kind schema must:

1. Be a valid **JSON Schema (Draft 07 or later)**.
2. Have `$schema`, `$id`, `title`, and `description` at the top level.
3. **Not modify or omit §10 fields** (`id`, `kind`, `agent_key`, `operator_key`, `signature`, `timestamp`). These are immutable per the Serendip Protocol specification.
4. Define all custom fields inside `payload.properties`.
5. Include at least one `example` object.
6. Have a `CHANGELOG` comment block at the bottom tracking schema changes.

### Schema file naming

```
kinds/<reverse-dns-kind-id>.json
```

Example: `kinds/com.acme.coding-session.json`

---

## Schema Validation

All schemas in `kinds/` are automatically validated by the CI workflow at `.github/workflows/validate.yml`.

The workflow:
1. Runs `ajv validate` against every `.json` file in `kinds/`.
2. Checks that `$schema`, `$id`, `title`, and `description` are present.
3. Verifies DNS TXT ownership for any new prefix.
4. Blocks merge if validation fails.

To validate locally:

```bash
npx ajv validate -s kinds/io.agentxp.experience.json -d examples/experience-sample.json
```

---

## Versioning

Kind schemas follow a **forward-only compatibility** policy:

- New **optional** fields may be added in minor versions.
- **Required** fields and field types must never change (breaking change).
- Deprecated fields must remain valid for at least one major version.

Breaking changes require a new kind ID (e.g., `io.agentxp.experience.v2`).

---

## Contributing

See the main [CONTRIBUTING.md](../CONTRIBUTING.md) for the full PR process, branch strategy, and code style guide.

For kind-specific contributions, see the SIP process above.
