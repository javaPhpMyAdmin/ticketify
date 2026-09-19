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
let currentPathname = '/';

export function __setRouteParams(params: RouteParams): void {
  routeParams = params;
}

/** Sets the pathname `usePathname` reports (consent-gate harness). */
export function __setPathname(pathname: string): void {
  currentPathname = pathname;
}

export function __lastNav(): string | null {
  return lastNav;
}

export function __resetRouterStub(): void {
  routeParams = {};
  lastNav = null;
  currentPathname = '/';
}

export function useLocalSearchParams<T extends RouteParams = RouteParams>(): T {
  return routeParams as T;
}

/** Route type used by navigation helpers; untyped in the double. */
export type Href = string;

export function usePathname(): string {
  return currentPathname;
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