import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * "Pavan Gautham" -> "PG"
 * "ambrisha"      -> "A"
 *
 * Used by every "circle initials" avatar fallback in the app — admin
 * lists, activity log scorer chips, profile card hero, MVP rows.
 * Returns "?" when the input is empty so the rendered chip is never
 * blank.
 */
export function getInitials(name: string): string {
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return initials || "?";
}

/**
 * "MM" / "RS" — first two characters of a team's short_name in
 * upper-case. Used for the round badge fallback when a team has no
 * uploaded logo (home page live cards, upcoming rows, recent rows,
 * tournament detail, match detail).
 */
export function getTeamInitials(shortName: string): string {
  return shortName.slice(0, 2).toUpperCase();
}
