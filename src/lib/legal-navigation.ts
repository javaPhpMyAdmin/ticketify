/**
 * In-app legal document navigation (legal-compliance U5, AD-8).
 *
 * One typed seam for every "open the privacy/terms document" call site —
 * the sign-up consent checkbox + footer, the profile Legal rows, and the
 * consent gate links. All of them route IN-APP to `/legal/{document}` (the
 * bundled LegalScreen, reachable pre-auth and while gated) instead of the
 * external browser. `openExternalUrl` (REQ-1) stays available for the
 * unchanged hosted-URL contract in `legal-urls.ts`.
 */
import { router, type Href } from 'expo-router';

import type { LegalDocument } from '@/lib/legal-urls';

export function openLegalDocument(document: LegalDocument): void {
  // The /legal routes live in the app dir; when expo's typed-routes file is
  // present (local dev) the template-literal path needs the Href cast — the
  // generated union may be stale until the next `expo start`.
  router.push(`/legal/${document}` as Href);
}