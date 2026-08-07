/**
 * The app gates its mock flags on React Native's `__DEV__` global (so a
 * Release build never compiles the mock branches). Plain-node harnesses
 * have no such global — declare it here for the isolated harness tsconfigs
 * (compile), and the harness scripts define it as `false` on
 * `globalThis` before loading compiled modules (runtime), so the mock
 * config modules load with the mock branches off.
 */
declare var __DEV__: boolean;
