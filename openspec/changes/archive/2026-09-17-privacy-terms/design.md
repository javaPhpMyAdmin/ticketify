# Design: Privacy Policy + Terms & Conditions (`privacy-terms`)

> **Status**: success · **Artifact store**: both · **Change**: `privacy-terms` · **Phase**: design

## Technical Approach

Option B (hosted pages + in-app links, proposal Decision Log): a pure, injectable external-link opener (`openExternalUrl`) that never throws; a locale-aware legal URL map (`LEGAL_URLS` + `legalUrlFor`) with es-AR fallback and user-owned `example.com` placeholders flagged `TODO(user)`; a "Legal" settings group rendered as a **second** `AccountSettingsList` between the main list and the danger zone (the existing `settings.slice(0, len-1)` split stays untouched); sign-up footer links below the existing footer pairing (pre-auth safe — no session/auth import anywhere in the new libs); 5 new i18n keys across 3 catalogs; and a `scripts/test-legal-links.mjs` harness (opener contract, URL map, resolver, catalog parity) wired into `pnpm test`.

## Architecture Decisions

### AD-1 — Injectable opener signature
`opener: (url: string) => Promise<unknown>` — structural: `WebBrowserResult` ⊂ `unknown` and `boolean` ⊂ `unknown`, so platform opener AND stubs typecheck with zero casts. Exported as `ExternalUrlOpener`.

### AD-2 — `AccountSettingRow` reuse for `legalRows`
Reuse `AccountSettingRow` as-is. Ids `'privacy-policy'`/`'terms-and-conditions'` (distinct from `'delete-account'`); `tone` omitted (neutral); `trailing: { type: 'chevron' }` (consistent tappable affordance); `accessibilityLabel={row.label}` already set by the component (a11y free). Icons `'doc.text'` / `'doc.on.doc'` — verified `IconName` members.

### AD-3 — Legal section insertion in `profile.tsx`
Appending to `settings[]` **breaks** the slice/danger split — rejected (spec REQ-3). Separate `legalRows` + second `AccountSettingsList` in a new `<View style={styles.section}>` inserted between line 361 (main section close) and 363 (danger-zone comment). **Reuses `styles.section` + `styles.sectionTitle`. No new styles.** Slice logic untouched.

### AD-4 — Sign-up footer primitives
Inline `Pressable`/`Text` reuse (one call site; no premature component). One wrapped row under the existing footer `View`: `Text(auth:signUpLegalPrefix)` + `Pressable(settings:privacyPolicy)` + `Text(auth:signUpLegalAnd)` + `Pressable(settings:termsConditions)`. Trailing spaces inside auth.json values (existing convention, `auth.json:37`). `accessibilityRole="link"` + a11y labels from `settings:` keys. Adds `useLocaleStore` import + `activeLocale` selector to sign-up.tsx. Handler fire-and-forget: `onPress={() => void openExternalUrl(legalUrlFor('privacy', activeLocale))}`.

### AD-5 — Harness imports (tsc-compiled TS modules)
Per-test tsconfig + require hook (`test-auth.mjs` style, lines 70-109): `scripts/tsconfig.legal-links-test.json` with paths `@/*` → `./src/*` + `expo-web-browser` → `./scripts/test-stubs/web-browser.ts`; `execFileSync(tsc -p ...)` then dynamic-import CJS emit; `Module._resolveFilename` hook. **`test-stubs/web-browser.ts` extended additively** (shared with test-auth.mjs): add `openBrowserAsync(url)` recording last URL (`__getLastOpenedUrl()`) + resolving `{ type: 'opened' }`; keep existing exports untouched.

### AD-6 — `pnpm test` chain wiring
`"test:legal-links": "node scripts/test-legal-links.mjs"` after `"test:i18n-init"`; chain insert `&& pnpm test:legal-links` between `test:i18n-init` and `test:sql`.

### AD-7 — `legalUrlFor` locale typing (correction: `AppLocale` does not exist)
Real locale union is `SupportedLocale` (`src/i18n/detector.ts:25`), `DEFAULT_LOCALE = 'es-AR'`. Map keys typed `Record<SupportedLocale, string>` (compile-time 3-locale completeness); param typed `string` (runtime fallback for `'fr-FR'` testable without casts). Lookup: `LEGAL_URLS[document][locale as SupportedLocale] ?? LEGAL_URLS[document][DEFAULT_LOCALE]`.

## Module Contracts

```ts
// src/lib/open-external-url.ts (NEW)
import * as WebBrowser from 'expo-web-browser';

export type ExternalUrlOpener = (url: string) => Promise<unknown>;

export async function openExternalUrl(
  url: string,
  opener: ExternalUrlOpener = WebBrowser.openBrowserAsync,
): Promise<boolean> {
  try {
    await opener(url);
    return true;
  } catch {
    return false;
  }
}
```

```ts
// src/lib/legal-urls.ts (NEW)
import { DEFAULT_LOCALE, type SupportedLocale } from '@/i18n/detector';

export type LegalDocument = 'privacy' | 'terms';

export const LEGAL_URLS: Record<LegalDocument, Record<SupportedLocale, string>> = {
  privacy: {
    'es-AR': 'https://example.com/privacy/es-AR', // TODO(user): real URL
    en:      'https://example.com/privacy/en',    // TODO(user): real URL
    'pt-BR': 'https://example.com/privacy/pt-BR', // TODO(user): real URL
  },
  terms: {
    'es-AR': 'https://example.com/terms/es-AR',   // TODO(user): real URL
    en:      'https://example.com/terms/en',      // TODO(user): real URL
    'pt-BR': 'https://example.com/terms/pt-BR',   // TODO(user): real URL
  },
};

export function legalUrlFor(document: LegalDocument, locale: string): string {
  return LEGAL_URLS[document][locale as SupportedLocale] ?? LEGAL_URLS[document][DEFAULT_LOCALE];
}
```

## Integration Points

| File | Action | Precise edits |
|---|---|---|
| `src/lib/open-external-url.ts` | Create | Contract above |
| `src/lib/legal-urls.ts` | Create | Contract above |
| `src/app/(tabs)/profile.tsx` | Modify | Imports; `const activeLocale = useLocaleStore((s) => s.activeLocale);`; `legalRows` after `settings` (:163); legal `<View style={styles.section}>` between :361 and :363. No style additions; slice untouched |
| `src/app/(auth)/sign-up.tsx` | Modify | Imports; `activeLocale` after :27; legal footer block after footer `</View>` (:160); 3 new styles (`legalFooter` row wrap centered + marginTop + gap; link `labelSm` primary 600; text `labelSm` textSecondary) |
| `src/i18n/locales/{es-AR,en,pt-BR}/settings.json` | Modify | `"legalSectionTitle": "LEGAL"`, `"privacyPolicy"` (`Política de privacidad` / `Privacy Policy` / `Política de privacidade`), `"termsConditions"` (`Términos y condiciones` / `Terms & Conditions` / `Termos e condições`) |
| `src/i18n/locales/{es-AR,en,pt-BR}/auth.json` | Modify | `"signUpLegalPrefix"` (`Al continuar aceptás la ` / `By signing up you agree to the ` / `Ao se cadastrar você aceita a `), `"signUpLegalAnd"` (` y los ` / ` and the ` / ` e os `). Trailing spaces intentional |
| `scripts/test-legal-links.mjs` | Create | Harness (below) |
| `scripts/tsconfig.legal-links-test.json` | Create | Per AD-5 |
| `scripts/test-stubs/web-browser.ts` | Modify | Add `openBrowserAsync` + `__getLastOpenedUrl` (additive) |
| `package.json` | Modify | Script + chain per AD-6 |

## Test Plan (`scripts/test-legal-links.mjs`)

1. **Opener contract (REQ-1)** — resolving stub → `true` + exact URL; rejecting stub → `false`, no escape; default opener → stub `openBrowserAsync` recorded URL.
2. **URL map (REQ-2)** — keys `['privacy','terms']`; per doc 3 `SupportedLocale` tags; all 6 values `https://`. **No example.com assertion** (REQ-7 release gate).
3. **Resolver (REQ-2)** — `legalUrlFor('privacy','pt-BR')` → pt-BR URL; `legalUrlFor('terms','fr-FR')` → es-AR; `''` falls back; es-AR → es-AR.
4. **i18n parity (REQ-5)** — full-file `keySet` equality settings.json + auth.json across 3 locales; every legal key exists non-empty, naming locale+key on failure.

Typecheck gate: `pnpm typecheck` covers new `src/` modules; harness tsconfig type-checks includes.

## Work Unit Breakdown

- **WU-1 — Lib layer + contracts**: `open-external-url.ts`, `legal-urls.ts`, additive stub extension, `tsconfig.legal-links-test.json`, harness sections 1–3. TDD RED/GREEN. ~150 lines.
- **WU-2 — i18n keys + Settings Legal group**: harness section 4 first (RED), 6 catalog files, then `profile.tsx`. Depends WU-1. ~160 lines.
- **WU-3 — Sign-up footer + chain wiring**: `sign-up.tsx` + `package.json`. Depends WU-2. ~60 lines.

All additive; rollback = reverse order. Estimated total ~370 changed lines across 10 files — within 800-line budget.

## Risks / Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Placeholder URLs shipped to prod | Med | `TODO(user)` markers grep-able; apply swaps domain; release gate |
| `WebBrowser` on web | Low | Rejection → false silent; dev smoke-check |
| Shared stub change breaks test-auth.mjs | Low | Additive exports only |
| Wrong locale source (should NOT use `localeOverride` = 'auto') | Low | Use `activeLocale` in both screens |
| Trailing spaces in auth values "fixed" | Low | Matches existing convention; note in PR |
| i18n parity drift | Med | Harness wired into `pnpm test` |

## Open Questions

None — all spec ambiguities resolved (AD-1..AD-7). Legal text + hosting remain user-owned (REQ-7), surfaced as release dependencies.

**Next Recommended**: `tasks`