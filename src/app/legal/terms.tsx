import LegalScreen from '@/features/legal/components/LegalScreen';

/**
 * Terms & Conditions route (legal-compliance U2): renders the bundled terms
 * document for the current locale through `LegalScreen`. Registered
 * automatically by Expo Router at `/legal/terms` (outside the protected
 * stack — the parent layout does not list it, so it renders without the
 * tab bar chrome).
 */
export default function TermsRoute() {
  return <LegalScreen document="terms" />;
}