/**
 * Minimal type surface for `@/components` in the home-feed harness.
 *
 * The app barrel cannot load in plain node (react-native components), but
 * the modules under test (`useHomeFeed.ts`, `categories.ts`) only ever
 * import `IconName` from it as a TYPE — the compiled CommonJS output erases
 * the import, so this stub is never required at runtime.
 */
export type IconName = string;
