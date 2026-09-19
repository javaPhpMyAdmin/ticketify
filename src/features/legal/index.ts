/**
 * Legal-consent feature barrel (legal-compliance U4/U5).
 *
 *   import { LATEST_LEGAL_VERSIONS, pendingAcceptanceStore } from '@/features/legal';
 */
export { LATEST_LEGAL_VERSIONS } from './legal-versions';
export { ConsentGate } from './components/ConsentGate';
export {
  isConsentComplete,
  shouldShowConsentGate,
  flushDecision,
} from './legal-consent';
export type {
  LegalAcceptanceRow,
  LegalConsentStatus,
} from './legal-consent';
export {
  pendingAcceptanceStore,
  flushPendingAcceptance,
} from './pending-acceptance';
export type { PendingAcceptanceStore } from './pending-acceptance';
export { useLegalConsent } from './use-legal-consent';
export { ACCEPTANCE_WRITE_ERROR_MESSAGE } from './record-acceptance';