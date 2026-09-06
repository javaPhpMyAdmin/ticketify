/**
 * Test double for `expo-router` in the render harness.
 *
 * The drill-down screen reads its route params through
 * `useLocalSearchParams` and navigates back through `router.back()`; the
 * real package needs the native navigation container. The stub serves the
 * params a test chooses (`__setRouteParams`) and records navigation calls
 * (`__lastNav`) so a test can pin when the screen navigates.
 */
export type RouteParams = Record<string, string | undefined>;

let routeParams: RouteParams = {};
let lastNav: string | null = null;

export function __setRouteParams(params: RouteParams): void {
  routeParams = params;
}

export function __lastNav(): string | null {
  return lastNav;
}

export function useLocalSearchParams<T extends RouteParams = RouteParams>(): T {
  return routeParams as T;
}

export const router = {
  back: () => {
    lastNav = 'back';
  },
  push: (href: string) => {
    lastNav = `push:${href}`;
  },
  replace: (href: string) => {
    lastNav = `replace:${href}`;
  },
};