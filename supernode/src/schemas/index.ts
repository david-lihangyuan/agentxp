// Supernode — Request Body Schemas
// Zod schemas for POST/PATCH bodies. Each schema is a single source of
// truth for one route. Error shape is normalized to { error: string } so
// the public API contract stays unchanged.
//
// Keep this barrel file so route modules can `import { X } from '../schemas'`
// regardless of which sub-module X lives in.

export { parseBody } from './parse-body'
export { SubscriptionBody } from './subscription'
export { RegisterNodeBody } from './nodes'
export { PulseOutcomeBody } from './pulse'
export { ExperienceRelationBody } from './experience'
export { VisibilityBody } from './visibility'
export { VerificationPayload, parseVerificationPayload } from './verification'
export type { VerificationData } from './verification'
export {
  ColdStartStatusBody,
  ColdStartClaimBody,
  ColdStartVerifyBody,
} from './cold-start'
