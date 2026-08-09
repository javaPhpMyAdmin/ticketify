/**
 * Receipt-photo read seam (product decision 2026-08-09).
 *
 * The `receipts` bucket is PRIVATE (`public = false`, RLS scoped per owner),
 * so `getPublicUrl` never serves images. `purchases.image_url` therefore
 * stores the OBJECT PATH (e.g. `userId/tempId.jpg`) instead of a public URL,
 * and reads resolve a signed URL at render time (expires ~1h) before handing
 * the uri to an `<Image>`.
 *
 * Demo/seed rows keep external http(s) URLs (picsum), so resolution MUST
 * treat any http(s) value as a ready-to-render URL and only sign actual
 * storage paths (which never start with http). The pure helpers here are
 * node-testable (mirrors `feature-access.ts` posture: gate on
 * `isSupabaseConfigured`, never throw on a failed read — null instead, and
 * the UI keeps its existing "no photo" placeholder).
 */
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

/** How long a resolved signed URL stays valid (storage-js default is 60s; 1h
 *  covers a typical review/detail session without a refetch). */
export const RECEIPT_PHOTO_EXPIRY_SECONDS = 3600;

/**
 * Discriminated classification of a stored `image_url` value:
 *   - `url`  — already an http(s) URL (demo/seed rows): render as-is,
 *   - `path` — an object path in the private `receipts` bucket: must be
 *     resolved to a signed URL before rendering.
 * null input (no photo) yields null so consumers keep their placeholder.
 */
export type ReceiptPhotoValue =
  | { kind: 'url'; value: string }
  | { kind: 'path'; value: string };

/**
 * Classifies a stored receipt photo reference. Anything that starts with
 * `http://` / `https://` is a ready URL; everything else is treated as a
 * storage object path (storage paths never start with http).
 */
export function resolveReceiptPhotoPath(
  value: string | null | undefined,
): ReceiptPhotoValue | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return { kind: 'url', value };
  return { kind: 'path', value };
}

/**
 * Resolves a storage object path in the `receipts` bucket to a time-limited
 * signed URL. Returns null on failure (unconfigured, RLS denial, missing
 * object) — never throws — so the UI falls back to the "no photo"
 * placeholder instead of crashing. Errors are logged with console.warn,
 * same posture as the feature-access read seam.
 */
export async function getSignedReceiptPhotoUrl(
  path: string,
  expiresInSeconds: number = RECEIPT_PHOTO_EXPIRY_SECONDS,
): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase.storage
      .from('receipts')
      .createSignedUrl(path, expiresInSeconds);
    if (error || !data) {
      console.warn(
        '[photo] signed url failed:',
        error?.statusCode ?? error?.message ?? String(error),
      );
      return null;
    }
    return data.signedUrl;
  } catch (err) {
    // storage-js can re-throw non-StorageError failures; keep the "never
    // throws" contract so the UI always falls back to the placeholder.
    console.warn('[photo] signed url threw:', String(err));
    return null;
  }
}
