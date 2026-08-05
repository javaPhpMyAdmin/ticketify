/**
 * Picks the capture size that keeps photos readable but small. Android exposes
 * a device-dependent list like `["3840x2160", "1920x1080", ...]`; we prefer the
 * largest entry whose long side is at most 1600px (≈2MP, enough for a receipt)
 * and fall back to the smallest available size if every option is larger.
 */
export function pickBestPictureSize(sizes: string[]): string | undefined {
  const parsed = sizes
    .map((size) => {
      const [w, h] = size.toLowerCase().split('x').map(Number);
      return { size, long: Math.max(w, h) };
    })
    .filter((entry) => Number.isFinite(entry.long) && entry.long > 0)
    .sort((a, b) => a.long - b.long);
  if (parsed.length === 0) return undefined;
  const capped = parsed.filter((entry) => entry.long <= 1600);
  if (capped.length > 0) return capped[capped.length - 1].size;
  // Every available size exceeds the cap: pick the SMALLEST — full-resolution
  // capture is exactly what the parse pipeline times out on.
  return parsed[0].size;
}
