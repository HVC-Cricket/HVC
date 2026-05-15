import { createClient } from "@/lib/supabase/server";

// `Awaited<T>` is a TypeScript built-in. Resolves the promise returned
// by `createClient()` so we can pass the supabase instance directly.
type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * For a set of players, batch-fetch the `avatar_url` of any user
 * accounts they're linked to. Returns a Map<user_id, avatar_url|null>.
 *
 * Caller typically resolves a player's display photo as:
 *   resolvePlayerPhoto({
 *     photo_url: player.photo_url,
 *     linked_avatar_url: player.linked_user_id
 *       ? avatarByUserId.get(player.linked_user_id) ?? null
 *       : null,
 *   })
 *
 * Used by /players, /players/[id], POTM banner, and MVP rows so a
 * player who linked their auth account but didn't upload a separate
 * player photo still shows their face. Single query regardless of
 * the number of players passed in.
 */
export async function fetchLinkedAvatars(
  supabase: Supabase,
  players: { linked_user_id: string | null }[],
): Promise<Map<string, string | null>> {
  const userIds = players
    .map((p) => p.linked_user_id)
    .filter((id): id is string => !!id);
  const out = new Map<string, string | null>();
  if (userIds.length === 0) return out;
  const { data } = await supabase
    .from("profiles")
    .select("id, avatar_url")
    .in("id", userIds);
  for (const p of data ?? []) out.set(p.id, p.avatar_url);
  return out;
}
