import { cn } from "@/lib/utils";

/**
 * Shared cricket role icons used on both the scoring console's slot
 * pickers and the live scoreboard tiles so the visual vocabulary stays
 * consistent. Both icons render with `currentColor` — the caller picks
 * the tint via a `text-*` utility on the className.
 */
export function BatIcon({
  dim,
  className,
}: {
  /** Renders the icon in a muted tint — used for the non-striker slot
   * where we want it less prominent than the striker. Overrides any
   * text-* color the caller passed. */
  dim?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="currentColor"
      className={cn(
        "size-4 shrink-0",
        className,
        dim
          ? "text-muted-foreground/50"
          : !className?.includes("text-")
            ? "text-cyan-600 dark:text-cyan-400"
            : undefined,
      )}
    >
      <rect x="11" y="2" width="2" height="7" rx="0.5" />
      <rect x="8.5" y="9" width="7" height="13" rx="2" />
    </svg>
  );
}

export function BallIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        "size-5 shrink-0",
        className,
        !className?.includes("text-")
          ? "text-cyan-600 dark:text-cyan-400"
          : undefined,
      )}
    >
      <circle cx="11" cy="4" r="1.8" fill="currentColor" stroke="none" />
      <path d="M11 6.5 L11 14" />
      <path d="M11 8 L16 4" />
      <circle cx="17.2" cy="3.2" r="1.3" fill="currentColor" stroke="none" />
      <path d="M11 8 L7 11" />
      <path d="M11 14 L8 21" />
      <path d="M11 14 L15 20" />
    </svg>
  );
}
