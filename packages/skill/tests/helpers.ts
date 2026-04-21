// Skill-side alias for the shared in-memory fixtures. Canonical
// implementation lives in @agentxp/supernode/src/testing.ts.
export {
  registerOperatorAndAgent,
  startInMemoryRelay,
} from '../../supernode/src/testing.js'
export type { InMemoryRelay as SkillTestServer } from '../../supernode/src/testing.js'
