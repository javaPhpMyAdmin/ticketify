/**
 * Test double for `react-i18next` in the budget-currency-mismatch harness.
 *
 * Maps the `settings` keys `BudgetCard` consumes to their real English values
 * (the base copy) so the component render can assert the clarification copy
 * for real. Interpolation is minimal: `{{percent}}` and `{{currency}}`.
 *
 * If `BudgetCard` starts calling a new key, it will surface here as the raw
 * key in the rendered tree rather than silently passing.
 */
type TFunction = (key: string, options?: Record<string, unknown>) => string;

const TRANSLATIONS: Record<string, string> = {
  budgetCardKicker: 'MONTHLY BUDGET',
  budgetLimitLabel: 'Limit:',
  budgetPercentUsed: '{{percent}}% used',
  budgetCurrencyMismatch: 'No spending in {{currency}} this month',
};

const t: TFunction = (key, options) => {
  const raw = TRANSLATIONS[key] ?? key;
  let out = raw;
  for (const [name, value] of Object.entries(options ?? {})) {
    out = out.replace(new RegExp(`\\{\\{${name}\\}\\}`, 'g'), String(value));
  }
  return out;
};

export function useTranslation(_namespaces?: string[] | string) {
  return { t, i18n: { language: 'en' } };
}

export const I18nextProvider = ({ children }: { children: unknown }) =>
  children;

export const initReactI18next = {
  type: '3rdParty',
  init: () => undefined,
} as const;
