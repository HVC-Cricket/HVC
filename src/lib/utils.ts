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
