/**
 * Latest legal document versions (legal-compliance change — AD-4).
 *
 * Both documents ship under ONE shared ISO date: the consent gate treats a
 * user as complete only when BOTH documents carry THIS version. A catalog
 * revision bumps this constant AND the mirror generator's `LEGAL_VERSION`
 * (scripts/generate-legal-markdown.mjs) together — the consent harness pins
 * that sync (U4 test 1.2), and the PostgreSQL `record_legal_acceptance` RPC
 * (migration 0038) stores the exact same string.
 */
export const LATEST_LEGAL_VERSIONS = {
  privacy: '2026-09-18',
  terms: '2026-09-18',
} as const;

/** The shared ISO version string both documents ship under (AD-4). */
export type LegalVersion = (typeof LATEST_LEGAL_VERSIONS)[keyof typeof LATEST_LEGAL_VERSIONS];