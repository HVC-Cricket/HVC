/**
 * Resolves which photo URL to render for a player. Prefers the
 * player's own `photo_url`; falls back to the linked auth user's
 * `avatar_url` so a player who hasn't uploaded a player photo but
 * linked their account still shows their face. Returns null when
 * neither is set — callers render initials in that case.
 */
export function resolvePlayerPhoto(args: {
  photo_url: string | null;
  linked_avatar_url: string | null;
}): string | null {
  return args.photo_url ?? args.linked_avatar_url ?? null;
}
