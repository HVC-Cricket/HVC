import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Buckets that this app uploads to + the DB column whose values
 * reference them. Used by the storage-browser tab to detect orphan
 * files (objects in the bucket that NO DB column points at).
 */
const BUCKET_REFS = [
  {
    bucket: "player-photos",
    table: "players",
    column: "photo_url",
    label: "Player photos",
  },
  {
    bucket: "team-logos",
    table: "teams",
    column: "logo_url",
    label: "Team logos",
  },
  {
    bucket: "tournament-logos",
    table: "tournaments",
    column: "logo_url",
    label: "Tournament logos",
  },
  {
    bucket: "user-avatars",
    table: "profiles",
    column: "avatar_url",
    label: "User avatars",
  },
] as const;

export type BucketRef = (typeof BUCKET_REFS)[number];
export const STORAGE_BUCKETS = BUCKET_REFS;

export type StorageObject = {
  path: string;
  size: number;
  updated_at: string | null;
};

export type BucketReport = {
  bucket: string;
  label: string;
  totalObjects: number;
  totalBytes: number;
  referencedObjects: number;
  orphans: StorageObject[];
};

/**
 * Extract the bucket-relative path from a Supabase public-storage URL.
 * Returns null for URLs that don't point at the given bucket (or
 * external CDN URLs like `media.cricheroes.in/...` that the
 * cricheroes import left in `logo_url`).
 */
function pathFromPublicUrl(url: string | null, bucket: string): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}

/**
 * Snapshot of every bucket: total objects, total size, and the list
 * of orphan paths (storage objects no DB column references). Stored
 * as one query per bucket — calls run in parallel.
 *
 * Service-role required because storage RLS only lets the bucket
 * owner list arbitrary paths.
 */
export async function loadStorageReport(): Promise<BucketReport[]> {
  const admin = createAdminClient();

  return Promise.all(
    BUCKET_REFS.map(async (ref) => {
      // Storage list is folder-scoped. Two levels: top-level
      // folders (one per uploader user_id, typically) → files in
      // each. Cap at 1000 per level — fine for the current scale.
      const { data: topLevel } = await admin.storage
        .from(ref.bucket)
        .list("", { limit: 1000 });

      const objects: StorageObject[] = [];
      for (const entry of topLevel ?? []) {
        // `metadata` is set on actual files; folders have `null`.
        if (entry.metadata != null) {
          objects.push({
            path: entry.name,
            size: Number(entry.metadata.size ?? 0),
            updated_at: entry.updated_at ?? null,
          });
          continue;
        }
        const { data: nested } = await admin.storage
          .from(ref.bucket)
          .list(entry.name, { limit: 1000 });
        for (const f of nested ?? []) {
          if (f.metadata == null) continue; // skip nested folders
          objects.push({
            path: `${entry.name}/${f.name}`,
            size: Number(f.metadata.size ?? 0),
            updated_at: f.updated_at ?? null,
          });
        }
      }

      // Pull referenced URLs from the linked table. Filter to rows
      // where the column is non-null + actually points at this
      // bucket (cricheroes-imported logos use external CDN URLs and
      // shouldn't count as "referencing" our storage).
      const { data: dbRows } = await admin
        .from(ref.table)
        .select(ref.column)
        .not(ref.column, "is", null);
      // The dynamic `ref.column` confuses Supabase's generated types
      // (they want a literal column name). Cast through `unknown`;
      // the shape is `[{ <column>: string | null }, …]` at runtime.
      type ColumnRow = Record<string, string | null>;
      const referenced = new Set<string>();
      for (const row of (dbRows ?? []) as unknown as ColumnRow[]) {
        const url = row[ref.column];
        const path = pathFromPublicUrl(url, ref.bucket);
        if (path) referenced.add(path);
      }

      const orphans = objects.filter((o) => !referenced.has(o.path));
      const totalBytes = objects.reduce((a, o) => a + o.size, 0);

      return {
        bucket: ref.bucket,
        label: ref.label,
        totalObjects: objects.length,
        totalBytes,
        referencedObjects: objects.length - orphans.length,
        orphans,
      };
    }),
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
