/**
 * Test double for `react-native` (auth harness). The real package cannot load
 * in plain node (flow syntax). The app code under test only touches
 * `AppState` (focus wiring in `query-client.ts`) and `Platform.OS`; the stub
 * exposes a no-op listener registration so the compiled module runs.
 */
export type AppStateStatus =
  | 'active'
  | 'background'
  | 'inactive'
  | 'unknown'
  | 'extension';

export const Platform = {
  OS: 'ios',
};

export const AppState = {
  addEventListener(
    _type: 'change',
    _listener: (state: AppStateStatus) => void,
  ): { remove: () => void } {
    return { remove: () => {} };
  },
};
