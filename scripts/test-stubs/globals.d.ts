/**
 * React Native's `__DEV__` global, which the app reads for dev-only
 * behavior (e.g. `useHomeFeed`'s dev-only error log on failed reads).
 * Plain-node harnesses have no such global — declare it here for the
 * isolated harness tsconfigs (compile), and the harness scripts define it
 * as `false` on `globalThis` before loading compiled modules (runtime),
 * so the compiled modules behave like a Release build.
 */
declare var __DEV__: boolean;
