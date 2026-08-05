/**
 * Test double for `expo-file-system`'s `File` class (reliability harness).
 *
 * The real module is native-bound and cannot load in plain node, but
 * `src/features/tickets/api.ts` lazy-imports it inside `readLocalImage`, so
 * the harness require hook rewrites `expo-file-system` to this stub. The
 * surface mirrors only what api.ts uses (`exists`, `size`, `type`,
 * `base64()`); per-URI sources are armed through `__setFileSource`.
 *
 * A URI with no armed source behaves as a missing file (exists=false,
 * size=0) so the missing/empty-image path is exercisable too.
 */
export interface FileSource {
  /** Size in bytes. 0 (or absent) means empty/missing. */
  size: number;
  /** MIME type, e.g. 'image/jpeg'. '' when unknown. */
  type: string;
  /** Raw base64 the `base64()` promise resolves to. */
  base64: string;
}

const sources = new Map<string, FileSource>();

export function __setFileSource(uri: string, source: Partial<FileSource>): void {
  sources.set(uri, {
    size: source.size ?? 0,
    type: source.type ?? '',
    base64: source.base64 ?? '',
  });
}

export function __resetFileSources(): void {
  sources.clear();
}

export class File {
  constructor(public readonly uri: string) {}

  get exists(): boolean {
    return sources.has(this.uri);
  }

  get size(): number {
    return sources.get(this.uri)?.size ?? 0;
  }

  get type(): string {
    return sources.get(this.uri)?.type ?? '';
  }

  base64(): Promise<string> {
    return Promise.resolve(sources.get(this.uri)?.base64 ?? '');
  }
}
