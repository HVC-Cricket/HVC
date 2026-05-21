"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Small icon button that calls `router.refresh()` inside a transition.
 * Drop it into any client- or server-rendered surface where the
 * underlying data drifts and a full-page reload feels too heavy. The
 * icon spins for the duration of the server roundtrip and idle state
 * (`refreshing` from useTransition) tracks the actual fetch, not a
 * fake setTimeout — so it never lies about being done.
 *
 * Filter / scroll / focus state on the page is preserved because the
 * components don't unmount; only the `rows` / `events` / `reports`
 * props that come from the server change.
 */
export function RefreshButton({
  label = "Refresh",
  className,
}: {
  /** aria-label for screen readers + tooltip-style hover hint. */
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      aria-label={label}
      title={label}
      disabled={refreshing}
      onClick={() => startRefresh(() => router.refresh())}
      className={cn(
        "size-7 text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
    </Button>
  );
}
