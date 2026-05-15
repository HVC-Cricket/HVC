"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";

/**
 * Date / datetime input that opens the native picker on click anywhere
 * in the field — not just on the small calendar icon (which is the
 * default browser behaviour and feels broken on mobile). Uses
 * HTMLInputElement.showPicker() where available; falls back silently
 * on browsers that don't support it (Safari < 16, very old Firefox).
 *
 * Defaults to `type="date"`; pass `type="datetime-local"` for combined
 * date + time fields (used on match scheduling).
 */
export const DateInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<typeof Input>
>(function DateInput({ type = "date", onClick, onFocus, ...props }, ref) {
  const open = (el: HTMLInputElement | null) => {
    if (!el || typeof el.showPicker !== "function") return;
    try {
      el.showPicker();
    } catch {
      // showPicker can throw if the element isn't visible or focused
      // in some edge cases (e.g. transitioning dialogs). Safe to ignore.
    }
  };
  return (
    <Input
      ref={ref}
      type={type}
      onClick={(e) => {
        open(e.currentTarget);
        onClick?.(e);
      }}
      onFocus={(e) => {
        open(e.currentTarget);
        onFocus?.(e);
      }}
      {...props}
    />
  );
});
