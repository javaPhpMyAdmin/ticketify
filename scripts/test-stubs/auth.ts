/**
 * Minimal test double for `@/features/auth`.
 *
 * The real auth module pulls in zustand, supabase, storage-adapter,
 * auth-listener-registry, profile-sync, query-client, and receipts-store.
 * This stub provides only the `useSessionUser` hook the monthly-cache
 * module needs, with a controllable userId via a module-scope seam.
 */

let fakeUserId: string | null = 'test-user-id';

export function __setUserId(id: string | null): void {
  fakeUserId = id;
}

export function useSessionUser(): { userId: string | null; email: string | null } {
  return { userId: fakeUserId, email: fakeUserId ? 'test@example.com' : null };
}
