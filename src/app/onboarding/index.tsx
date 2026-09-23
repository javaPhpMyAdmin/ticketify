import { Redirect, type Href } from 'expo-router';

/**
 * Root of the `/onboarding` segment — expo-router treats this as the
 * index route. A cold entry on `/onboarding` (deep-link or a stale
 * push) immediately redirects to step-1 so the user always lands on
 * the first slide. The root layout's gate (`src/app/_layout.tsx`)
 * owns the auth-aware routing into the segment.
 *
 * The `Href` cast matches the project convention for typed-routes —
 * the generated route union is stale until the next `expo start`,
 * so new routes get the cast until the next codegen pass.
 */

export default function OnboardingIndex() {
  return <Redirect href={'/onboarding/step-1' as Href} />;
}
