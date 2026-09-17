/**
 * Props for the TypedConfirmation organism (REQ-ACCTDEL-5).
 *
 * The contract is pinned here so the delete-account screen and any future
 * destructive-flow (e.g. household disband) consumer rely on the same
 * shape. The match rule lives in `./lib/match.ts` — the organism uses
 * it internally to gate the primary button.
 */
export interface TypedConfirmationProps {
  /** Card title (bold). */
  title: string;
  /** Body copy under the title (multi-line OK). */
  body: string;
  /**
   * The exact word the user must type (i18n key — comes from
   * `settings:deleteAccountTypedPrompt`, the canonical es-AR value being
   * `'ELIMINAR'`). Surfaced inline next to the TextInput as a hint so the
   * user knows what to type without scrolling back to the body copy.
   */
  typedPrompt: string;
  /** Controlled value of the TextInput. */
  typedValue: string;
  onTypedValueChange: (v: string) => void;
  /** Filled CTA label (typically the same word as typedPrompt). */
  primaryLabel: string;
  /** Runs after the user types the exact prompt and taps the primary. */
  onPrimary: () => void;
  /**
   * Force-disable the primary button on top of the typed-value match (e.g.
   * a screen-level "deleting…" spinner). Defaults to `false`.
   */
  primaryDisabled?: boolean;
  /**
   * Visual treatment of the primary button. `danger` paints it with
   * `colors.danger` (mirrors `DialogHost.primaryButtonDanger`). Defaults to
   * `'danger'` because the destructive-flow is the primary consumer; an
   * opt-in `'default'` is reserved for future non-destructive flows
   * (e.g. household "disband" rework).
   */
  tone?: 'default' | 'danger';
  /** Outlined dismiss CTA label (typically `common:cancel`). */
  secondaryLabel?: string;
  /** Runs after the dialog hides, when the secondary button is pressed. */
  onSecondary?: () => void;
  /**
   * Optional accessibility hint shown on the TextInput describing the
   * irreversible nature of the action (es-AR: "Esta acción es
   * irreversible"). Surfaces the screen-level a11y copy without coupling
   * the organism to a specific i18n key.
   */
  inputAccessibilityLabel?: string;
  /** Optional hint shown under the TextInput. */
  inputHint?: string;
}
