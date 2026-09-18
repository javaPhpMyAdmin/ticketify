import LegalScreen from '@/features/legal/components/LegalScreen';

/**
 * Privacy Policy route (legal-compliance U2): renders the bundled privacy
 * document for the current locale through `LegalScreen`. Registered
 * automatically by Expo Router at `/legal/privacy` (outside the protected
 * stack — the parent layout does not list it, so it renders without the
 * tab bar chrome).
 */
export default function PrivacyRoute() {
  return <LegalScreen document="privacy" />;
}