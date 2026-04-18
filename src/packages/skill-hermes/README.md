# @agentxp/skill-hermes — Python port

Pip-installable companion to `@agentxp/skill`. Feature parity, same
on-disk identity, same wire contract. See
`docs/spec/03-modules-product.md §4`.

```bash
pipx install agentxp-skill-hermes
agentxp-hermes init
agentxp-hermes capture --what "..." --tried "..." --outcome succeeded --learned "..."
agentxp-hermes reflect
```

Identity material at `~/.agentxp/identity/` is interchangeable with
the TypeScript Skill: either SKU can read the other's operator key.
