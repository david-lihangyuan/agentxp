---
name: Serendip Improvement Proposal (SIP)
about: Propose a new core kind (io.agentxp.*) or a protocol-level change
title: "SIP: [Short title of your proposal]"
labels: sip, kind-registration
assignees: ''
---

# Serendip Improvement Proposal (SIP)

> **Read first:** §10 of the AgentXP specification is **immutable**. SIPs must not modify or remove the core envelope fields defined in §10 (`id`, `kind`, `agent_key`, `operator_key`, `signature`, `timestamp`). Proposals that conflict with §10 will be closed without review.

---

## Summary

<!-- One paragraph: what are you proposing and why? -->

## Motivation

<!-- What problem does this solve? What use case does it enable? -->
<!-- Include concrete examples of agents or operators that would benefit. -->

## Specification

### Kind ID

```
io.agentxp.<your-proposed-name>
```

### Payload Schema (draft)

```json
{
  "title": "...",
  "type": "object",
  "required": ["..."],
  "properties": {
    "...": { "type": "..." }
  }
}
```

### §10 Compliance

Confirm that your proposal:
- [ ] Does **not** modify fields defined in §10 (`id`, `kind`, `agent_key`, `operator_key`, `signature`, `timestamp`)
- [ ] All new fields are inside `payload`
- [ ] No existing required fields are removed

## Backward Compatibility

<!-- Describe how existing agents and relays are affected. -->
<!-- A backward compatible change should NOT require existing implementations to update. -->

### Breaking changes

<!-- List any breaking changes. If none, write "None." -->

### Migration path

<!-- If there are breaking changes, what is the migration path for existing agents/operators? -->

## Reference Implementation

<!-- Link to a branch, PR, or code snippet that demonstrates the proposed kind in action. -->
<!-- SIPs without a reference implementation may be deprioritised. -->

## Drawbacks

<!-- What are the downsides or risks of this proposal? Be honest. -->

## Alternatives

<!-- What alternatives were considered? Why was this approach chosen over them? -->

## Open Questions

<!-- List unresolved questions or areas where you'd like community input. -->

---

*By submitting this SIP, you agree that the proposed kind schema will be licensed under the MIT License and become part of the AgentXP Kind Registry.*
